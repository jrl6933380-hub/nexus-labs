import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdMediaStore,MEDIA_LIMITS} from '../lib/adMedia.js';
import {createAdRenderLinks,createRenderPersist,posterFromVideo} from '../lib/adRenderPersist.js';
import {runJob} from '../lib/adRenderWorker.js';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const fake=()=>{const h=new Map();return {h,command:async parts=>{const [op,key,...r]=parts;const m=h.get(key)||new Map();
  if(op==='HSET'){h.set(key,m);m.set(r[0],r[1]);return 1;}
  if(op==='HGET')return m.get(r[0])??null;if(op==='HVALS')return [...m.values()];if(op==='HLEN')return m.size;
  if(op==='HEXISTS')return m.has(r[0])?1:0;if(op==='HDEL')return m.delete(r[0])?1:0;if(op==='DEL')return h.delete(key)?1:0;
  throw new Error('unexpected '+op);}};};
const mp4=(size,fill=7)=>{const b=Buffer.alloc(size,fill);b.writeUInt32BE(24,0);b.write('ftypisom',4,'latin1');return b;};
const JPEG='data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0]).toString('base64');
const setup=(poster=async()=>JPEG)=>{const f=fake();let n=0;
  const media=createAdMediaStore({command:f.command,now:()=>1000,newId:()=>'med-'+String(++n).padStart(6,'0')});
  const links=createAdRenderLinks({command:f.command});
  return {media,links,persist:createRenderPersist({media,links,poster})};};
const job=(o={})=>({job_id:'rnd-aaaaaa',kind:'mp4',campaign_id:'ad-1',options:{quality:'final'},...o});

test('a finished MP4 is saved to the media library and linked to its ad',async()=>{
  const {media,links,persist}=setup(),file=mp4(MEDIA_LIMITS.chunkBytes*2+99);
  const rec=await persist({user:'u',job:job(),project:{name:'Peaceful'},buffer:file,path:'x.mp4',result:{width:1080,height:1920,duration_sec:15}});
  assert.equal(rec.campaign_id,'ad-1');assert.equal(rec.chunks,3);
  assert.deepEqual((await links.get('u','ad-1')).media_id,rec.media_id);
  const back=await media.bytes('u',rec.media_id);assert.ok(back.buffer.equals(file));
  const meta=await media.read('u',rec.media_id);assert.equal(meta.kind,'video');assert.equal(meta.preview,JPEG);assert.equal(meta.name,'Render: Peaceful');assert.equal(meta.width,1080);
});

test('a newer render replaces the old copy; a preview never replaces a kept render',async()=>{
  const {media,links,persist}=setup();
  const a=await persist({user:'u',job:job(),project:{name:'P'},buffer:mp4(5000,1),path:'x',result:{}});
  assert.equal(await persist({user:'u',job:job({job_id:'rnd-bbbbbb',options:{quality:'preview'}}),project:{name:'P'},buffer:mp4(5000,2),path:'x',result:{}}),null);
  const b=await persist({user:'u',job:job({job_id:'rnd-cccccc'}),project:{name:'P'},buffer:mp4(5000,3),path:'x',result:{}});
  assert.notEqual(a.media_id,b.media_id);
  await assert.rejects(()=>media.read('u',a.media_id),/not found/i);
  assert.equal((await links.get('u','ad-1')).media_id,b.media_id);
  assert.equal((await links.list('u')).length,1);
});

test('non-MP4 jobs and jobs with no ad are ignored; a poster failure still saves the video',async()=>{
  const {links,persist}=setup(async()=>{throw new Error('no ffmpeg');});
  assert.equal(await persist({user:'u',job:job({kind:'still'}),project:{},buffer:mp4(100),path:'x',result:{}}),null);
  assert.equal(await persist({user:'u',job:job({campaign_id:null}),project:{},buffer:mp4(100),path:'x',result:{}}),null);
  const rec=await persist({user:'u',job:job(),project:{name:'P'},buffer:mp4(2000),path:'x',result:{}});
  assert.ok(rec&&(await links.get('u','ad-1')));
});

test('runJob keeps the MP4 but a keep failure never fails the render',async()=>{
  const calls=[];
  const store={progress:async()=>({}),putFile:async(u,id,f)=>calls.push('put:'+f.name),complete:async(u,id,r)=>{calls.push('complete');return {status:'succeeded'};},fail:async(u,id,e)=>{calls.push('fail:'+e.code);return {status:'failed'};}};
  const runner=async()=>({files:[{name:'ad.mp4',buffer:mp4(100),mime:'video/mp4'}],result:{width:1}});
  const claimed={user:'u',job:job(),project:{scenes:[]}};
  let kept=0;
  await runJob({store,claimed,runner,persist:async()=>{kept++;}});
  assert.equal(kept,1);assert.ok(calls.includes('complete'));
  calls.length=0;
  await runJob({store,claimed,runner,persist:async()=>{throw new Error('library full');}});
  assert.ok(calls.includes('complete'));assert.ok(!calls.some(c=>c.startsWith('fail')));
});

test('posterFromVideo makes a small JPEG from a real video',async t=>{
  if(spawnSync('ffmpeg',['-version']).status!==0)return t.skip('ffmpeg not installed');
  const dir=mkdtempSync(join(tmpdir(),'poster-test-')),path=join(dir,'v.mp4');
  const r=spawnSync('ffmpeg',['-y','-loglevel','error','-f','lavfi','-i','testsrc=size=1080x1920:rate=30:duration=2','-pix_fmt','yuv420p',path]);
  assert.equal(r.status,0,String(r.stderr));
  const uri=await posterFromVideo(path);
  assert.match(uri,/^data:image\/jpeg;base64,/);assert.ok(uri.length<MEDIA_LIMITS.maxPreviewChars,'poster fits a normal list preview, '+uri.length);
});
