import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdImageStore,validateImageInput,sniffImage,imageIdsOf,IMAGE_LIMITS} from '../lib/adImages.js';
import {renderAdPreview} from '../lib/adPreview.js';
import {validateProjectV2} from '../public/ad-vocabulary.mjs';
import {seedPlayerHtml,pickImages,projectImageIds} from '../lib/adExport.js';
import {readFileSync} from 'node:fs';

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const jpeg='data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0]).toString('base64');
const fake=()=>{const h=new Map();return {h,command:async parts=>{const [op,key,...rest]=parts;const m=h.get(key)||new Map();h.set(key,m);
  if(op==='HVALS')return [...m.values()];if(op==='HLEN')return m.size;if(op==='HSET'){m.set(rest[0],rest[1]);return 1;}
  if(op==='HGET')return m.get(rest[0])||null;if(op==='HDEL')return m.delete(rest[0])?1:0;throw new Error('unexpected '+op);}};};
const input=(extra={})=>({name:'Sunrise',description:'Cafe at dawn',source:'ai_generated',data_uri:PNG,...extra});

test('sniffImage recognises real picture bytes only',()=>{
  assert.equal(sniffImage(Buffer.from(PNG.split(',')[1],'base64')),'png');
  assert.equal(sniffImage(Buffer.from(jpeg.split(',')[1],'base64')),'jpeg');
  assert.equal(sniffImage(Buffer.from('<script>alert(1)</script>')),null);
});

test('validateImageInput accepts a real picture and rejects fakes, other types and oversize',()=>{
  const ok=validateImageInput(input());
  assert.equal(ok.mime,'image/png');assert.equal(ok.source,'ai_generated');assert.ok(ok.bytes>0);
  assert.throws(()=>validateImageInput(input({data_uri:'data:image/png;base64,'+Buffer.from('<html>').toString('base64')})),/not a real PNG/);
  assert.throws(()=>validateImageInput(input({data_uri:'data:image/svg+xml;base64,PHN2Zy8+'})),/PNG, JPEG or WebP/);
  assert.throws(()=>validateImageInput(input({data_uri:'https://example.com/a.png'})),/data URI/);
  assert.throws(()=>validateImageInput(input({data_uri:'data:image/png;base64,'+'A'.repeat(IMAGE_LIMITS.maxDataChars)})),/too large/);
  assert.throws(()=>validateImageInput(input({name:''})),/name is required/);
  assert.throws(()=>validateImageInput(input({source:'stock'})),/source must be/);
  assert.throws(()=>validateImageInput(input({name:'a\u0000b'})),/plain text/);
  assert.throws(()=>validateImageInput(input({thumb:'data:image/png;base64,'+'A'.repeat(IMAGE_LIMITS.maxThumbChars)})),/too large/);
});

test('store saves, lists metadata without picture data, resolves, and deletes',async()=>{
  const {command}=fake();let n=0;
  const store=createAdImageStore({command,now:()=>1000+n,newId:()=>'img-'+String(++n).padStart(4,'0')});
  const a=await store.save('justin',input({name:'One'}));
  const b=await store.save('justin',input({name:'Two',source:'uploaded',data_uri:jpeg}));
  assert.equal(a.saved,true);assert.equal(a.image_id,'img-0001');
  const list=await store.list('justin');
  assert.deepEqual(list.images.map(i=>i.name),['Two','One']);
  assert.ok(list.images.every(i=>!('data' in i)&&!('data_uri' in i)));
  const {images,missing}=await store.resolve('justin',['img-0001','img-0002','img-9999','bad id']);
  assert.deepEqual(Object.keys(images).sort(),['img-0001','img-0002']);
  assert.equal(images['img-0001'].source,'ai_generated');assert.equal(images['img-0002'].source,'uploaded');
  assert.deepEqual(missing,['img-9999']);
  assert.deepEqual(await store.remove('justin','img-0001'),{deleted:true,image_id:'img-0001'});
  await assert.rejects(store.remove('justin','img-0001'),/not found/);
  assert.equal((await store.list('someone-else')).images.length,0);
  assert.deepEqual(b.image_id,'img-0002');
});

test('store enforces the library size limit and needs an account',async()=>{
  const {command}=fake();let n=0;
  const store=createAdImageStore({command,newId:()=>'img-'+String(++n).padStart(4,'0')});
  for(let i=0;i<IMAGE_LIMITS.maxImages;i++)await store.save('u',input({name:'p'+i}));
  await assert.rejects(store.save('u',input()),/library is full/);
  await assert.rejects(store.list(''),/Authenticated account required/);
});

