// Forge lead "missions": a progressive checklist the paired Ally works through on its own.
// A mission is a goal ("barbers across Iowa") plus tasks (search one city, build previews for the finds).
// Tasks run through the existing owner-scoped lead job queue, one at a time. The owner (or the paired
// Ally's Qwen, through a device action) may add tasks; nothing here sends, calls, posts or publishes.
import {createHash,randomUUID} from 'node:crypto';
import {teamCommand} from './teamRuns.js';
import {forgeLeadJobQueue} from './forgeLeadJobs.js';

const TTL=60*60*24*30,MAX_TASKS=40,MAX_ADD=5,MAX_COUNT=10;
const CAS="if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') return 1";
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const key=o=>'nexus:forge-missions:v1:'+encodeURIComponent(o)+':active';
const requestOK=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(x);
const textOK=(x,max)=>typeof x==='string'&&x.trim().length>=2&&x.trim().length<=max&&/^[\p{L}\p{N} .,'&-]+$/u.test(x.trim());
const tidy=x=>x.trim().replace(/\s+/g,' ');
const DONE=['done','failed','skipped'];
const withState=(m,c)=>m.suffix&&!c.toLowerCase().includes(m.suffix.toLowerCase().trim().replace(/^,\s*/,''))?c+m.suffix:c;

export const IOWA_CITIES=['Des Moines','Cedar Rapids','Davenport','Sioux City','Iowa City','Waterloo','Ames','West Des Moines',
 'Council Bluffs','Ankeny','Dubuque','Urbandale','Cedar Falls','Marion','Bettendorf','Mason City','Marshalltown','Clinton',
 'Burlington','Ottumwa','Fort Dodge','Muscatine','Coralville','Johnston','North Liberty'];

const publicMission=m=>m&&({id:m.id,goal:m.goal,business:m.business,status:m.status,auto_build:m.auto_build,note:m.note||'',
 created_at:m.created_at,updated_at:m.updated_at,
 progress:{done:m.tasks.filter(t=>t.status==='done').length,total:m.tasks.length},
 tasks:m.tasks.map(t=>({id:t.id,type:t.type,city:t.city,label:t.label,status:t.status,job_id:t.job_id||'',found:t.found??null,
  eligible:t.eligible??null,note:t.note||'',added_by:t.added_by}))});

export function normalizeMission(input={}){
 const count=Number(input.count??5);
 if(!textOK(input.business,80))throw bad('Enter a business type.');
 if(!Number.isInteger(count)||count<1||count>MAX_COUNT)throw bad('Results per city must be 1-10.');
 let cities;
 if(input.region==='iowa')cities=[...IOWA_CITIES];
 else if(Array.isArray(input.cities)){
  const seen=new Map();
  for(const c of input.cities){if(!textOK(c,60))throw bad('Use plain city names.');if(!seen.has(tidy(c).toLowerCase()))seen.set(tidy(c).toLowerCase(),tidy(c));}
  cities=[...seen.values()];
 }else throw bad('Choose Iowa or list cities.');
 const limit=Number.isInteger(input.max_cities)?Math.min(Math.max(input.max_cities,1),25):25;
 cities=cities.slice(0,limit);
 if(!cities.length)throw bad('Add at least one city.');
 return {business:tidy(input.business),count,cities,auto_build:input.auto_build!==false,region:input.region==='iowa'?'Iowa':'chosen cities'};
}

export function createForgeMissions({command=teamCommand,queue=forgeLeadJobQueue,now=Date.now,uuid=randomUUID}={}){
 const rawGet=owner=>command(['GET',key(owner)]);
 async function get(owner){const raw=await rawGet(owner);return raw?publicMission(JSON.parse(raw)):null;}
 async function mutate(owner,fn){
  for(let i=0;i<4;i++){
   const raw=await rawGet(owner);
   if(!raw)throw bad('No mission yet.',404);
   const next=JSON.parse(raw),out=await fn(next);
   next.updated_at=now();
   if(next.status==='active'&&next.tasks.every(t=>DONE.includes(t.status)))next.status='done';
   if(Number(await command(['EVAL',CAS,1,key(owner),raw,JSON.stringify(next)]))===1)return {mission:next,out};
  }
  throw bad('Mission changed. Refresh.',409);
 }
 const task=(m,type,city,by,extra={})=>({id:'t'+(m.seq=(m.seq||0)+1),type,city,added_by:by,status:'todo',
  label:type==='search'?'Search '+city:'Previews for '+city,count:m.count,...extra});

 async function start(owner,device,input={}){
  if(typeof device!=='string'||device.length<6)throw bad('Pair your Ally to Nexus first.',409);
  if(!requestOK(input.request_id))throw bad('Missing submit ID.');
  const spec=normalizeMission(input);
  const id=createHash('sha256').update(owner+'\n'+input.request_id).digest('hex').slice(0,32);
  const raw=await rawGet(owner),old=raw&&JSON.parse(raw);
  if(old&&old.id===id)return publicMission(old);
  if(old&&['active','paused'].includes(old.status))throw bad('Finish or stop the current mission first.',409);
  const m={id,device_id:device,goal:spec.business+' across '+spec.region+' with no website',business:spec.business,count:spec.count,
   auto_build:spec.auto_build,status:'active',note:'',fail_streak:0,created_at:now(),updated_at:now(),tasks:[],seq:0};
  m.suffix=spec.region==='Iowa'?', Iowa':'';
  for(const c of spec.cities)m.tasks.push(task(m,'search',withState(m,c),'plan'));
  const body=JSON.stringify(m);
  const ok=old?Number(await command(['EVAL',CAS,1,key(owner),raw,body]))===1:(await command(['SET',key(owner),body,'NX','EX',String(TTL)]))==='OK';
  if(!ok)throw bad('Mission changed. Refresh.',409);
  return publicMission(m);
 }

 // Called when the paired Ally polls for work: queue the next task as a normal job.
 async function advance(owner,device){
  try{
   await mutate(owner,async m=>{
    if(m.status!=='active'||m.device_id!==device||m.tasks.some(t=>t.status==='doing'))return;
    const t=m.tasks.find(x=>x.status==='todo');
    if(!t)return;
    const rid='m'+m.id.slice(0,10)+t.id;
    const spec=t.type==='search'?{request_id:rid,kind:'search',business:m.business,city:t.city,count:t.count}
     :{request_id:rid,kind:'build',source_id:t.source_job,picks:'eligible',offer:false};
    try{const job=await queue.create(owner,device,spec);t.status='doing';t.job_id=job.id;}
    catch(e){if(e.status===409&&/full/i.test(e.message))return;t.status='failed';t.note=String(e.message).slice(0,120);}
   });
  }catch(e){if(e.status!==404)throw e;}
 }

 async function settle(owner,jobId,outcome){
  let m;try{m=JSON.parse(await rawGet(owner)||'null');}catch{m=null;}
  const t=m?.tasks?.find(x=>x.job_id===jobId);
  if(!t)return;
  let found=null,eligible=null;
  if(outcome==='done'&&t.type==='search'){
   const r=await queue.getResult(owner,jobId);
   found=r.leads.length;eligible=r.leads.filter(l=>l.status!=='has_website'&&!l.duplicate).length;
  }
  await mutate(owner,async mm=>{
   const i=mm.tasks.findIndex(x=>x.job_id===jobId),x=mm.tasks[i];
   if(!x||x.status!=='doing')return;
   if(outcome==='done'){
    x.status='done';mm.fail_streak=0;
    if(x.type==='search'){x.found=found;x.eligible=eligible;
     if(mm.auto_build&&eligible>0&&mm.tasks.length<MAX_TASKS)mm.tasks.splice(i+1,0,task(mm,'build',x.city,'plan',{source_job:jobId}));}
   }else{
    x.status=outcome==='canceled'?'skipped':'failed';x.note=outcome==='canceled'?'Stopped':'Needs a look on the Ally';
    mm.fail_streak=(mm.fail_streak||0)+1;
    if(outcome==='canceled'||mm.fail_streak>=2){mm.status='paused';mm.note='Paused. Check the Ally screen, then tap Resume.';}
   }
  });
 }

 async function addTasks(owner,cities,by){
  if(!Array.isArray(cities)||!cities.length||cities.length>MAX_ADD)throw bad('Add 1-'+MAX_ADD+' cities at a time.');
  cities.forEach(c=>{if(!textOK(c,60))throw bad('Use plain city names.');});
  const {mission}=await mutate(owner,async m=>{
   if(!['active','paused'].includes(m.status))throw bad('That mission is finished. Start a new one.',409);
   const have=new Set(m.tasks.filter(t=>t.type==='search').map(t=>t.city.toLowerCase()));
   for(const raw of cities){
    const c=withState(m,tidy(raw));
    if(have.has(c.toLowerCase()))continue;
    if(m.tasks.length>=MAX_TASKS)throw bad('The checklist is full (40 tasks).',409);
    have.add(c.toLowerCase());m.tasks.push(task(m,'search',c,by));
   }
   if(m.status==='done')m.status='active';
  });
  return publicMission(mission);
 }

 async function control(owner,{action,task_id}={}){
  const {mission}=await mutate(owner,async m=>{
   if(action==='pause'){if(m.status==='active')m.status='paused';}
   else if(action==='resume'){if(m.status==='paused'){m.status='active';m.fail_streak=0;m.note='';}}
   else if(action==='stop'){
    for(const t of m.tasks){
     if(t.status==='todo')t.status='skipped';
     if(t.status==='doing'&&t.job_id)await queue.cancel(owner,t.job_id).catch(()=>{});
    }
    m.status='stopped';m.note='Stopped.';
   }else if(action==='skip'){
    const t=m.tasks.find(x=>x.id===task_id);
    if(!t||t.status!=='todo')throw bad('Only waiting tasks can be skipped.',409);
    t.status='skipped';
   }else throw bad('Unsupported mission action.');
  });
  return publicMission(mission);
 }
 return {get,start,advance,settle,addTasks,control};
}
export const forgeMissions=createForgeMissions();
