import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryStudioHandler } from '../api/story-studio.js';
import { createStoryStudioStore, parseComicPlan } from '../lib/storyStudio.js';

function plan() {
  return {
    title: 'The Signal',
    logline: 'A courier discovers the package is calling her by name.',
    genre: 'science fiction',
    visualStyle: 'inked cinematic panels with sharp violet light',
    palette: ['#101525', '#7b45d6', '#58d7ff'],
    characters: [{ name: 'Mara', role: 'courier', appearance: 'cropped dark hair, red utility coat', continuity: 'coat and silver wrist band remain visible' }],
    panels: Array.from({ length: 6 }, (_, index) => ({
      title: `Beat ${index + 1}`,
      beat: `The story advances at beat ${index + 1}.`,
      shot: index % 2 ? 'close-up' : 'wide shot',
      setting: 'rainy elevated train platform',
      caption: index === 0 ? 'The last train was never empty.' : '',
      dialogue: [{ speaker: 'Mara', line: `Line ${index + 1}` }],
      artDirection: 'Keep the red coat and silver wrist band visible.',
    })),
  };
}

function fakeRedis() {
  const hashes = new Map();
  const sorted = new Map();
  return {
    async command([op, key, ...args]) {
      if (op === 'HGET') return hashes.get(key)?.get(args[0]) ?? null;
      if (op === 'HSET') { if (!hashes.has(key)) hashes.set(key, new Map()); hashes.get(key).set(args[0], args[1]); return 1; }
      if (op === 'HDEL') { let count = 0; for (const id of args) count += hashes.get(key)?.delete(id) ? 1 : 0; return count; }
      if (op === 'HMGET') return args.map((id) => hashes.get(key)?.get(id) ?? null);
      if (op === 'ZADD') { if (!sorted.has(key)) sorted.set(key, new Map()); sorted.get(key).set(args[1], Number(args[0])); return 1; }
      if (op === 'ZREVRANGE') {
        const start = Number(args[0]); const end = Number(args[1]);
        const ids = [...(sorted.get(key) || new Map()).entries()].sort((a,b) => b[1] - a[1]).map(([id]) => id);
        return ids.slice(start, end < 0 ? undefined : end + 1);
      }
      if (op === 'ZREM') { let count = 0; for (const id of args) count += sorted.get(key)?.delete(id) ? 1 : 0; return count; }
      throw new Error(`Unexpected command ${op}`);
    },
  };
}

function response() {
  return { code:0, body:null, headers:{}, setHeader(key,value){ this.headers[key]=value; }, status(code){ this.code=code; return this; }, json(body){ this.body=body; return this; } };
}

test('comic-plan parser accepts fenced JSON and normalizes six editable panels', () => {
  const parsed = parseComicPlan('```json\n' + JSON.stringify(plan()) + '\n```');
  assert.equal(parsed.panels.length, 6);
  assert.equal(parsed.panels[0].number, 1);
  assert.equal(parsed.characters[0].name, 'Mara');
  assert.deepEqual(parsed.palette, ['#101525', '#7b45d6', '#58d7ff']);
});

test('Story Studio projects stay isolated by signed-in account and can be deleted', async () => {
  const redis = fakeRedis();
  let timestamp = 1000;
  const store = createStoryStudioStore({ command:redis.command, now:() => timestamp++ });
  const project = await store.saveProject('alice',{ sourceTitle:'Chapter one', sourceText:'x'.repeat(150), comic:plan() });
  assert.equal((await store.listProjects('alice')).length, 1);
  assert.equal((await store.listProjects('bob')).length, 0);
  assert.equal(await store.getProject('bob',project.id), null);
  assert.equal(await store.deleteProject('alice',project.id), true);
  assert.equal(await store.getProject('alice',project.id), null);
});

