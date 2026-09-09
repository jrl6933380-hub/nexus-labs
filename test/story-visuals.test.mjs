import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryImageHandler } from '../api/story-image.js';
import {
  buildPanelVisualPrompt,
  createStoryVisualStore,
  generatePanelVisual,
  parseImageDataUrl,
  __internals,
} from '../lib/storyVisuals.js';

const png = `data:image/png;base64,${Buffer.from('distinct-panel-art').toString('base64')}`;

function comic() {
  return {
    title: 'The Signal',
    genre: 'science fiction',
    visualStyle: 'cinematic inked graphic novel',
    palette: ['#101525', '#7b45d6', '#58d7ff'],
    characters: [{ name:'Mara', role:'courier', appearance:'cropped dark hair and a red utility coat', continuity:'silver wrist band on the left arm' }],
    panels: [
      { beat:'Mara arrives alone on a rain-soaked platform.', shot:'wide establishing shot', setting:'elevated train platform at midnight', artDirection:'rain and violet signals', dialogue:[] },
      { beat:'The package lights up and speaks her name.', shot:'extreme close-up', setting:'inside the last train', artDirection:'blue light across her startled face', dialogue:[{speaker:'Package',line:'Mara.'}] },
    ],
  };
}

function response() {
  return {
    code:0, body:null, headers:{}, bytes:null,
    setHeader(key,value){ this.headers[key] = value; },
    status(code){ this.code = code; return this; },
    json(body){ this.body = body; return this; },
    send(bytes){ this.bytes = bytes; return this; },
  };
}

test('panel prompts share one locked world while demanding a distinct scene', () => {
  const first = buildPanelVisualPrompt({ comic:comic(), panel:comic().panels[0], panelIndex:0 });
  const second = buildPanelVisualPrompt({ comic:comic(), panel:comic().panels[1], panelIndex:1, hasReference:true });
  assert.match(first,/cropped dark hair and a red utility coat/);
  assert.match(second,/cropped dark hair and a red utility coat/);
  assert.match(first,/rain-soaked platform/);
  assert.match(second,/package lights up/);
  assert.match(second,/genuinely new composition/);
  assert.match(second,/Do not include captions, speech bubbles/);
  assert.notEqual(first,second);
});

test('image generation uses Gateway image modalities and can carry the first panel as reference', async () => {
  let request;
  const referenceImage = parseImageDataUrl(png);
  const result = await generatePanelVisual({
    comic:comic(), panel:comic().panels[1], panelIndex:1, referenceImage,
    env:{ AI_GATEWAY_API_KEY:'gateway-secret', STORY_STUDIO_IMAGE_MODEL:'google/test-image-model' },
    fetchFn:async (url,options) => {
      request = { url, options, body:JSON.parse(options.body) };
      return { ok:true, async json(){ return { choices:[{ message:{ images:[{ image_url:{ url:png } }] } }] }; } };
    },
  });
  assert.equal(request.url,__internals.GATEWAY_IMAGE_ENDPOINT);
  assert.equal(request.options.headers.Authorization,'Bearer gateway-secret');
  assert.deepEqual(request.body.modalities,['text','image']);
  assert.equal(request.body.messages[0].content[1].type,'image_url');
  assert.equal(result.dataUrl,png);
  assert.equal(result.model,'google/test-image-model');
});

test('visual assets persist separately and remain isolated by customer', async () => {
  const values = new Map();
  const command = async ([op,key,...args]) => {
    if (op === 'SET') { values.set(key,args[0]); return 'OK'; }
    if (op === 'GET') return values.get(key) ?? null;
    if (op === 'DEL') { let removed = 0; for (const item of [key,...args]) removed += values.delete(item) ? 1 : 0; return removed; }
    throw new Error(`Unexpected command ${op}`);
  };
  const store = createStoryVisualStore({command,now:() => 1234});
  await store.save('alice','story-1',0,{dataUrl:png,model:'image-model'});
  assert.equal((await store.get('alice','story-1',0)).generatedAt,1234);
  assert.equal(await store.get('bob','story-1',0),null);
  assert.equal(await store.deleteProject('alice','story-1'),1);
  assert.equal(await store.get('alice','story-1',0),null);
});

test('private image delivery verifies project ownership before returning bytes', async () => {
  let visualReads = 0;
  const visualStore = { async get(){ visualReads += 1; return {mediaType:'image/png',base64:Buffer.from('art').toString('base64')}; } };
  const denied = createStoryImageHandler({
    resolveUser:async () => 'bob',
    projectStore:{ async getProject(){ return null; } },
    visualStore,
  });
  const deniedRes = response();
  await denied({method:'GET',query:{id:'story-1',panel:'0'}},deniedRes);
  assert.equal(deniedRes.code,404);
  assert.equal(visualReads,0);

  const allowed = createStoryImageHandler({
    resolveUser:async () => 'alice',
    projectStore:{ async getProject(){ return {id:'story-1'}; } },
    visualStore,
  });
  const allowedRes = response();
  await allowed({method:'GET',query:{id:'story-1',panel:'0'}},allowedRes);
  assert.equal(allowedRes.code,200);
  assert.equal(allowedRes.headers['Content-Type'],'image/png');
  assert.equal(allowedRes.bytes.toString(),'art');
});
