import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorId,
  applyNexSceneOperations,
  normalizeStoryScene,
  sampleStoryScene,
} from '../public/story-scene-runtime.js';

const characters = [{actorId:'mara',name:'Mara',role:'courier'}];
const dialogue = [{actorId:'mara',speaker:'Mara',line:'Keep moving.'}];

test('old comic panels automatically become persistent Nex-directed live scenes', () => {
  const scene = normalizeStoryScene(null,{characters,dialogue,durationMs:6000});
  assert.equal(scene.version,1);
  assert.equal(scene.directedBy,'nex');
  assert.equal(scene.actors[0].id,'mara');
  assert.equal(scene.actors[0].keyframes[0].pose,'story-ready');
  assert.equal(scene.stage.backgroundMode,'generated-plate');
});

test('Nex can direct an actor across time without hard stage-edge limits', () => {
  const initial = normalizeStoryScene(null,{characters,dialogue,durationMs:6000});
  const directed = applyNexSceneOperations(initial,[
    {type:'move',actorId:'mara',atMs:0,x:-25,y:70,pose:'crouched',expression:'afraid'},
    {type:'move',actorId:'mara',atMs:3000,x:55,y:62,pose:'running',expression:'determined'},
    {type:'record-direction',actorId:'mara',atMs:0,direction:'Enter low, then sprint across the platform.'},
  ],{characters,dialogue,durationMs:6000,now:99});
  const middle = sampleStoryScene(directed,1500,{characters,dialogue,durationMs:6000});
  assert.equal(middle.actors[0].frame.x,15);
  assert.equal(middle.actors[0].frame.pose,'running');
  assert.equal(directed.directions[0].deliveredBy,'nex');
  assert.equal(directed.updatedAt,99);
});

test('actor ids stay stable across dialogue, scene blocking, and tools', () => {
  assert.equal(actorId('  Dr. Maya (V.O.) '),'dr-maya-v-o');
  assert.equal(actorId('Kaelen Reyes'),'kaelen-reyes');
});

test('camera and speech anchors remain separately controllable', () => {
  const initial = normalizeStoryScene({actors:[{actorId:'mara',name:'Mara'}]},{characters,dialogue,durationMs:6000});
  const directed = applyNexSceneOperations(initial,[
    {type:'camera',atMs:2000,x:65,y:40,zoom:1.5,rotation:-2},
    {type:'set-speech-anchor',actorId:'mara',x:70,y:12},
    {type:'set-bounds',actorId:'mara',x:58,y:22,width:20,height:62,faceAnchor:{x:68,y:30}},
  ],{characters,dialogue,durationMs:6000});
  assert.deepEqual(directed.actors[0].speechAnchor,{x:70,y:12});
  assert.deepEqual(directed.actors[0].faceAnchor,{x:68,y:30});
  assert.equal(sampleStoryScene(directed,2000).camera.zoom,1.5);
});

test('scene sampling uses Nex poster time when no animation time is supplied', () => {
  const scene = normalizeStoryScene({
    durationMs:6000,
    posterTimeMs:3000,
    actors:[{id:'mara',name:'Mara',keyframes:[
      {atMs:0,x:20,y:65},
      {atMs:6000,x:80,y:65},
    ]}],
  });
  const poster = sampleStoryScene(scene);
  assert.equal(poster.atMs,3000);
  assert.equal(poster.actors[0].frame.x,50);
});
