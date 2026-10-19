import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAdMediaStore,sniffMedia,MEDIA_LIMITS,validateBegin} from '../lib/adMedia.js';

const PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG=Buffer.from(PNG_B64,'base64');
const sha=b=>createHash('sha256').update(b).digest('hex');
const fake=()=>{const h=new Map();return {h,command:async parts=>{const [op,key,...r]=parts;const m=h.get(key)||new Map();
  if(op==='HSET'){h.set(key,m);m.set(r[0],r[1]);return 1;}
  if(op==='HGET')return m.get(r[0])??null;if(op==='HVALS')return [...m.values()];if(op==='HLEN')return m.size;
  if(op==='HEXISTS')return m.has(r[0])?1:0;if(op==='HDEL')return m.delete(r[0])?1:0;if(op==='DEL')return h.delete(key)?1:0;
  throw new Error('unexpected '+op);}};};
const store=()=>{const f=fake();let n=0;return {f,s:createAdMediaStore({command:f.command,now:()=>1000+n,newId:()=>'med-'+String(++n).padStart(6,'0')})};};
// A fake mp4: ftyp box then filler, big enough to need several chunks.
const mp4=(size)=>{const b=Buffer.alloc(size,7);b.writeUInt32BE(24,0);b.write('ftypisom',4,'latin1');return b;};

test('sniffMedia recognises images, audio and video by their bytes',()=>{
  assert.equal(sniffMedia(PNG).mime,'image/png');
  assert.equal(sniffMedia(Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVEfmt ')])).mime,'audio/wav');
  assert.equal(sniffMedia(Buffer.concat([Buffer.from('ID3'),Buffer.alloc(20)])).kind,'audio');
  assert.equal(sniffMedia(mp4(64)).mime,'video/mp4');
  assert.equal(sniffMedia(Buffer.from('<script>alert(1)</script>')),null);
});

test('a multi-chunk upload is stored byte for byte and verified',async()=>{
  const {s}=store(),file=mp4(MEDIA_LIMITS.chunkBytes*2+1234);
  const b=await s.begin('justin',{name:'Footage',kind:'video',bytes:file.length,sha256:sha(file),seconds:12.5});
  assert.equal(b.chunks,3);assert.equal(b.status,'uploading');
  for(let i=0;i<3;i++){const part=file.subarray(i*MEDIA_LIMITS.chunkBytes,(i+1)*MEDIA_LIMITS.chunkBytes);await s.putChunk('justin',b.media_id,i,part.toString('base64'));}
  const done=await s.finish('justin',b.media_id);
  assert.equal(done.status,'ready');assert.equal(done.mime,'video/mp4');assert.equal(done.bytes,file.length);
  const back=await s.bytes('justin',b.media_id);
  assert.ok(back.buffer.equals(file),'downloaded bytes equal the original');
  const c=await s.getChunk('justin',b.media_id,2);assert.equal(c.chunks,3);
});

test('finish rejects damaged, incomplete and mislabelled uploads',async()=>{
  const {s}=store(),file=mp4(2000);
  let b=await s.begin('u',{name:'A',kind:'video',bytes:file.length,sha256:sha(Buffer.from('other'))});
  await s.putChunk('u',b.media_id,0,file.toString('base64'));
  await assert.rejects(s.finish('u',b.media_id),/checksum/);
  b=await s.begin('u',{name:'B',kind:'audio',bytes:file.length,sha256:sha(file)});
  await s.putChunk('u',b.media_id,0,file.toString('base64'));
  await assert.rejects(s.finish('u',b.media_id),/not a real audio file \(looks like video\)/);
  const big=mp4(MEDIA_LIMITS.chunkBytes+10);
  b=await s.begin('u',{name:'C',kind:'video',bytes:big.length,sha256:sha(big)});
  await s.putChunk('u',b.media_id,0,big.subarray(0,MEDIA_LIMITS.chunkBytes).toString('base64'));
  await assert.rejects(s.finish('u',b.media_id),/Chunk 1 is missing/);
  await assert.rejects(s.putChunk('u',b.media_id,1,Buffer.alloc(5).toString('base64')),/must be 10 bytes/);
});

test('input checks: size, checksum, kind, preview, limits',async()=>{
  assert.throws(()=>validateBegin({name:'x',kind:'video',bytes:MEDIA_LIMITS.maxAssetBytes+1,sha256:'a'.repeat(64)}),/too large/);
  assert.throws(()=>validateBegin({name:'x',kind:'gif',bytes:100,sha256:'a'.repeat(64)}),/kind must be/);
  assert.throws(()=>validateBegin({name:'x',kind:'image',bytes:100,sha256:'zz'}),/sha256/);
  assert.throws(()=>validateBegin({name:'x',kind:'image',bytes:100,sha256:'a'.repeat(64),preview:'data:image/png;base64,'+Buffer.from('<html>').toString('base64')}),/not a real PNG/);
  const {s}=store();
  for(let i=0;i<MEDIA_LIMITS.maxAssets;i++)await s.begin('u',{name:'n'+i,kind:'image',bytes:100,sha256:'a'.repeat(64)});
  await assert.rejects(s.begin('u',{name:'extra',kind:'image',bytes:100,sha256:'a'.repeat(64)}),/library is full/);
});

test('save stores a small file in one call and resolveImages returns the original, never the preview',async()=>{
  const {s}=store();
  const m=await s.save('justin',{name:'Pixel',data_base64:PNG_B64});
  assert.equal(m.status,'ready');assert.equal(m.kind,'image');
  const r=await s.resolveImages('justin',[m.media_id,'med-nothere1','img-0a1b2c3d4e']);
  assert.equal(r.images[m.media_id].original,true);
  assert.equal(r.images[m.media_id].src,'data:image/png;base64,'+PNG_B64);
  assert.deepEqual(r.missing,['med-nothere1']);
});

test('accounts are separate; list shows metadata and usage; remove deletes the chunks',async()=>{
  const {s,f}=store();
  const a=await s.save('a',{name:'One',data_base64:PNG_B64});
  assert.equal((await s.list('b')).media.length,0);
  await assert.rejects(s.read('b',a.media_id),/not found/);
  const l=await s.list('a');assert.equal(l.media.length,1);assert.equal(l.used_bytes,PNG.length);assert.equal('data' in l.media[0],false);
  await s.remove('a',a.media_id);
  assert.equal((await s.list('a')).media.length,0);
  assert.equal([...f.h.keys()].filter(k=>k.includes('chunks')).length,0);
  await assert.rejects(s.remove('a',a.media_id),/not found/);
});
