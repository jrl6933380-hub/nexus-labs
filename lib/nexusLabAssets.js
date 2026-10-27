import {adMediaStore,isMediaId,MEDIA_LIMITS} from './adMedia.js';
import {getStore} from './store/index.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const ROLES=new Set(['original','mask','cutout','clip','output']);
const ORIGINS=new Set(['uploaded','generated','derived','imported','unrecorded']);
const ownerId=owner=>{if(typeof owner?.id!=='string'||!owner.id)throw fail('Owner authentication required.',401);return owner.id;};
const key=(owner,part)=>`nexus:lab-assets:v1:${encodeURIComponent(ownerId(owner))}:${part}`;
const text=(value,limit,label)=>{if(value===undefined)return '';if(typeof value!=='string'||value.length>limit||/[\u0000-\u001f\u007f]/u.test(value))throw fail(`${label} must be plain text under ${limit+1} characters.`);return value.trim();};
function ids(value,limit=8){if(value===undefined)return [];if(!Array.isArray(value)||value.length>limit||value.some(id=>!isMediaId(id)))throw fail(`Supply up to ${limit} valid media IDs.`);return [...new Set(value)];}
function provenance(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Supply asset provenance.');
 const role=input.role||'original',origin=input.origin||'uploaded';
 if(!ROLES.has(role)||!ORIGINS.has(origin))throw fail('Choose a supported asset role and origin.');
 const parent_ids=ids(input.parent_ids);
 if(role==='original'&&parent_ids.length)throw fail('An original cannot have parent assets.');
 if((role!=='original'||origin==='derived')&&!parent_ids.length)throw fail('A derived asset needs at least one parent asset.');
 const source_url=text(input.source_url,1000,'Source URL');if(source_url){let url;try{url=new URL(source_url);}catch{throw fail('Source URL must be an HTTPS URL.');}if(url.protocol!=='https:'||url.username||url.password)throw fail('Source URL must be HTTPS without credentials.');}
 return {role,origin,parent_ids,source_url,attribution:text(input.attribution,500,'Attribution'),rights:text(input.rights,500,'Rights note'),notes:text(input.notes,1000,'Notes')};
}
const unknown=()=>({role:'original',origin:'unrecorded',parent_ids:[],source_url:'',attribution:'',rights:'',notes:''});
export function createNexusLabAssets({media=adMediaStore,command=async args=>{const store=getStore();if(!store)throw fail('Lab asset storage is unavailable.',503);return store.command(args);},now=Date.now}={}){
 async function metadata(owner,id){const value=await command(['HGET',key(owner,'metadata'),id]);return value?JSON.parse(value):null;}
 async function read(owner,id){const m=await media.read(ownerId(owner),id),p=await metadata(owner,id);return {...m,provenance:p||unknown()};}
 async function parents(owner,p,ownId){const visited=new Set();async function visit(id,depth){if(id===ownId)throw fail('An asset cannot be its own ancestor.');if(depth>16)throw fail('Asset ancestry is too deep.');if(visited.has(id))return;visited.add(id);const record=await media.read(ownerId(owner),id);if(record.status!=='ready')throw fail('Parent assets must have finished uploading.',409);const info=await metadata(owner,id);for(const parent of info?.parent_ids||[])await visit(parent,depth+1);}for(const id of p.parent_ids)await visit(id,0);}
 async function saveMetadata(owner,id,p){const saved=await command(['HSETNX',key(owner,'metadata'),id,JSON.stringify({...p,recorded_at:now()})]);if(!Number(saved)){const {recorded_at,...existing}=await metadata(owner,id);if(JSON.stringify(existing)!==JSON.stringify(p))throw fail('This asset already has provenance. Preserve the original record.',409);}}
 async function ensureReady(owner,values){return Promise.all(values.map(async id=>{const asset=await read(owner,id);if(asset.status!=='ready')throw fail('Only finished assets can be attached to a run.',409);return asset;}));}
 return {
  read,
  async list(owner){const result=await media.list(ownerId(owner));
   // Metadata is keyed by media ID; accept Redis's flat HGETALL or an object.
   const raw=await command(['HGETALL',key(owner,'metadata')]);const entries=Array.isArray(raw)?Array.from({length:raw.length/2},(_,i)=>[raw[i*2],raw[i*2+1]]):Object.entries(raw||{});const p=new Map(entries.map(([id,value])=>[id,typeof value==='string'?JSON.parse(value):value]));
   return {...result,media:result.media.map(m=>({...m,provenance:p.get(m.media_id)||unknown()}))};
  },
  async begin(owner,input){const p=provenance(input.provenance);await parents(owner,p);const result=await media.begin(ownerId(owner),input);await saveMetadata(owner,result.media_id,p);return {...result,provenance:p};},
  async adopt(owner,input){if(!isMediaId(input.media_id))throw fail('Choose a saved media asset.');const m=await media.read(ownerId(owner),input.media_id);if(m.status!=='ready')throw fail('Finish uploading before recording provenance.',409);const p=provenance(input.provenance);await parents(owner,p,m.media_id);const previous=await metadata(owner,m.media_id);if(previous){const {recorded_at,...value}=previous;if(JSON.stringify(value)!==JSON.stringify(p))throw fail('This asset already has provenance. Preserve the original record.',409);return read(owner,m.media_id);}await saveMetadata(owner,m.media_id,p);return read(owner,m.media_id);},
  async putChunk(owner,input){return media.putChunk(ownerId(owner),input.media_id,input.index,input.data_base64);},
  async finish(owner,input){await media.finish(ownerId(owner),input.media_id);return read(owner,input.media_id);},
  async downloadChunk(owner,input){return media.getChunk(ownerId(owner),input.media_id,input.index);},
  async discardUpload(owner,input){const record=await read(owner,input.media_id);if(record.status==='ready')throw fail('Finished originals cannot be discarded as uploads.',409);await media.remove(ownerId(owner),record.media_id);await command(['HDEL',key(owner,'metadata'),record.media_id]);return {discarded:true,media_id:record.media_id};},
  async attach(owner,{run_id,input_asset_ids,output_asset_ids}){
   if(typeof run_id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/u.test(run_id))throw fail('Choose a saved Lab run.');
   const inputs=ids(input_asset_ids,16),outputs=ids(output_asset_ids,16);if(!inputs.length&&!outputs.length)throw fail('Choose at least one asset.');
   const [a,b]=await Promise.all([ensureReady(owner,inputs),ensureReady(owner,outputs)]),values=[];
   for(const [direction,assets] of [['input',a],['output',b]])for(const asset of assets){const {preview,received_chunks,...snapshot}=asset;values.push(`${run_id}:${direction}:${asset.media_id}`,JSON.stringify({run_id,direction,asset:snapshot,attached_at:now()}));}
   await command(['HSET',key(owner,'runs'),...values]);return this.runLinks(owner,[run_id]);
  },
  async runLinks(owner,runIds){const wanted=new Set(runIds),all=await command(['HVALS',key(owner,'runs')]),result={};for(const raw of all||[]){const item=JSON.parse(raw);if(!wanted.has(item.run_id))continue;const group=result[item.run_id]||{input:[],output:[]};group[item.direction].push(item.asset);result[item.run_id]=group;}return result;},
  limits:MEDIA_LIMITS,
 };
}
export const nexusLabAssets=createNexusLabAssets();
