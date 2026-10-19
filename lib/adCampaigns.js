import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {validateAdDesign} from '../public/ad-maker-design.js';
import {validateProject} from '../public/ad-maker-model.mjs';
import {isSpecV2,validateProjectV2,totalDurationV2} from '../public/ad-vocabulary.mjs';

const text=max=>z.string().max(max);
const asset=z.string().max(140000).refine(v=>v==='' || /^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(v),'Use an uploaded PNG, JPEG, or WebP image.');
export const adCampaignSchema=z.object({name:text(80),brand:text(35),initial:text(2),cta:text(35),destination:text(65),siteName:text(30),siteHeadline:text(65),siteCta:text(25),brief:text(120),accent:z.string().regex(/^#[\da-f]{6}$/i),background:z.string().regex(/^#[\da-f]{6}$/i),format:z.enum(['portrait','square','landscape']),logo:asset,photo:asset,scenes:z.array(z.object({id:z.enum(['hook','team','reveal','close']),headline:text(100),support:text(160),duration:z.number().finite().min(2).max(15)}).strict()).length(4).refine(v=>new Set(v.map(s=>s.id)).size===4,'Keep one of each scene.')}).strict();
export const adDesignSchema=z.object({name:z.string().trim().min(1).max(80),html:z.string().min(1).max(100000)}).strict().nullable();
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const fail=(message,status=400)=>Object.assign(new Error(message),{status,code:status===409?'AD_CHANGED':'AD_INPUT_INVALID'});
const key=user=>{if(typeof user!=='string'||!user)throw fail('Authenticated account required.',401);return 'nexus:ad-campaigns:v1:'+encodeURIComponent(user);};
const cas=`-- ad-campaign-cas-v1
local old=redis.call('HGET',KEYS[1],ARGV[1]) or ''
if old~=ARGV[2] then return 0 end
if old=='' and redis.call('HLEN',KEYS[1])>=100 then return -1 end
redis.call('HSET',KEYS[1],ARGV[1],ARGV[3])
return 1`;
// Vocabulary (specVersion 2) ads are stored beside legacy ads but validated by their own strict path.
const vocabularyProject=project=>{const r=validateProjectV2(project);if(!r.ok)throw fail('Invalid vocabulary ad: '+r.errors.slice(0,6).join('; '));return r.value;};
const summary=r=>({campaign_id:r.campaign_id,baseline:r.baseline,name:r.project.name,format:isSpecV2(r.project)?r.project.platform.format:r.project.format,duration:isSpecV2(r.project)?totalDurationV2(r.project):r.project.scenes.reduce((a,s)=>a+s.duration,0),...(isSpecV2(r.project)?{spec_version:2,renderer:'vocabulary-player'}:{}),updated_at:r.updated_at,design_name:r.design?.name||null,studio_url:'/ad-maker.html?ad='+encodeURIComponent(r.campaign_id)});
export function createAdCampaignStore({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts),now=Date.now,uuid=randomUUID}={}){
 return {
  async list(user){return {campaigns:(await command(['HVALS',key(user)])||[]).map(raw=>summary(JSON.parse(raw))).sort((a,b)=>b.updated_at-a.updated_at)};},
  async read(user,campaign_id){id.parse(campaign_id);const raw=await command(['HGET',key(user),campaign_id]);if(!raw)throw fail('Ad not found in your workspace.',404);const r=JSON.parse(raw);return {...summary(r),project:r.project,design:r.design||null};},
  async saveDesign(user,{campaign_id,baseline,design}){
   id.parse(campaign_id);const clean=validateAdDesign(adDesignSchema.parse(design));const raw=await command(['HGET',key(user),campaign_id]);if(!raw)throw fail('Create or open an ad before saving its design.',404);const old=JSON.parse(raw);if(old.baseline!==baseline)throw fail('This ad changed. Read its latest baseline before saving the design.',409);if(isSpecV2(old.project))throw fail('Vocabulary ads render with the stock vocabulary player; custom designs are not supported for them yet.');
   const r={...old,design:clean,baseline:uuid(),updated_at:now()};const result=await command(['EVAL',cas,1,key(user),campaign_id,raw,JSON.stringify(r)]);if(result!==1)throw fail('This ad changed while saving its design. Reload first.',409);return {...summary(r),project:r.project,design:r.design,saved:true};
  },
  async save(user,{campaign_id,baseline,project}){
   id.parse(campaign_id);const v2=isSpecV2(project),clean=v2?vocabularyProject(project):validateProject(adCampaignSchema.parse(project));
   if(Buffer.byteLength(JSON.stringify(clean))>400000)throw fail('This ad is too large to save (limit 400 KB). Use smaller images or fewer layers.');
   const raw=await command(['HGET',key(user),campaign_id])||'',old=raw?JSON.parse(raw):null;
   if((old?.baseline||undefined)!==(baseline||undefined))throw fail('This ad changed. Reload it before saving so newer edits are preserved.',409);
   if(old&&isSpecV2(old.project)!==v2)throw fail('This ad uses a different format. Save it as a new ad instead of converting it.');
   const r={campaign_id,baseline:uuid(),updated_at:now(),project:clean,design:old?.design||null};const result=await command(['EVAL',cas,1,key(user),campaign_id,raw,JSON.stringify(r)]);
   if(result===-1)throw fail('Your workspace has reached its 100-ad limit.',409);
   if(result!==1)throw fail('This ad changed while saving. Reload before trying again.',409);
   return {...summary(r),project:r.project,design:r.design||null,saved:true};
  }
 };
}
export const adCampaignStore=createAdCampaignStore();

