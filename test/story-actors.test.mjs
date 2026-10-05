import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActorPerformancePrompt, directStoryActor, parseActorPerformance } from '../lib/storyActors.js';
import { normalizeComicPlan } from '../lib/storyStudio.js';

function comic() {
  return normalizeComicPlan({
    title:'The Signal',genre:'science fiction',visualStyle:'cinematic ink',
    worldBible:{premise:'A signal copies voices.'},
    characters:[{
      actorId:'mara',name:'Mara',role:'courier',appearance:'red utility coat',continuity:'silver wrist band',
      intelligence:{personality:'wary and resourceful',privateObjective:'protect her brother',instincts:['checks exits first'],voice:'short sentences',movementStyle:'low and deliberate',emotionalRange:'fear appears in her hands',relationships:['Eli: protective older sister']},
    }],
    panels:Array.from({length:6},(_,index) => ({
      title:`Beat ${index + 1}`,beat:'Mara crosses the platform.',shot:'wide',setting:'wet station',durationMs:6000,
      dialogue:[{actorId:'mara',speaker:'Mara',line:'Stay close.',startMs:0,endMs:2500}],
      scene:{actors:[{actorId:'mara',name:'Mara',blocking:{x:25,y:70},speechAnchor:{x:25,y:15},faceAnchor:{x:25,y:28}}]},
      artDirection:'Mara stands left in open rain.',
    })),
  });
}

const actor = comic().panels[0].scene.actors[0];

test('each character receives a private bounded actor-performance prompt', () => {
  const projectComic = comic();
  const prompt = buildActorPerformancePrompt({
    comic:projectComic,panel:projectComic.panels[0],character:projectComic.characters[0],actor,
    direction:'Cross behind the column and whisper that the train is coming.',atMs:1200,
  });
  assert.match(prompt,/wary and resourceful/);
  assert.match(prompt,/protect her brother/);
  assert.match(prompt,/NEX'S DIRECTION/);
  assert.match(prompt,/Do not change the plot or direct another actor/);
});

test('actor output becomes bounded scene and actor-owned lettering operations', () => {
  const parsed = parseActorPerformance(JSON.stringify({
    acknowledgement:'I will stay low.',
    performance:{atMs:1200,x:52,y:68,pose:'crouched run',expression:'alert',facing:'right'},
    speech:{text:'The train is coming.',startMs:1400,endMs:3300,type:'speech',side:'left',bubbleOffsetX:-24,bubbleOffsetY:-28,width:29},
    camera:null,
  }),{actor,direction:'Move.',atMs:1200,durationMs:6000});
  assert.equal(parsed.actorOperations[0].type,'record-direction');
  assert.equal(parsed.actorOperations[1].actorId,'mara');
  assert.equal(parsed.speech.text,'The train is coming.');
});

test('Nex can direct a character intelligence and persist its performance', async () => {
  let saved;
  const project = {id:'story-1',comic:comic()};
  const store = {
    async getProject(userId,id){ return userId === 'alice' && id === 'story-1' ? project : null; },
    async saveProject(userId,value){ saved = {userId,value}; return value; },
  };
  const route = async () => ({data:{content:[{type:'text',text:JSON.stringify({
    acknowledgement:'Ready.',
    performance:{atMs:1000,x:60,y:65,pose:'running',expression:'determined',facing:'right'},
    speech:{text:'Move!',startMs:1000,endMs:2400,type:'shout',side:'left',bubbleOffsetX:-25,bubbleOffsetY:-30,width:23},
    camera:null,
  })}]}});
  const result = await directStoryActor({
    userId:'alice',projectId:'story-1',panelIndex:0,actor:'Mara',direction:'Run right and shout Move!',atMs:1000,store,route,now:() => 77,
  });
  assert.equal(result.actorId,'mara');
  assert.equal(saved.userId,'alice');
  assert.equal(saved.value.comic.panels[0].scene.actors[0].keyframes.at(-1).pose,'running');
  assert.equal(saved.value.comic.panels[0].lettering.tracks[0].actorId,'mara');
  assert.equal(saved.value.comic.panels[0].lettering.tracks[0].followsActor,true);
});

