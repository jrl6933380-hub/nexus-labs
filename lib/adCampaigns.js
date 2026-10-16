import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {validateProject} from '../public/ad-maker-model.mjs';

const text=max=>z.string().max(max);
const asset=z.string().max(140000).refine(v=>v==='' || /^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(v),'Use an uploaded PNG, JPEG, or WebP image.');
export const adCampaignSchema=z.object({name:text(80),brand:text(35),initial:text(2),cta:text(35),destination:text(65),siteName:text(30),siteHeadline:text(65),siteCta:text(25),brief:text(120),accent:z.string().regex(/^#[\da-f]{6}$/i),background:z.string().regex(/^#[\da-f]{6}$/i),format:z.enum(['portrait','square','landscape']),logo:asset,photo:asset,scenes:z.array(z.object({id:z.enum(['hook','team','reveal','close']),headline:text(100),support:text(160),duration:z.number().finite().min(2).max(15)}).strict()).length(4).refine(v=>new Set(v.map(s=>s.id)).size===4,'Keep one of each scene.')}).strict();
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const fail=(message,status=400)=>Object.assign(new Error(message),{status,code:status===409?'AD_CHANGED':'AD_INPUT_INVALID'});
const key=user=>{if(typeof user!=='string'||!user)throw fail('Authenticated account required.',401);return 'nexus:ad-campaigns:v1:'+encodeURIComponent(user);};
const cas=`-- ad-campaign-cas-v1
local old=redis.call('HGET',KEYS[1],ARGV[1]) or ''
if old~=ARGV[2] then return 0 end
if old=='' and redis.call('HLEN',KEYS[1])>=100 then return -1 end
redis.call('HSET',KEYS[1],ARGV[1],ARGV[3])
return 1`;
const summary=r=>({campaign_id:r.campaign_id,baseline:r.baseline,name:r.project.name,format:r.project.format,duration:r.project.scenes.reduce((a,s)=>a+s.duration,0),updated_at:r.updated_at,studio_url:'/ad-maker.html?ad='+encodeURIComponent(r.campaign_id)});
export function createAdCampaignStore({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts),now=Date.now,uuid=randomUUID}={}){
 return {
  async list(user){return {campaigns:(await command(['HVALS',key(user)])||[]).map(raw=>summary(JSON.parse(raw))).sort((a,b)=>b.updated_at-a.updated_at)};},
  async read(user,campaign_id){id.parse(campaign_id);const raw=await command(['HGET',key(user),campaign_id]);if(!raw)throw fail('Ad not found in your workspace.',404);const r=JSON.parse(raw);return {...summary(r),project:r.project};},
  async save(user,{campaign_id,baseline,project}){
   id.parse(campaign_id);const clean=validateProject(adCampaignSchema.parse(project));
   if(Buffer.byteLength(JSON.stringify(clean))>180000)throw fail('This ad is too large to save. Use smaller images (combined campaign under 180 KB).');
   const raw=await command(['HGET',key(user),campaign_id])||'',old=raw?JSON.parse(raw):null;
   if((old?.baseline||undefined)!==(baseline||undefined))throw fail('This ad changed. Reload it before saving so newer edits are preserved.',409);
   const r={campaign_id,baseline:uuid(),updated_at:now(),project:clean};const result=await command(['EVAL',cas,1,key(user),campaign_id,raw,JSON.stringify(r)]);
   if(result===-1)throw fail('Your workspace has reached its 100-ad limit.',409);
   if(result!==1)throw fail('This ad changed while saving. Reload before trying again.',409);
   return {...summary(r),project:r.project,saved:true};
  }
 };
}
export const adCampaignStore=createAdCampaignStore();
