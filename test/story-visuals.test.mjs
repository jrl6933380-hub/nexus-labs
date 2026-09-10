import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryImageHandler } from '../api/story-image.js';
import {
  analyzePanelVisual,
  buildBubbleReservations,
  buildPanelVisualPrompt,
  buildPanelReviewPrompt,
  buildPanelVisionPrompt,
  createStoryVisualStore,
  generatePanelVisual,
  parseBubblePlacements,
  parseLetteringReview,
  parseImageDataUrl,
  reviewPanelLettering,
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
      { beat:'The package lights up and speaks her name.', shot:'extreme close-up', setting:'inside the last train', artDirection:'blue light across her startled face', dialogue:[{speaker:'Package',line:'Mara.',side:'right'}] },
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
  assert.match(second,/Package \(right side\): Mara\./);
  assert.match(second,/LETTERING RESERVATIONS/);
  assert.match(second,/keep the right zone x=/);
  assert.match(second,/locked composition space/);
  assert.match(second,/genuinely new composition/);
  assert.match(second,/Do not include captions, speech bubbles/);
  assert.notEqual(first,second);
});

test('vision lettering prompt asks the Gateway to inspect actual pixels and return bounded coordinates', () => {
  const prompt = buildPanelVisionPrompt({panel:comic().panels[1]});
  assert.match(prompt,/professional letterer/);
  assert.match(prompt,/Read the actual pixels/);
  assert.match(prompt,/"x":number,"y":number,"width":number/);
  assert.match(prompt,/Package.*Mara\./);
  assert.match(prompt,/never split in the middle/);
  assert.match(prompt,/width 20-26/);
  assert.match(prompt,/Never cover or touch any character's head/);
});

test('lettering reservations are planned before art for at most two readable bubbles', () => {
  const reservations = buildBubbleReservations([
    {speaker:'Mara',line:'Did you hear that?',side:'left'},
    {speaker:'Eli',line:'It came from below the floorboards.',side:'right'},
    {speaker:'Package',line:'This third line must not crowd the panel.',side:'left'},
  ]);
  assert.match(reservations,/Mara: keep the left zone/);
  assert.match(reservations,/Eli: keep the right zone/);
  assert.doesNotMatch(reservations,/Package/);
});

test('vision placements are complete, normalized, and rejected when bubbles collide', () => {
  const dialogue = [
    {speaker:'Mara',line:'Did you hear that?'},
    {speaker:'Eli',line:'It came from below the floorboards.'},
  ];
  const placements = parseBubblePlacements(JSON.stringify({placements:[
    {index:0,side:'left',x:-20,y:5,width:5},
    {index:1,side:'right',x:62,y:40,width:80},
  ]}),dialogue);
  assert.deepEqual(placements,[
    {index:0,side:'left',layout:{x:2,y:5,width:20,source:'vision'}},
    {index:1,side:'right',layout:{x:62,y:40,width:34,source:'vision'}},
  ]);
  assert.equal(parseBubblePlacements(JSON.stringify({placements:[
    {index:0,side:'left',x:5,y:5,width:28},
    {index:1,side:'right',x:10,y:8,width:38},
  ]}),dialogue),null);
  assert.equal(parseBubblePlacements(JSON.stringify({placements:[
    {index:0,side:'center',x:5,y:5,width:28},
    {index:1,side:'right',x:62,y:40,width:28},
  ]}),dialogue),null);
});

test('post-generation vision sends the finished panel to Gateway and returns safe bubble placements', async () => {
  let request;
  const panel = comic().panels[1];
  const placements = await analyzePanelVisual({
    panel,
    imageDataUrl:png,
    userId:'alice',
    env:{AI_GATEWAY_API_KEY:'gateway-secret',STORY_STUDIO_VISION_MODEL:'openai/test-vision-model'},
    fetchFn:async (url,options) => {
      request = {url,options,body:JSON.parse(options.body)};
      return {ok:true,async json(){ return {choices:[{message:{content:'{"placements":[{"index":0,"side":"right","x":58,"y":8,"width":22}]}'}}]}; }};
    },
  });
  assert.equal(request.url,__internals.GATEWAY_IMAGE_ENDPOINT);
  assert.equal(request.body.model,'openai/test-vision-model');
  assert.equal(request.body.messages[0].content[1].image_url.url,png);
  assert.equal(request.body.providerOptions.gateway.user,'alice');
  assert.deepEqual(request.body.providerOptions.gateway.tags,['feature:story-studio-vision']);
  assert.deepEqual(placements,[{index:0,side:'right',layout:{x:58,y:8,width:22,source:'vision'}}]);
});

test('final lettering review judges the actual rendered composite and returns corrections', async () => {
  const panel = comic().panels[1];
  const prompt = buildPanelReviewPrompt({panel});
  assert.match(prompt,/ACTUAL finished mobile panel/);
  assert.match(prompt,/Never put a bubble directly over its speaker/);
  const parsed = parseLetteringReview('{"verdict":"corrected","placements":[{"index":0,"side":"left","x":4,"y":10,"width":24}]}',panel.dialogue);
  assert.equal(parsed.verdict,'corrected');
  assert.equal(parsed.placements[0].layout.x,4);

  let request;
  const review = await reviewPanelLettering({
    panel,
    previewDataUrl:png,
    userId:'alice',
    env:{AI_GATEWAY_API_KEY:'gateway-secret'},
    fetchFn:async (url,options) => {
      request = JSON.parse(options.body);
      return {ok:true,async json(){ return {choices:[{message:{content:'{"verdict":"pass","placements":[{"index":0,"side":"right","x":68,"y":6,"width":22}]}'}}]}; }};
    },
  });
  assert.equal(request.messages[0].content[1].image_url.url,png);
  assert.deepEqual(request.providerOptions.gateway.tags,['feature:story-studio-lettering-review']);
  assert.equal(review.verdict,'pass');
});

test('vision lettering reinspects the same pixels once after an invalid layout', async () => {
  let calls = 0;
  const placements = await analyzePanelVisual({
    panel:comic().panels[1],
    imageDataUrl:png,
    env:{AI_GATEWAY_API_KEY:'gateway-secret'},
    fetchFn:async (url,options) => {
      calls += 1;
      const prompt = JSON.parse(options.body).messages[0].content[0].text;
      if (calls === 2) assert.match(prompt,/first layout was rejected/);
      return {ok:true,async json(){ return {choices:[{message:{content:calls === 1 ? '{}' : '{"placements":[{"index":0,"side":"right","x":60,"y":8,"width":26}]}'}}]}; }};
    },
  });
  assert.equal(calls,2);
  assert.equal(placements[0].layout.width,26);
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
