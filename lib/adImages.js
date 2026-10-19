// Per-account image library for Ad Maker ads. Images are uploaded from the board (or any caller that
// can send the bytes), stored once, and referenced from a photo_focus scene by id (params.imageId).
// An ad stores only the id, so ads stay small; the preview and the MP4 export resolve ids to pictures.
// Pure validation plus an injectable store, with no zod, so it runs anywhere.
import {randomBytes} from 'node:crypto';
import {IMAGE_ID_PATTERN} from '../public/ad-vocabulary.mjs';

export const IMAGE_LIMITS=Object.freeze({
  maxImages:30,
  maxDataChars:140000, // data URI length, same ceiling as campaign assets
  maxThumbChars:6000,
  name:60,
  description:240,
});
export const IMAGE_SOURCES=Object.freeze(['ai_generated','uploaded']);
const DATA_URI=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const ID=new RegExp(IMAGE_ID_PATTERN);
const CONTROL=/[\u0000-\u001f\u007f]/;
const fail=(message,status=400,code='IMAGE_INVALID')=>Object.assign(new Error(message),{status,code});
const key=user=>{if(typeof user!=='string'||!user)throw fail('Authenticated account required.',401,'UNAUTHORIZED');return 'nexus:ad-images:v1:'+encodeURIComponent(user);};

// The declared type must match the real bytes, so a script or HTML file cannot be stored as a picture.
export function sniffImage(bytes){
  if(bytes.length>8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return 'png';
  if(bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpeg';
  if(bytes.length>12&&bytes.subarray(0,4).toString('latin1')==='RIFF'&&bytes.subarray(8,12).toString('latin1')==='WEBP')return 'webp';
  return null;
}
export function checkDataUri(value,{max,label='image'}={}){
  if(typeof value!=='string'||!value)throw fail(`${label}: provide a PNG, JPEG or WebP data URI.`);
  if(value.length>max)throw fail(`${label} is too large (${Math.round(value.length/1000)} KB, limit ${Math.round(max/1000)} KB). Resize or compress it first.`);
  const m=DATA_URI.exec(value);
  if(!m)throw fail(`${label}: use a base64 data URI of a PNG, JPEG or WebP picture.`);
  const bytes=Buffer.from(m[2],'base64'),real=sniffImage(bytes);
  if(real!==m[1])throw fail(`${label}: the file contents are not a real ${m[1].toUpperCase()} picture.`);
  return {mime:'image/'+m[1],bytes:bytes.length};
}
const clean=(v,max,label,{required=false}={})=>{
  if(v===undefined||v===null||v==='') {if(required)throw fail(`${label} is required.`);return '';}
  if(typeof v!=='string'||CONTROL.test(v))throw fail(`${label} must be plain text.`);
  const t=v.trim();
  if(required&&!t)throw fail(`${label} is required.`);
  if([...t].length>max)throw fail(`${label} is too long (max ${max} characters).`);
  return t;
};
const meta=r=>({image_id:r.image_id,name:r.name,source:r.source,description:r.description,mime:r.mime,bytes:r.bytes,thumb:r.thumb||'',created_at:r.created_at});

export function validateImageInput(input){
  const name=clean(input.name,IMAGE_LIMITS.name,'name',{required:true});
  const description=clean(input.description,IMAGE_LIMITS.description,'description');
  const source=input.source===undefined?'uploaded':input.source;
  if(!IMAGE_SOURCES.includes(source))throw fail(`source must be one of ${IMAGE_SOURCES.join(', ')}.`);
  const {mime,bytes}=checkDataUri(input.data_uri,{max:IMAGE_LIMITS.maxDataChars});
  let thumb='';
  if(input.thumb!==undefined&&input.thumb!==''){checkDataUri(input.thumb,{max:IMAGE_LIMITS.maxThumbChars,label:'thumb'});thumb=input.thumb;}
  return {name,description,source,mime,bytes,data:input.data_uri,thumb};
}

export function createAdImageStore({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts),now=Date.now,newId=()=>'img-'+randomBytes(5).toString('hex')}={}){
  return {
    async list(user){
      const rows=(await command(['HVALS',key(user)])||[]).map(raw=>meta(JSON.parse(raw)));
      return {images:rows.sort((a,b)=>b.created_at-a.created_at),limit:IMAGE_LIMITS.maxImages};
    },
    async save(user,input){
      const v=validateImageInput(input);
      const count=Number(await command(['HLEN',key(user)]))||0;
      if(count>=IMAGE_LIMITS.maxImages)throw fail(`Your image library is full (${IMAGE_LIMITS.maxImages} images). Delete one first.`,409,'IMAGE_LIMIT');
      const image_id=newId();
      if(!ID.test(image_id))throw fail('Could not create an image id.',500,'IMAGE_ID');
      const record={image_id,created_at:now(),...v};
      await command(['HSET',key(user),image_id,JSON.stringify(record)]);
      return {...meta(record),saved:true};
    },
    async remove(user,image_id){
      if(typeof image_id!=='string'||!ID.test(image_id))throw fail('A valid image_id is required.');
      const removed=Number(await command(['HDEL',key(user),image_id]))||0;
      if(!removed)throw fail('Image not found in your library.',404,'IMAGE_NOT_FOUND');
      return {deleted:true,image_id};
    },
    // {id:{src,source}} for exactly the ids asked for; ids that are not in the library are returned in `missing`.
    async resolve(user,imageIds){
      const unique=[...new Set(imageIds)].filter(id=>ID.test(id)),images={},missing=[];
      for(const id of unique){
        const raw=await command(['HGET',key(user),id]);
        if(!raw){missing.push(id);continue;}
        const r=JSON.parse(raw);images[id]={src:r.data,source:r.source};
      }
      return {images,missing};
    },
  };
}
export const adImageStore=createAdImageStore();

// Every library id a project points at, in scene order, without repeats: a scene's own params.imageId
// (photo_focus) and the imageId of any graphic-scene layer. This is the one collector the board preview,
// review sheets and the MP4/PNG exports all use, so no picture is resolved in one place and dropped in another.
export function imageIdsOf(project){
  const out=new Set();
  for(const s of project?.scenes||[]){
    const p=s&&s.params;if(!p)continue;
    if(typeof p.imageId==='string')out.add(p.imageId);
    if(Array.isArray(p.layers))for(const l of p.layers){if(l&&typeof l.imageId==='string')out.add(l.imageId);if(l&&typeof l.matteImage==='string')out.add(l.matteImage);}
    if(s.type==='world3d'&&Array.isArray(p.objects))for(const o of p.objects)for(const k of ['colorMap','roughnessMap'])if(o&&typeof o[k]==='string')out.add(o[k]);
  }
  return [...out];
}
