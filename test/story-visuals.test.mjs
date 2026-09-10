import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryImageHandler } from '../api/story-image.js';
import { createStoryActorHandler } from '../api/story-actor.js';
import {
  analyzePanelVisual,
  buildActorPerformancePrompt,
  buildBackgroundPlatePrompt,
  buildBackgroundPlateVisionPrompt,
  buildBubbleReservations,
  buildCharacterIdentityPrompt,
  buildPanelVisualPrompt,
  buildPanelReviewPrompt,
  buildPanelVisionPrompt,
  createStoryVisualStore,
  generateActorVisual,
  generateBackgroundPlate,
  generatePanelVisual,
  inspectBackgroundPlate,
  parseBubblePlacements,
  parseBackgroundPlateInspection,
  parseLetteringReview,
  parsePanelVisualInspection,
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
    worldBible: {
      premise:'The package can copy a voice only after hearing it.',
      storyRules:['The package cannot move by itself.'],
      locations:[{name:'Last train',visualIdentity:'wet steel and violet emergency lights',continuity:'rear door remains jammed'}],
      recurringProps:[{name:'Package',appearance:'black case with cyan seam',continuity:'Mara carries it in her right hand'}],
      visualMotifs:['broken signal bars'],
      colorScript:['violet isolation becomes red danger'],
      animationLanguage:'Long holds followed by abrupt electronic motion.',
      soundLanguage:'Rain, rail hum, radio voices, and silence.',
    },
    characters: [
      { actorId:'mara', name:'Mara', role:'courier', appearance:'cropped dark hair and a red utility coat', continuity:'silver wrist band on the left arm' },
      { actorId:'package', name:'Package', role:'signal device', appearance:'black case with cyan seam', continuity:'Mara carries it' },
    ],
    panels: [
      { beat:'Mara arrives alone on a rain-soaked platform.', shot:'wide establishing shot', setting:'elevated train platform at midnight', artDirection:'rain and violet signals', dialogue:[] },
      { beat:'The package lights up and speaks her name.', shot:'extreme close-up', setting:'inside the last train', artDirection:'blue light across her startled face', scene:{actors:[{actorId:'package',name:'Package'}]}, dialogue:[{actorId:'package',speaker:'Package',line:'Mara.',side:'right'}] },
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
  assert.doesNotMatch(second,/Package \(right side\): Mara\./);
  assert.match(second,/STORY-SPECIFIC WORLD BIBLE/);
  assert.match(second,/rear door remains jammed/);
  assert.match(second,/Serve the story before spectacle/);
  assert.match(second,/UNPRINTED LETTERING SPACE/);
  assert.match(second,/upper right/);
  assert.doesNotMatch(second,/x=|\d+%/);
  assert.match(second,/invisible composition guidance/);
  assert.match(second,/Never draw words, letters, numerals, percentages/);
  assert.doesNotMatch(second,/Palette:|NEX COMIC DIRECTOR BIBLE v|panel 2 of 2|^\d+\.\s/m);
  assert.match(second,/genuinely new composition/);
  assert.match(second,/Return artwork only/);
  assert.notEqual(first,second);
});

test('the art department separates canonical cast, empty sets, and actor performances', () => {
  const identity = buildCharacterIdentityPrompt({comic:comic(),character:comic().characters[0]});
  const background = buildBackgroundPlatePrompt({comic:comic(),panel:comic().panels[1]});
  const performance = buildActorPerformancePrompt({
    comic:comic(),panel:comic().panels[1],actor:{name:'Mara',keyframes:[{pose:'recoiling',expression:'afraid',facing:'right'}]},
    character:comic().characters[0],hasIdentity:true,
  });
  assert.match(identity,/canonical reusable visual identity/i);
  assert.match(identity,/transparent alpha background/i);
  assert.match(background,/Do not draw any person, character, creature/i);
  assert.match(background,/only the set, atmosphere, lighting/i);
  assert.match(performance,/supplied identity image is binding/i);
  assert.match(performance,/Pose: recoiling/);
  assert.match(performance,/all pixels outside the actor transparent/i);
});

