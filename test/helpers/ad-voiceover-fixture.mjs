import {createAdCampaignStore} from '../../lib/adCampaigns.js';
import {createAdMediaStore} from '../../lib/adMedia.js';
import {createRenderJobStore} from '../../lib/adRenderJobs.js';
import {createAdVoiceovers} from '../../lib/adVoiceovers.js';
import {createWorkspaceRequests} from '../../lib/workspaceRequests.js';
import {createAdVoiceoverHandler} from '../../api/ad-voiceover.js';
import {promoVideo} from '../../lib/adMotionKit.js';
export async function fixture(){
 const h=new Map(),kv=new Map();let n=0,at=1000;
 const command=async([op,key,...a])=>{const m=h.get(key)||new Map();
  if(op==='HGET')return m.get(a[0])??null;
  if(op==='HVALS')return [...m.values()];
  if(op==='HGETALL')return [...m.entries()].flat();
  if(op==='HSETNX'){if(m.has(a[0]))return 0;h.set(key,m);m.set(a[0],a[1]);return 1;}
  if(op==='HSET'){h.set(key,m);m.set(a[0],a[1]);return 1;}
  if(op==='HDEL')return m.delete(a[0])?1:0;
  if(op==='HLEN')return m.size;
  if(op==='HEXISTS')return m.has(a[0])?1:0;
  if(op==='SET'){if(a.includes('NX')&&kv.has(key))return null;kv.set(key,a[0]);return 'OK';}
  if(op==='GET')return kv.get(key)??null;
  if(op==='DEL'){h.delete(key);return kv.delete(key)?1:0;}
  if(op==='EXPIRE'||op==='LPUSH')return 1;
  if(op==='EVAL'){const [, ,id,previous,value]=a;if((m.get(id)||'')!==previous)return 0;h.set(key,m);m.set(id,value);return 1;}
  throw new Error('Unsupported fixture operation '+op);
 };
 // EVAL layout is script, numkeys, key, id, previous, value.
 const evalCommand=async parts=>{if(parts[0]!=='EVAL')return command(parts);const [, , ,key,id,previous,value]=parts;const m=h.get(key)||new Map();if((m.get(id)||'')!==previous)return 0;h.set(key,m);m.set(id,value);return 1;};
 const ads=createAdCampaignStore({command:evalCommand,uuid:()=> 'b'+ ++n}),media=createAdMediaStore({command:evalCommand}),jobs=createRenderJobStore({command:evalCommand,now:()=>++at}),voices=createAdVoiceovers({command:evalCommand});
 const record=await ads.save('alice',{campaign_id:'voice-ad',project:promoVideo({brand:'Nexus',hook:'Competitor research',cta:'Try Nexus'})});
 const images={resolve:async()=>({images:{},missing:[]})};
 const handler=createAdVoiceoverHandler({ads,media,jobs,voices,images,once:createWorkspaceRequests({command:evalCommand}),resolveAccount:async req=>{if(!req.user)throw Object.assign(new Error('Sign in'),{status:401});return {id:req.user};}});
 async function call(action,input={},user='alice',headers={},request_id='voice-test-'+ ++n){
  const req={method:'POST',user,headers:{host:'nexus.example',origin:'https://nexus.example','content-type':'application/json',...headers},body:{action,input:{campaign_id:'voice-ad',...input},request_id}};
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler(req,res);return res;
 }
 const api=async(action,input)=>{const r=await call(action,input);if(r.code!==200)throw Object.assign(new Error(r.body.error),{status:r.code});return r.body.data;};
 return {ads,media,jobs,voices,record,handler,call,api};
}
