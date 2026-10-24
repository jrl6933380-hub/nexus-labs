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

test('resolveImages returns video clips as data URIs (for footage layers) but not audio or clips over the inline limit',async()=>{
  const {s}=store();
  const put=async(kind,file)=>{const b=await s.begin('justin',{name:kind+file.length,kind,bytes:file.length,sha256:sha(file)});
    for(let i=0;i<b.chunks;i++)await s.putChunk('justin',b.media_id,i,file.subarray(i*MEDIA_LIMITS.chunkBytes,(i+1)*MEDIA_LIMITS.chunkBytes).toString('base64'));
    return (await s.finish('justin',b.media_id)).media_id;};
  const small=mp4(5000),clip=await put('video',small);
  const big=await put('video',mp4(MEDIA_LIMITS.maxInlineImageBytes+1000));
  const wav=await put('audio',Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVEfmt '),Buffer.alloc(200)]));
  const r=await s.resolveImages('justin',[clip,big,wav]);
  assert.equal(r.images[clip].src,'data:video/mp4;base64,'+small.toString('base64'));
  assert.equal(r.images[clip].original,true);
  assert.deepEqual(r.missing.sort(),[big,wav].sort());
});

test('resolveImages with clips:false skips video clips (they exist, so they are not missing) but still reports unknown ids',async()=>{
  const {s}=store();
  const file=mp4(5000),b=await s.begin('justin',{name:'Clip',kind:'video',bytes:file.length,sha256:sha(file)});
  await s.putChunk('justin',b.media_id,0,file.toString('base64'));await s.finish('justin',b.media_id);
  const png=await s.save('justin',{name:'Pixel',data_base64:PNG_B64});
  const r=await s.resolveImages('justin',[b.media_id,png.media_id,'med-nothere1'],{clips:false});
  assert.deepEqual(Object.keys(r.images),[png.media_id]);
  assert.deepEqual(r.missing,['med-nothere1']);
});

test('with clips:false a clip that has a poster still comes back as that still, never the video bytes',async()=>{
  const {s}=store();
  const file=mp4(5000),poster='data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3]).toString('base64');
  const b=await s.begin('justin',{name:'Clip',kind:'video',bytes:file.length,sha256:sha(file),preview:poster});
  await s.putChunk('justin',b.media_id,0,file.toString('base64'));await s.finish('justin',b.media_id);
  const r=await s.resolveImages('justin',[b.media_id],{clips:false});
  assert.deepEqual(r.images[b.media_id],{src:poster,source:'uploaded',original:false});
  assert.deepEqual(r.missing,[]);
});

test('a clip may carry a larger poster than a photo preview; lists leave a big poster out but say it exists, read returns it',async()=>{
  const {s}=store();
  const jpegOf=n=>'data:image/jpeg;base64,'+Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(n,1)]).toString('base64');
  const file=mp4(5000),big=jpegOf(80000),small=jpegOf(1000);
  assert.ok(big.length>MEDIA_LIMITS.maxPreviewChars&&big.length<=MEDIA_LIMITS.maxPosterChars);
  await assert.rejects(s.begin('justin',{name:'Photo',kind:'image',bytes:100,sha256:'a'.repeat(64),preview:big}),/preview is too large/);
  await assert.rejects(s.begin('justin',{name:'Huge',kind:'video',bytes:file.length,sha256:sha(file),preview:jpegOf(120000)}),/preview is too large/);
  const mk=async(preview)=>{const b=await s.begin('justin',{name:'Clip',kind:'video',bytes:file.length,sha256:sha(file),preview});await s.putChunk('justin',b.media_id,0,file.toString('base64'));await s.finish('justin',b.media_id);return b.media_id;};
  const idBig=await mk(big),idSmall=await mk(small);
  const l=(await s.list('justin')).media,byId=Object.fromEntries(l.map(m=>[m.media_id,m]));
  assert.equal(byId[idBig].preview,'');assert.equal(byId[idBig].has_poster,true);
  assert.equal(byId[idSmall].preview,small);assert.equal('has_poster' in byId[idSmall],false);
  assert.equal((await s.read('justin',idBig)).preview,big);
  assert.equal((await s.resolveImages('justin',[idBig],{clips:false})).images[idBig].src,big);
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
