import {createHash} from 'node:crypto';
import {isMediaId,MEDIA_LIMITS,sniffMedia} from './adMedia.js';
export const mediaError=(message,status=400)=>Object.assign(new Error(message),{status});
export function mediaInput(input,capability,{maxAssets=4,allowEmpty=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.capability!==capability)throw mediaError('Choose the correct media capability.');
 const allowed=capability==='video'?['action','capability','prompt','asset_ids','seconds','aspect']:['action','capability','prompt','asset_ids'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw mediaError('Unsupported media input field.');
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>2000)throw mediaError('Enter a prompt of 1–2,000 characters.');
 const ids=input.asset_ids??[];
 if(!Array.isArray(ids)||ids.length>maxAssets||!allowEmpty&&!ids.length||ids.some(id=>!isMediaId(id))||new Set(ids).size!==ids.length)throw mediaError('Choose distinct saved Lab asset IDs within the input limit.');
 return {capability,prompt:input.prompt.trim(),asset_ids:[...ids]};
}
export async function readLabMedia(owner,ids,{assets,kinds=['image','audio','video'],maxBytes=20*1024*1024,maxTotal=32*1024*1024,signal}={}){
 if(!owner?.id)throw mediaError('Owner authentication required.',401);
 if(!assets)throw mediaError('Shared assets are unavailable.',503);
 let total=0;const records=[];
 // Validate every owner-scoped metadata record before loading any bytes.
 for(const id of ids){
  signal?.throwIfAborted();const m=await assets.read(owner,id);
  if(m.status!=='ready')throw mediaError('Finish uploading all selected assets.',409);
  if(!kinds.includes(m.kind))throw mediaError('This provider does not support the selected media type.',409);
  if(!Number.isInteger(m.bytes)||m.bytes<16||m.bytes>maxBytes||(total+=m.bytes)>maxTotal)throw mediaError('Selected media exceeds the bounded input size.',413);
  if(m.kind!=='image'&&(!Number.isFinite(m.seconds)||m.seconds<=0||m.seconds>120))throw mediaError('Audio/video needs a recorded duration of at most 120 seconds.');
  if(!Number.isInteger(m.chunks)||m.chunks!==Math.ceil(m.bytes/MEDIA_LIMITS.chunkBytes))throw mediaError('Invalid media chunk metadata.');
  records.push(m);
 }
 const media=[];
 for(const m of records){
  const chunks=[];let size=0;
  for(let index=0;index<m.chunks;index++){
   signal?.throwIfAborted();const piece=await assets.downloadChunk(owner,{media_id:m.media_id,index});
   if(typeof piece.data_base64!=='string'||piece.data_base64.length>Math.ceil(MEDIA_LIMITS.chunkBytes/3)*4)throw mediaError('Invalid media chunk.',502);
   const bytes=Buffer.from(piece.data_base64,'base64');size+=bytes.length;
   if(bytes.length>MEDIA_LIMITS.chunkBytes||size>m.bytes)throw mediaError('Media size mismatch.',502);chunks.push(bytes);
  }
  const bytes=Buffer.concat(chunks),real=sniffMedia(bytes);
  if(size!==m.bytes||createHash('sha256').update(bytes).digest('hex')!==m.sha256||!real||real.kind!==m.kind||real.mime!==m.mime)throw mediaError('Media checksum or type mismatch.',502);
  // No signed URLs or credentials cross the adapter boundary.
  media.push({asset_id:m.media_id,name:m.name,kind:m.kind,mime:m.mime,sha256:m.sha256,seconds:m.seconds??null,width:m.width??null,height:m.height??null,bytes});
 }
 return media;
}
export const adapterReady=(provider,methods)=>Boolean(provider?.verified===true&&typeof provider.id==='string'&&/^[a-zA-Z0-9._-]{1,80}$/.test(provider.id)&&typeof provider.model==='string'&&provider.model.length>0&&provider.model.length<=120&&methods.every(m=>typeof provider[m]==='function'));
