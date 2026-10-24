// Durable original-media store for Ad Maker: images, audio and footage are saved byte for byte, in chunks, with a
// checksum, and a small preview is stored beside each one. The 100 KB image library and the track library keep working
// as before; this is where the real files live, so a render can use the original and the agent and the board see the
// same asset. Pure validation plus an injectable store (same shape as lib/adImages.js), so it runs anywhere.
//
// Upload is three steps, because one tool call cannot carry megabytes: begin_media (name, kind, bytes, sha256) ->
// put_media_chunk (index, base64 of up to 384 KB) repeated -> finish_media (checks size, checksum and real file type).
// A media id looks like "med-1a2b3c4d5e" and fits the vocabulary's imageId pattern, so an image asset can be used as a
// graphic layer's or photo scene's imageId directly; exports then resolve the original instead of a shrunken copy.
import {randomBytes,createHash} from 'node:crypto';

export const MEDIA_LIMITS=Object.freeze({
  maxAssets:60,
  maxAssetBytes:64*1024*1024,
  maxAccountBytes:256*1024*1024,
  chunkBytes:384*1024,
  maxPreviewChars:60000,
  name:80,
  description:240,
  maxInlineImageBytes:12*1024*1024, // largest original that export will inline as a data URI
});
export const MEDIA_KINDS=Object.freeze(['image','audio','video']);
const ID=/^med-[a-z0-9]{6,16}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const SHA=/^[a-f0-9]{64}$/;
const fail=(message,status=400,code='MEDIA_INVALID')=>Object.assign(new Error(message),{status,code});
const metaKey=user=>{if(typeof user!=='string'||!user)throw fail('Authenticated account required.',401,'UNAUTHORIZED');return 'nexus:ad-media:v1:'+encodeURIComponent(user);};
const chunkKey=(user,id)=>`nexus:ad-media-chunks:v1:${encodeURIComponent(user)}:${id}`;
const DATA_URI=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** The real type of a file from its first bytes. Returns {kind,mime,ext} or null. */
export function sniffMedia(b){
  const s=(from,to)=>b.subarray(from,to).toString('latin1');
  if(b.length>8&&b[0]===0x89&&s(1,4)==='PNG')return {kind:'image',mime:'image/png',ext:'png'};
  if(b.length>3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return {kind:'image',mime:'image/jpeg',ext:'jpg'};
  if(b.length>12&&s(0,4)==='RIFF'&&s(8,12)==='WEBP')return {kind:'image',mime:'image/webp',ext:'webp'};
  if(b.length>12&&s(0,4)==='RIFF'&&s(8,12)==='WAVE')return {kind:'audio',mime:'audio/wav',ext:'wav'};
  if(b.length>3&&(s(0,3)==='ID3'||(b[0]===0xff&&(b[1]&0xe0)===0xe0)))return {kind:'audio',mime:'audio/mpeg',ext:'mp3'};
  if(b.length>4&&s(0,4)==='OggS')return {kind:'audio',mime:'audio/ogg',ext:'ogg'};
  if(b.length>3&&b[0]===0x1a&&b[1]===0x45&&b[2]===0xdf&&b[3]===0xa3)return {kind:'video',mime:'video/webm',ext:'webm'};
  if(b.length>12&&s(4,8)==='ftyp'){
    const brand=s(8,12);
    if(/^(M4A |M4B |f4a )/.test(brand))return {kind:'audio',mime:'audio/mp4',ext:'m4a'};
    if(brand==='qt  ')return {kind:'video',mime:'video/quicktime',ext:'mov'};
    return {kind:'video',mime:'video/mp4',ext:'mp4'};
  }
  return null;
}
const clean=(v,max,label,{required=false}={})=>{
  if(v===undefined||v===null||v==='') {if(required)throw fail(`${label} is required.`);return '';}
  if(typeof v!=='string'||CONTROL.test(v))throw fail(`${label} must be plain text.`);
  const t=v.trim();
  if(required&&!t)throw fail(`${label} is required.`);
  if([...t].length>max)throw fail(`${label} is too long (max ${max} characters).`);
  return t;
};
export function checkPreview(value){
  if(value===undefined||value===null||value==='')return '';
  if(typeof value!=='string'||value.length>MEDIA_LIMITS.maxPreviewChars)throw fail(`preview is too large (limit ${Math.round(MEDIA_LIMITS.maxPreviewChars/1000)} KB as a data URI).`);
  const m=DATA_URI.exec(value);
  if(!m)throw fail('preview must be a base64 PNG, JPEG or WebP data URI.');
  const real=sniffMedia(Buffer.from(m[2],'base64'));
  if(!real||real.mime!=='image/'+m[1])throw fail('preview contents are not a real '+m[1].toUpperCase()+' picture.');
  return value;
}
const publicMeta=r=>({media_id:r.media_id,name:r.name,kind:r.kind,mime:r.mime,bytes:r.bytes,sha256:r.sha256,status:r.status,description:r.description,
  chunks:r.chunks,received_chunks:r.received??undefined,width:r.width,height:r.height,seconds:r.seconds,preview:r.preview||'',created_at:r.created_at,ready_at:r.ready_at});
const num=(v,label,min,max,int=false)=>{if(v===undefined||v===null)return undefined;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(int&&!Number.isInteger(v)))throw fail(`${label} must be ${int?'a whole ':'a '}number from ${min} to ${max}.`);return v;};

