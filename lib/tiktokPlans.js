// Owner-only TikTok planning: campaigns and videos stored per account, with a scoped ad brief per video.
// A video's scope is an Ad Maker brief; build_ad turns it into a saved vocabulary ad with no model call.
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {adBriefSchema,composeAdFromBrief} from './adComposer.js';
import {adCampaignStore} from './adCampaigns.js';

export const VIDEO_STATUSES=['idea','scripted','ready','scheduled','posted'];
export const PLATFORMS=['tiktok','instagram','facebook'];
const day=z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/u,'Use a date like 2026-10-24.');
const text=max=>z.string().max(max);
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u);
export const scopeBriefSchema=adBriefSchema.omit({campaign_id:true,dry_run:true});
export const campaignSchema=z.object({
  name:text(80).min(1),goal:text(300).default(''),audience:text(300).default(''),
  start:day.default(''),end:day.default(''),status:z.enum(['planning','active','done']).default('planning'),
}).strict();
export const videoSchema=z.object({
  campaign_id:id,title:text(100).min(1),status:z.enum(VIDEO_STATUSES).default('idea'),platform:z.enum(PLATFORMS).default('tiktok'),date:day.default(''),
  hook:text(150).default(''),script:text(3000).default(''),caption:text(2200).default(''),hashtags:text(300).default(''),
  sound:text(100).default(''),video_ref:text(300).default(''),post_url:text(300).default(''),notes:text(1000).default(''),
  ad_campaign_id:z.union([z.literal(''),z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/u)]).default(''),
  scope:z.object({ready:z.boolean(),brief:scopeBriefSchema.nullable()}).strict().default({ready:false,brief:null}),
}).strict();

const fail=(message,status=400,code)=>Object.assign(new Error(message),{status,code:code||(status===409?'PLAN_CHANGED':status===404?'NOT_FOUND':'PLAN_INPUT_INVALID')});
const key=user=>{if(typeof user!=='string'||!user)throw fail('Authenticated account required.',401,'UNAUTHORIZED');return 'nexus:tiktok-plans:v1:'+encodeURIComponent(user);};
const MAX_RECORDS=600;
// An agent may echo back a record it just read; drop the bookkeeping fields before validating.
const stripMeta=({id:_i,baseline:_b,kind:_k,created_at:_c,updated_at:_u,...rest}={})=>rest;
const cas=`-- tiktok-plan-cas-v1
local old=redis.call('HGET',KEYS[1],ARGV[1]) or ''
if old~=ARGV[2] then return 0 end
if old=='' and redis.call('HLEN',KEYS[1])>=tonumber(ARGV[4]) then return -1 end
redis.call('HSET',KEYS[1],ARGV[1],ARGV[3])
return 1`;
const delCas=`-- tiktok-plan-delete-cas-v1
local old=redis.call('HGET',KEYS[1],ARGV[1])
if not old or old~=ARGV[2] then return 0 end
return redis.call('HDEL',KEYS[1],ARGV[1])`;

function checkVideoRules(v){
  if(['ready','scheduled','posted'].includes(v.status)&&!v.caption.trim())throw fail('Add a caption before marking a video '+v.status+'. The poster copies it from here.');
  if(v.status==='scheduled'&&!v.date)throw fail('Pick a post date before scheduling a video.');
  if(v.status==='posted'&&!/^https?:\/\/\S+$/u.test(v.post_url))throw fail('Paste the live post URL before marking a video posted.');
  if(v.scope.ready&&!v.scope.brief)throw fail('A video can only be marked scoped once its ad brief is filled in.');
  if(v.scope.brief){const r=scopeBriefSchema.safeParse(v.scope.brief);if(!r.success)throw fail('Invalid ad brief: '+r.error.issues.slice(0,4).map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));}
}