test('the set-continuity worker rejects people leaked into a background plate', async () => {
  const prompt = buildBackgroundPlateVisionPrompt({panel:comic().panels[1]});
  assert.match(prompt,/empty set/i);
  assert.match(prompt,/unauthorized person/i);
  assert.deepEqual(parseBackgroundPlateInspection('{"verdict":"regenerate","issues":["unauthorized_character"]}'),{
    verdict:'regenerate',issues:['unauthorized_character'],
  });
  let request;
  const inspection = await inspectBackgroundPlate({
    panel:comic().panels[1],imageDataUrl:png,userId:'alice',env:{AI_GATEWAY_API_KEY:'gateway-secret'},
    fetchFn:async (url,options) => {
      request = JSON.parse(options.body);
      return {ok:true,async json(){ return {choices:[{message:{content:'{"verdict":"regenerate","issues":["unauthorized_character"]}'}}]}; }};
    },
  });
  assert.deepEqual(inspection,{verdict:'regenerate',issues:['unauthorized_character']});
  assert.deepEqual(request.providerOptions.gateway.tags,['feature:story-studio-set-qa','role:set-continuity-worker']);
});

test('vision lettering prompt asks the Gateway to inspect actual pixels and return bounded coordinates', () => {
  const prompt = buildPanelVisionPrompt({panel:comic().panels[1]});
  assert.match(prompt,/professional letterer/);
  assert.match(prompt,/live-stage blocking supervisor/);
  assert.match(prompt,/package = Package/);
  assert.match(prompt,/Read the actual pixels/);
  assert.match(prompt,/"x":number,"y":number,"width":number/);
  assert.match(prompt,/Package.*Mara\./);
  assert.match(prompt,/never split in the middle/);
  assert.match(prompt,/width 20-26/);
  assert.match(prompt,/Never cover or touch any character's head/);
  assert.match(prompt,/MATCHED LETTERING EXAMPLE — close-up performance/);
});

test('lettering reservations are planned before art for at most two readable bubbles', () => {
  const reservations = buildBubbleReservations([
    {speaker:'Mara',line:'Did you hear that?',side:'left'},
    {speaker:'Eli',line:'It came from below the floorboards.',side:'right'},
    {speaker:'Package',line:'This third line must not crowd the panel.',side:'left'},
  ]);
  assert.match(reservations,/upper left/);
  assert.match(reservations,/upper right/);
  assert.doesNotMatch(reservations,/Mara|Eli|Package|x=|%/);
});

test('raw artwork inspection rejects generated numbers and blank lettering boxes', () => {
  assert.deepEqual(parsePanelVisualInspection(JSON.stringify({
    artwork:'regenerate',
    issues:['generated_text','blank_lettering_box'],
    placements:[],
  }),comic().panels[1].dialogue),{
    artwork:'regenerate',
    issues:['generated_text','blank_lettering_box'],
    actors:[],
    placements:[],
  });
  assert.equal(parsePanelVisualInspection('{"artwork":"regenerate","issues":[],"placements":[]}',comic().panels[1].dialogue),null);
});

test('raw artwork inspection gives the live stage actor bounds and speech anchors', () => {
  const panel = comic().panels[1];
  const inspection = parsePanelVisualInspection(JSON.stringify({
    artwork:'clean',issues:[],
    actors:[{actorId:'package',bounds:{x:60,y:40,width:20,height:30},faceAnchor:{x:70,y:48},speechAnchor:{x:72,y:22}}],
    placements:[{index:0,side:'right',x:65,y:8,width:22}],
  }),panel.dialogue,panel);
  assert.equal(inspection.actors[0].actorId,'package');
  assert.deepEqual(inspection.actors[0].speechAnchor,{x:72,y:22});
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
      return {ok:true,async json(){ return {choices:[{message:{content:'{"artwork":"clean","issues":[],"placements":[{"index":0,"side":"right","x":58,"y":8,"width":22}]}'}}]}; }};
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
  assert.match(prompt,/two pixel-accurate phone renders/i);
  assert.match(prompt,/Use IMAGE 1 to recover every face/i);
  assert.match(prompt,/Never put a bubble directly over its speaker/);
  assert.match(prompt,/face overlap as a failed panel/i);
  const parsed = parseLetteringReview('{"verdict":"corrected","placements":[{"index":0,"side":"left","x":4,"y":10,"width":24}]}',panel.dialogue);
  assert.equal(parsed.verdict,'corrected');
  assert.equal(parsed.placements[0].layout.x,4);

  let request;
  const review = await reviewPanelLettering({
    panel,
    cleanPreviewDataUrl:png,
    previewDataUrl:png,
    userId:'alice',
    env:{AI_GATEWAY_API_KEY:'gateway-secret'},
    fetchFn:async (url,options) => {
      request = JSON.parse(options.body);
      return {ok:true,async json(){ return {choices:[{message:{content:'{"verdict":"pass","placements":[{"index":0,"side":"right","x":68,"y":6,"width":22}]}'}}]}; }};
    },
  });
  assert.equal(request.messages[0].content[2].image_url.url,png);
  assert.equal(request.messages[0].content[4].image_url.url,png);
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
      return {ok:true,async json(){ return {choices:[{message:{content:calls === 1 ? '{}' : '{"artwork":"clean","issues":[],"placements":[{"index":0,"side":"right","x":60,"y":8,"width":26}]}'}}]}; }};
    },
  });
  assert.equal(calls,2);
  assert.equal(placements[0].layout.width,26);
});