test('generation requires authentication and an explicit rights confirmation', async () => {
  const noUser = createStoryStudioHandler({ resolveUser:async () => null });
  const unauthenticated = response();
  await noUser({ method:'GET', query:{} },unauthenticated);
  assert.equal(unauthenticated.code,401);

  const noRights = createStoryStudioHandler({ resolveUser:async () => 'alice' });
  const rejected = response();
  await noRights({ method:'POST', body:{ action:'generate', sourceText:'x'.repeat(150) } },rejected);
  assert.equal(rejected.code,400);
  assert.match(rejected.body.error,/right to adapt/i);
});

test('one chapter routes through Nex, saves privately, and settles creative credits', async () => {
  const calls = { route:0, save:[], settle:[] };
  const handler = createStoryStudioHandler({
    resolveUser:async () => 'alice',
    store:{
      async saveProject(userId,input){ calls.save.push({userId,input}); return { id:'story-1', sourceTitle:input.sourceTitle, sourceText:input.sourceText, comic:input.comic }; },
      async listProjects(){ return []; }, async getProject(){ return null; }, async deleteProject(){ return false; },
    },
    meter:{ async reserveBuild(){ return {ok:true,period:1,reservationId:'reservation-1'}; }, async settleBuild(input){ calls.settle.push(input); } },
    async route(){ calls.route += 1; return { data:{ content:[{type:'text',text:JSON.stringify(plan())}] } }; },
  });
  const res = response();
  await handler({ method:'POST', body:{ action:'generate', sourceTitle:'Chapter one', sourceText:'A'.repeat(180), visualStyle:'noir', rightsConfirmed:true } },res);
  assert.equal(res.code,200);
  assert.equal(calls.route,1);
  assert.equal(calls.save[0].userId,'alice');
  assert.equal(calls.save[0].input.comic.panels.length,6);
  assert.equal(calls.settle[0].success,true);
});

test('saving edits cannot claim a project outside the current account store', async () => {
  const handler = createStoryStudioHandler({
    resolveUser:async () => 'alice',
    store:{ async getProject(){ return null; } },
  });
  const res = response();
  await handler({ method:'POST', body:{ action:'save', projectId:'someone-elses-project', comic:plan() } },res);
  assert.equal(res.code,404);
});

test('illustrating one panel saves real private art and keeps the first panel as the world reference', async () => {
  const current = { id:'story-1', sourceTitle:'Chapter one', sourceText:'A'.repeat(180), comic:plan() };
  const calls = { visual:[], save:[], settle:[] };
  const handler = createStoryStudioHandler({
    resolveUser:async () => 'alice',
    store:{
      async getProject(){ return current; },
      async saveProject(userId,input){ calls.save.push({userId,input}); return {...current,comic:input.comic}; },
    },
    visuals:{
      async get(userId,projectId,panelIndex){ assert.equal(userId,'alice'); assert.equal(projectId,'story-1'); assert.equal(panelIndex,0); return {mediaType:'image/png',base64:'cmVm'}; },
      async save(userId,projectId,panelIndex,input){ calls.visual.push({userId,projectId,panelIndex,input}); return {model:input.model,generatedAt:777}; },
    },
    meter:{ async reserveBuild(){ return {ok:true,period:1,reservationId:'visual-reservation'}; }, async settleBuild(input){ calls.settle.push(input); } },
    async generateVisual(input){ assert.equal(input.panelIndex,1); assert.equal(input.referenceImage.base64,'cmVm'); return {dataUrl:'data:image/png;base64,YXJ0',model:'image-model'}; },
  });
  const res = response();
  await handler({method:'POST',body:{action:'illustrate',projectId:'story-1',panelIndex:1,comic:current.comic}},res);
  assert.equal(res.code,200);
  assert.equal(calls.visual[0].panelIndex,1);
  assert.equal(calls.save[0].input.comic.panels[1].image.url,'/api/story-image?id=story-1&panel=1&v=777');
  assert.equal(calls.settle[0].success,true);
});