const ad=imageId=>({specVersion:2,name:'Pic ad · concept',brand:'Pic',initial:'P',mood:'bold',palette:'midnight-gold',platform:{format:'portrait',lengthSec:15},concept:true,scenes:[
  {id:'hook',type:'hook_text',duration:3,params:{headline:'Look',textAnim:'fade_up'},camera:'static',background:'solid',transitionOut:'crossfade',transitionMs:400},
  {id:'photo',type:'photo_focus',duration:4,params:{imageId,fit:'cover',caption:'Sample caption'},camera:'pull_out',background:'gradient'}]});

test('photo_focus accepts imageId and fit, and rejects a malformed id',()=>{
  const ok=validateProjectV2(ad('img-0a1b2c3d4e'));
  assert.ok(ok.ok,ok.errors&&ok.errors.join('; '));
  assert.equal(ok.value.scenes[1].params.imageId,'img-0a1b2c3d4e');
  const bad=validateProjectV2(ad('../../etc/passwd'));
  assert.equal(bad.ok,false);assert.match(bad.errors.join(';'),/imageId: must be an image id/);
  const full=ad('img-0a1b2c3d4e');full.scenes[1].params.fit='full';
  assert.ok(validateProjectV2(full).ok,'fit full is allowed');
  const badFit=ad('img-0a1b2c3d4e');badFit.scenes[1].params.fit='stretch';
  assert.equal(validateProjectV2(badFit).ok,false);
  const legacy=ad('img-0a1b2c3d4e');delete legacy.scenes[1].params.imageId;legacy.scenes[1].params.image='photo';
  assert.ok(validateProjectV2(legacy).ok,'old photo scenes still validate');
});

test('imageIdsOf lists the library images an ad uses',()=>{
  assert.deepEqual(imageIdsOf(ad('img-0a1b2c3d4e')),['img-0a1b2c3d4e']);
  assert.deepEqual(imageIdsOf({scenes:[{params:{}}]}),[]);
  assert.deepEqual(imageIdsOf(null),[]);
});

test('board preview embeds only the supplied images as inert JSON',async()=>{
  const project=ad('img-0a1b2c3d4e');
  const withImg=await renderAdPreview({project},{'img-0a1b2c3d4e':{src:PNG,source:'ai_generated'}});
  assert.match(withImg,/<script id="ad-images" type="application\/json">/);
  assert.match(withImg,/"source":"ai_generated"/);
  const without=await renderAdPreview({project});
  assert.doesNotMatch(without,/id="ad-images"/);
});

test('export seeding needs every referenced image and never trusts other fields',()=>{
  const project=ad('img-0a1b2c3d4e'),player=readFileSync(new URL('../public/ad-designs/vocabulary-player.html',import.meta.url),'utf8');
  assert.deepEqual(projectImageIds(project),['img-0a1b2c3d4e']);
  assert.throws(()=>seedPlayerHtml(player,project,{}),/Missing library images: img-0a1b2c3d4e/);
  assert.throws(()=>pickImages(project,{'img-0a1b2c3d4e':{src:'https://example.com/x.png'}}),/Missing library images/);
  const html=seedPlayerHtml(player,project,{'img-0a1b2c3d4e':{src:PNG,source:'ai_generated',extra:'<script>'},'img-other':{src:PNG}});
  assert.match(html,/id="ad-images"/);assert.doesNotMatch(html,/img-other/);assert.doesNotMatch(html,/"extra"/);
  const plain=seedPlayerHtml(player,{...project,scenes:[project.scenes[0],project.scenes[0]].map((s,i)=>({...s,id:'s'+i}))},{});
  assert.doesNotMatch(plain,/id="ad-images"/);
});

test('player renders library images from the ad-images block and labels AI pictures',()=>{
  const html=readFileSync(new URL('../public/ad-designs/vocabulary-player.html',import.meta.url),'utf8');
  assert.match(html,/getElementById\("ad-images"\)/);
  assert.match(html,/AI-generated image/);
  assert.match(html,/source==="ai_generated"/);
  assert.match(html,/P\.fit==="contain"/);
  assert.match(html,/P\.fit==="full"/);
  // pictures only ever come from data: URIs
  assert.match(html,/function safeImg/);
});