test('image generation uses Gateway image modalities and can carry the first panel as reference', async () => {
  let request;
  const referenceImage = parseImageDataUrl(png);
  const result = await generatePanelVisual({
    comic:comic(), panel:comic().panels[1], panelIndex:1, referenceImage, correctionIssues:['generated_text'],
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
  assert.match(request.body.messages[0].content[0].text,/prior attempt contained accidental printed characters/i);
  assert.equal(result.dataUrl,png);
  assert.equal(result.model,'google/test-image-model');
});

test('layer generation uses a clean set request and transparent actor image contracts', async () => {
  const requests = [];
  const fetchFn = async (url,options) => {
    const body = JSON.parse(options.body); requests.push({url,body});
    if (url === __internals.GATEWAY_IMAGE_ENDPOINT) {
      return {ok:true,async json(){return {choices:[{message:{images:[{image_url:{url:png}}]}}],usage:{total_tokens:4}};}};
    }
    return {ok:true,async json(){return {data:[{b64_json:Buffer.from('transparent-actor').toString('base64')}],usage:{total_tokens:8}};}};
  };
  const background = await generateBackgroundPlate({comic:comic(),panel:comic().panels[1],panelIndex:1,userId:'alice',env:{AI_GATEWAY_API_KEY:'secret'},fetchFn});
  const identity = await generateActorVisual({comic:comic(),character:comic().characters[0],userId:'alice',env:{AI_GATEWAY_API_KEY:'secret'},fetchFn});
  const actor = await generateActorVisual({
    comic:comic(),panel:comic().panels[1],actor:{name:'Mara',keyframes:[{pose:'recoiling'}]},character:comic().characters[0],
    referenceImage:parseImageDataUrl(png),userId:'alice',env:{AI_GATEWAY_API_KEY:'secret'},fetchFn,
  });
  assert.equal(background.kind,'background');
  assert.equal(identity.kind,'identity');
  assert.equal(actor.kind,'actor');
  assert.equal(requests[1].url,__internals.GATEWAY_IMAGE_GENERATION_ENDPOINT);
  assert.equal(requests[1].body.background,'transparent');
  assert.equal(requests[1].body.output_format,'png');
  assert.equal(requests[2].url,__internals.GATEWAY_IMAGE_EDIT_ENDPOINT);
  assert.match(requests[2].body.images[0].image_url,/^data:image\/png;base64,/);
  assert.ok(background.generationId);
  assert.ok(identity.generationId);
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
  await store.saveIdentity('alice','story-1','mara',{dataUrl:png,model:'actor-model',generationId:'identity-1'});
  await store.saveActor('alice','story-1',0,'mara',{dataUrl:png,model:'actor-model',generationId:'actor-1'});
  assert.equal((await store.get('alice','story-1',0)).generatedAt,1234);
  assert.equal((await store.getIdentity('alice','story-1','mara')).generationId,'identity-1');
  assert.equal((await store.getActor('alice','story-1',0,'mara')).generationId,'actor-1');
  assert.equal(await store.get('bob','story-1',0),null);
  assert.equal(await store.deleteProject('alice','story-1',{characters:[{actorId:'mara'}]}),3);
  assert.equal(await store.get('alice','story-1',0),null);
});

test('private actor delivery verifies project ownership and serves either identity or performance art', async () => {
  const actorStore = {
    async getIdentity(){return {mediaType:'image/png',base64:Buffer.from('identity').toString('base64')};},
    async getActor(){return {mediaType:'image/png',base64:Buffer.from('performance').toString('base64')};},
  };
  const handler = createStoryActorHandler({resolveUser:async () => 'alice',projectStore:{async getProject(){return {id:'story-1'};}},visualStore:actorStore});
  const identityRes = response();
  await handler({method:'GET',query:{id:'story-1',actor:'mara',kind:'identity'}},identityRes);
  assert.equal(identityRes.bytes.toString(),'identity');
  const performanceRes = response();
  await handler({method:'GET',query:{id:'story-1',panel:'2',actor:'mara',kind:'performance'}},performanceRes);
  assert.equal(performanceRes.bytes.toString(),'performance');
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