export function createTikTokPlanStore({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts),now=Date.now,uuid=randomUUID,ads=adCampaignStore,compose=composeAdFromBrief}={}){
  const parse=raw=>raw?JSON.parse(raw):null;
  const read=async(user,field)=>{const raw=await command(['HGET',key(user),field])||'';return {raw,rec:parse(raw)};};
  async function write(user,field,raw,rec){
    const result=await command(['EVAL',cas,1,key(user),field,raw,JSON.stringify(rec),MAX_RECORDS]);
    if(result===-1)throw fail('The planner has reached its '+MAX_RECORDS+'-item limit.',409);
    if(result!==1)throw fail('This changed somewhere else. Reload and try again.',409);
    return rec;
  }
  const pub=rec=>rec;
  async function saveRecord(user,kind,{id:rid,baseline,data}){
    id.parse(rid);const field=kind+':'+rid,{raw,rec:old}=await read(user,field);
    if((old?.baseline||undefined)!==(baseline||undefined))throw fail(old?'This changed somewhere else. Reload and try again.':'Use a fresh id for a new item.',409);
    return pub(await write(user,field,raw,{id:rid,baseline:uuid(),created_at:old?.created_at||now(),updated_at:now(),...data}));
  }
  return {
    async overview(user){
      const rows=(await command(['HVALS',key(user)])||[]).map(parse);
      return {campaigns:rows.filter(r=>r.kind==='c').sort((a,b)=>a.created_at-b.created_at),videos:rows.filter(r=>r.kind==='v').sort((a,b)=>(a.date||'9999')<(b.date||'9999')?-1:(a.date||'9999')>(b.date||'9999')?1:a.created_at-b.created_at)};
    },
    async saveCampaign(user,input){
      const data=campaignSchema.parse(stripMeta(input.campaign));
      return saveRecord(user,'c',{id:input.id,baseline:input.baseline,data:{kind:'c',...data}});
    },
    async saveVideo(user,input){
      const data=videoSchema.parse(stripMeta(input.video));checkVideoRules(data);
      const camp=(await read(user,'c:'+data.campaign_id)).rec;if(!camp)throw fail('Pick a campaign that exists first.',404);
      return saveRecord(user,'v',{id:input.id,baseline:input.baseline,data:{kind:'v',...data}});
    },
    async deleteVideo(user,{id:rid,baseline}){
      id.parse(rid);const {raw,rec}=await read(user,'v:'+rid);if(!rec)throw fail('Video not found.',404);
      if(!baseline||baseline!==rec.baseline)throw fail('This changed somewhere else. Reload and try again.',409);
      if(await command(['EVAL',delCas,1,key(user),'v:'+rid,raw])!==1)throw fail('This changed somewhere else. Reload and try again.',409);
      return {deleted:true,id:rid,title:rec.title};
    },
    async deleteCampaign(user,{id:rid,baseline}){
      id.parse(rid);const {raw,rec}=await read(user,'c:'+rid);if(!rec)throw fail('Campaign not found.',404);
      if(!baseline||baseline!==rec.baseline)throw fail('This changed somewhere else. Reload and try again.',409);
      const {videos}=await this.overview(user);if(videos.some(v=>v.campaign_id===rid))throw fail('Move or delete this campaign\'s videos first.',409);
      if(await command(['EVAL',delCas,1,key(user),'c:'+rid,raw])!==1)throw fail('This changed somewhere else. Reload and try again.',409);
      return {deleted:true,id:rid,name:rec.name};
    },
    // What an agent reads before building the ad for a video.
    async scope(user,{video_id}){
      id.parse(video_id);const v=(await read(user,'v:'+video_id)).rec;if(!v)throw fail('Video not found.',404);
      const campaign=(await read(user,'c:'+v.campaign_id)).rec;
      const scoped=Boolean(v.scope.ready&&v.scope.brief);
      return {video_id,baseline:v.baseline,title:v.title,status:v.status,campaign:campaign?{id:campaign.id,name:campaign.name,goal:campaign.goal,audience:campaign.audience}:null,
        creative:{hook:v.hook,script:v.script,caption:v.caption,hashtags:v.hashtags,sound:v.sound},
        scoped,brief:v.scope.brief,ad_campaign_id:v.ad_campaign_id||null,studio_url:v.ad_campaign_id?'/ad-maker.html?ad='+encodeURIComponent(v.ad_campaign_id):null,
        next:!scoped?'Not scoped yet. Agree the brief with Justin, then save it with scope.ready true.':v.ad_campaign_id?'An ad is already linked. Read it with read_nexus_ad and change it with edit_nexus_ad.':'Call build_nexus_tiktok_ad, or create_nexus_ad_from_brief with this brief (dry_run first) and link the result by saving ad_campaign_id on the video.'};
    },
    async buildAd(user,{video_id}){
      id.parse(video_id);const {rec:v}=await read(user,'v:'+video_id);if(!v)throw fail('Video not found.',404);
      if(!v.scope.ready||!v.scope.brief)throw fail('Scope this video\'s ad brief first.');
      if(v.ad_campaign_id)throw fail('This video already has an ad. Edit it instead of building a second one.',409,'AD_EXISTS');
      const {project,notes}=compose({format:'portrait',...v.scope.brief});
      const ad_id='tt-'+video_id.replace(/[^a-zA-Z0-9_-]/gu,'').slice(0,100);
      const ad=await ads.save(user,{campaign_id:ad_id,project});
      const {raw,rec}=await read(user,'v:'+video_id);
      try{await write(user,'v:'+video_id,raw,{...rec,ad_campaign_id:ad_id,baseline:uuid(),updated_at:now()});}
      catch(e){throw fail('The ad was saved as '+ad_id+' but linking it to the video failed. Reload and link it by saving ad_campaign_id on the video.',409,'AD_NOT_LINKED');}
      return {video_id,ad_campaign_id:ad_id,studio_url:ad.studio_url,name:ad.name,duration:ad.duration,format:ad.format,notes};
    },
  };
}
export const tiktokPlanStore=createTikTokPlanStore();