export function validateBegin(input){
  const name=clean(input.name,MEDIA_LIMITS.name,'name',{required:true});
  const description=clean(input.description,MEDIA_LIMITS.description,'description');
  const kind=input.kind;
  if(!MEDIA_KINDS.includes(kind))throw fail(`kind must be one of ${MEDIA_KINDS.join(', ')}.`);
  const bytes=input.bytes;
  if(!Number.isInteger(bytes)||bytes<16)throw fail('bytes must be the whole file size in bytes.');
  if(bytes>MEDIA_LIMITS.maxAssetBytes)throw fail(`File is too large (${Math.round(bytes/1048576)} MB, limit ${Math.round(MEDIA_LIMITS.maxAssetBytes/1048576)} MB).`,413,'MEDIA_TOO_LARGE');
  const sha256=String(input.sha256||'').toLowerCase();
  if(!SHA.test(sha256))throw fail('sha256 must be the 64-character hex SHA-256 of the whole file.');
  return {name,description,kind,bytes,sha256,preview:checkPreview(input.preview),
    width:num(input.width,'width',1,20000,true),height:num(input.height,'height',1,20000,true),seconds:num(input.seconds,'seconds',0.1,36000)};
}

export function createAdMediaStore({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts),now=Date.now,newId=()=>'med-'+randomBytes(5).toString('hex')}={}){
  const readMeta=async(user,id)=>{
    if(typeof id!=='string'||!ID.test(id))throw fail('A valid media_id is required.');
    const raw=await command(['HGET',metaKey(user),id]);
    if(!raw)throw fail('Media not found in your library.',404,'MEDIA_NOT_FOUND');
    return JSON.parse(raw);
  };
  const writeMeta=(user,r)=>command(['HSET',metaKey(user),r.media_id,JSON.stringify(r)]);
  const all=async user=>(await command(['HVALS',metaKey(user)])||[]).map(raw=>JSON.parse(raw));
  const chunkCount=bytes=>Math.ceil(bytes/MEDIA_LIMITS.chunkBytes);
  async function begin(user,input){
    const v=validateBegin(input),rows=await all(user);
    if(rows.length>=MEDIA_LIMITS.maxAssets)throw fail(`Your media library is full (${MEDIA_LIMITS.maxAssets} files). Delete one first.`,409,'MEDIA_LIMIT');
    const used=rows.reduce((n,r)=>n+r.bytes,0);
    if(used+v.bytes>MEDIA_LIMITS.maxAccountBytes)throw fail(`This would pass your storage limit (${Math.round(MEDIA_LIMITS.maxAccountBytes/1048576)} MB). Delete something first.`,409,'MEDIA_QUOTA');
    const media_id=newId();
    if(!ID.test(media_id))throw fail('Could not create a media id.',500,'MEDIA_ID');
    const record={media_id,status:'uploading',created_at:now(),mime:'',chunks:chunkCount(v.bytes),received:0,...v};
    await writeMeta(user,record);
    return {...publicMeta(record),chunk_bytes:MEDIA_LIMITS.chunkBytes,begun:true};
  }
  async function putChunk(user,id,index,data){
    const r=await readMeta(user,id);
    if(r.status!=='uploading')throw fail('This upload is already finished.',409,'MEDIA_FINISHED');
    if(!Number.isInteger(index)||index<0||index>=r.chunks)throw fail(`index must be a whole number from 0 to ${r.chunks-1}.`);
    if(typeof data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw fail('data must be base64.');
    const len=Buffer.from(data,'base64').length,expect=index<r.chunks-1?MEDIA_LIMITS.chunkBytes:r.bytes-MEDIA_LIMITS.chunkBytes*(r.chunks-1);
    if(len!==expect)throw fail(`Chunk ${index} must be ${expect} bytes (got ${len}). Split the file into ${MEDIA_LIMITS.chunkBytes}-byte pieces.`);
    const had=await command(['HEXISTS',chunkKey(user,id),String(index)]);
    await command(['HSET',chunkKey(user,id),String(index),data]);
    if(!Number(had)){r.received=(r.received||0)+1;await writeMeta(user,r);}
    return {media_id:id,index,received_chunks:r.received,chunks:r.chunks};
  }
  async function readBytes(user,r){
    const parts=[];
    for(let i=0;i<r.chunks;i++){
      const c=await command(['HGET',chunkKey(user,r.media_id),String(i)]);
      if(!c)throw fail(`Chunk ${i} is missing.`,409,'MEDIA_INCOMPLETE');
      parts.push(Buffer.from(c,'base64'));
    }
    return Buffer.concat(parts);
  }
  async function finish(user,id){
    const r=await readMeta(user,id);
    if(r.status==='ready')return {...publicMeta(r),finished:true};
    const buf=await readBytes(user,r);
    if(buf.length!==r.bytes)throw fail(`Received ${buf.length} bytes but expected ${r.bytes}.`,409,'MEDIA_SIZE');
    if(createHash('sha256').update(buf).digest('hex')!==r.sha256)throw fail('The checksum does not match: the file was changed or damaged in transfer. Upload it again.',409,'MEDIA_CHECKSUM');
    const real=sniffMedia(buf);
    if(!real||real.kind!==r.kind)throw fail(`The file contents are not a real ${r.kind} file${real?` (looks like ${real.kind})`:''}.`);
    r.mime=real.mime;r.status='ready';r.ready_at=now();delete r.received;
    await writeMeta(user,r);
    return {...publicMeta(r),finished:true};
  }
  /** Small files in one call (previews, short sounds): data_uri of an image, or base64 of any supported file. */
  async function save(user,input){
    const b64=typeof input.data_base64==='string'?input.data_base64:(DATA_URI.exec(input.data_uri||'')||[])[2];
    if(!b64||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64))throw fail('Provide data_uri (an image) or data_base64.');
    const buf=Buffer.from(b64,'base64'),real=sniffMedia(buf);
    if(!real)throw fail('Unsupported or unrecognised file type.');
    if(buf.length>MEDIA_LIMITS.chunkBytes)throw fail(`Too large for one call (limit ${MEDIA_LIMITS.chunkBytes} bytes). Use begin_media and put_media_chunk.`,413,'MEDIA_TOO_LARGE');
    const sha=createHash('sha256').update(buf).digest('hex');
    const b=await begin(user,{...input,kind:real.kind,bytes:buf.length,sha256:sha,preview:input.preview||(real.kind==='image'&&buf.length*4/3<MEDIA_LIMITS.maxPreviewChars?`data:${real.mime};base64,${b64}`:'')});
    await putChunk(user,b.media_id,0,b64);
    return finish(user,b.media_id);
  }
  return {
    begin,putChunk,finish,save,
    async list(user){
      const rows=(await all(user)).sort((a,b)=>b.created_at-a.created_at);
      return {media:rows.map(publicMeta),limits:{maxAssets:MEDIA_LIMITS.maxAssets,maxAssetBytes:MEDIA_LIMITS.maxAssetBytes,maxAccountBytes:MEDIA_LIMITS.maxAccountBytes,chunkBytes:MEDIA_LIMITS.chunkBytes},used_bytes:rows.reduce((n,r)=>n+r.bytes,0)};
    },
    async read(user,id){return publicMeta(await readMeta(user,id));},
    /** One piece of the original, for download. The whole file is the chunks 0..chunks-1 joined in order. */
    async getChunk(user,id,index){
      const r=await readMeta(user,id);
      if(r.status!=='ready')throw fail('This file is still uploading.',409,'MEDIA_NOT_READY');
      if(!Number.isInteger(index)||index<0||index>=r.chunks)throw fail(`index must be a whole number from 0 to ${r.chunks-1}.`);
      const data=await command(['HGET',chunkKey(user,id),String(index)]);
      if(!data)throw fail('Chunk is missing.',409,'MEDIA_INCOMPLETE');
      return {media_id:id,index,chunks:r.chunks,sha256:r.sha256,data_base64:data};
    },
    async bytes(user,id){const r=await readMeta(user,id);if(r.status!=='ready')throw fail('This file is still uploading.',409,'MEDIA_NOT_READY');return {meta:publicMeta(r),buffer:await readBytes(user,r)};},
    async remove(user,id){
      const r=await readMeta(user,id);
      await command(['DEL',chunkKey(user,id)]);
      await command(['HDEL',metaKey(user),id]);
      return {deleted:true,media_id:r.media_id};
    },
    /** {id:{src,source,original:true}} for the media ids asked for: the ORIGINAL image as a data URI (never the preview). */
    async resolveImages(user,ids,{clips=true}={}){
      const images={},missing=[];
      for(const id of [...new Set(ids)].filter(i=>ID.test(i))){
        let r;try{r=await readMeta(user,id);}catch(e){if(e.status===404){missing.push(id);continue;}throw e;}
        if(r.status!=='ready'||(r.kind!=='image'&&r.kind!=='video')){missing.push(id);continue;}
        if(r.kind==='video'&&!clips){if(r.preview)images[id]={src:r.preview,source:'uploaded',original:false};continue;} // exists, but the caller does not want clip bytes (board previews, save checks): hand back the poster still when there is one. Renders ask for clips, as data URIs, because video layers read them from this map
        if(r.bytes>MEDIA_LIMITS.maxInlineImageBytes){if(r.kind==='image'&&r.preview)images[id]={src:r.preview,source:'uploaded',original:false};else missing.push(id);continue;}
        const buf=await readBytes(user,r);
        images[id]={src:`data:${r.mime};base64,${buf.toString('base64')}`,source:'uploaded',original:true};
      }
      return {images,missing};
    },
  };
}
export const adMediaStore=createAdMediaStore();
export const isMediaId=id=>typeof id==='string'&&ID.test(id);
