import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LETTERING_TIMELINE_VERSION,
  applyNexLetteringOperations,
  normalizeLetteringTimeline,
  posterLetteringFrames,
  sampleLetteringTimeline,
  staticDialogueFromTimeline,
} from '../public/story-lettering-runtime.js';

const dialogue = [{
  speaker:'Lena',
  line:'Where are we?',
  type:'speech',
  side:'left',
  layout:{x:8,y:10,width:24},
  startMs:0,
  endMs:2_200,
}];

test('old static dialogue automatically becomes a Nex-owned animation timeline', () => {
  const timeline = normalizeLetteringTimeline(null,dialogue,{durationMs:6_000});
  assert.equal(timeline.version,LETTERING_TIMELINE_VERSION);
  assert.equal(timeline.directedBy,'nex');
  assert.equal(timeline.tracks[0].id,'bubble-1');
  assert.deepEqual(timeline.tracks[0].textCues,[{startMs:0,endMs:2200,text:'Where are we?'}]);
  assert.equal(timeline.tracks[0].keyframes[0].x,8);
});

test('Nex can replace words, move freely, and make a bubble disappear over time', () => {
  const initial = normalizeLetteringTimeline(null,dialogue,{durationMs:6_000});
  const timeline = applyNexLetteringOperations(initial,dialogue,[
    {type:'set-text',trackId:'bubble-1',startMs:2_600,endMs:4_500,text:"That isn't Dad."},
    {type:'move',trackId:'bubble-1',atMs:2_600,x:-35,y:18,width:31,easing:'linear'},
    {type:'show',trackId:'bubble-1',atMs:2_600},
    {type:'hide',trackId:'bubble-1',atMs:4_500},
  ],{now:1234});
  assert.equal(sampleLetteringTimeline(timeline,1_000)[0].text,'Where are we?');
  const second = sampleLetteringTimeline(timeline,3_000)[0];
  assert.equal(second.text,"That isn't Dad.");
  assert.ok(second.x < 0,'off-canvas animation positions stay available to Nex');
  assert.equal(sampleLetteringTimeline(timeline,5_000).length,0);
  assert.equal(timeline.updatedAt,1234);
});

test('position, scale, and tail targets interpolate between keyframes', () => {
  const initial = normalizeLetteringTimeline(null,dialogue,{durationMs:6_000});
  const timeline = applyNexLetteringOperations(initial,dialogue,[
    {type:'move',trackId:'bubble-1',atMs:2_000,x:48,y:30,easing:'linear'},
    {type:'resize',trackId:'bubble-1',atMs:2_000,width:40,scale:1.2,easing:'linear'},
    {type:'retarget-tail',trackId:'bubble-1',atMs:2_000,tailX:72,tailY:64,easing:'linear'},
  ]);
  const halfway = sampleLetteringTimeline(timeline,1_000,{includeHidden:true})[0];
  assert.equal(halfway.x,28);
  assert.equal(halfway.y,20);
  assert.equal(halfway.width,32);
  assert.equal(halfway.scale,1.1);
  assert.equal(halfway.tailX,45);
});

test('Nex can add sequential bubbles without crowding the static poster', () => {
  let timeline = normalizeLetteringTimeline(null,dialogue,{durationMs:8_000});
  timeline = applyNexLetteringOperations(timeline,dialogue,[
    {type:'add-track',trackId:'bubble-noah',speaker:'Noah',bubbleType:'shout',side:'right',text:'Run!',startMs:5_000,endMs:7_000,x:68,y:8,width:20},
  ]);
  assert.equal(sampleLetteringTimeline(timeline,1_000).length,1);
  const later = sampleLetteringTimeline(timeline,5_500);
  assert.equal(later.length,1);
  assert.equal(later[0].speaker,'Noah');
  assert.equal(later[0].text,'Run!');
});

test('the static comic remains a poster-frame projection of the timeline', () => {
  const timeline = applyNexLetteringOperations(null,dialogue,[
    {type:'move',trackId:'bubble-1',atMs:0,x:62,y:7,width:28},
    {type:'set-style',trackId:'bubble-1',side:'right',speaker:'Lena',bubbleType:'thought'},
  ],{durationMs:6_000});
  const staticDialogue = staticDialogueFromTimeline(dialogue,timeline);
  assert.equal(staticDialogue[0].line,'Where are we?');
  assert.equal(staticDialogue[0].type,'thought');
  assert.equal(staticDialogue[0].side,'right');
  assert.deepEqual(staticDialogue[0].layout,{x:62,y:7,width:28,source:'vision'});
});

test('poster lettering keeps sequential dialogue visible in the static comic', () => {
  const twoLines = [
    {...dialogue[0],startMs:0,endMs:1800},
    {speaker:'Noah',line:'I heard it.',type:'speech',side:'right',startMs:3000,endMs:5000},
  ];
  const timeline = normalizeLetteringTimeline(null,twoLines,{durationMs:6000});
  assert.equal(sampleLetteringTimeline(timeline,500).length,1);
  assert.equal(posterLetteringFrames(timeline,twoLines).length,2);
  assert.deepEqual(posterLetteringFrames(timeline,twoLines).map((frame) => frame.text),['Where are we?','I heard it.']);
});

test('a bubble can belong to and follow its speaking actor', () => {
  const actorDialogue = [{...dialogue[0],actorId:'lena'}];
  const timeline = applyNexLetteringOperations(null,actorDialogue,[
    {type:'attach-to-actor',trackId:'bubble-1',actorId:'lena',followsActor:true,offsetX:-20,offsetY:-28},
  ],{durationMs:6000});
  const frame = posterLetteringFrames(timeline,actorDialogue)[0];
  assert.equal(frame.actorId,'lena');
  assert.equal(frame.followsActor,true);
  assert.equal(frame.actorOffsetX,-20);
  assert.equal(frame.actorOffsetY,-28);
});
