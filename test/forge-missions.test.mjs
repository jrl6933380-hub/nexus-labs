import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createForgeLeadJobQueue} from '../lib/forgeLeadJobs.js';
import {createForgeMissions,normalizeMission,IOWA_CITIES} from '../lib/forgeMissions.js';

function fakeRedis(){
 const kv=new Map(),lists=new Map();
 return async args=>{
  const [op,k,...rest]=args;
  if(op==='GET')return kv.get(k)??null;
  if(op==='SET'){if(rest.includes('NX')&&kv.has(k))return null;kv.set(k,rest[0]);return 'OK';}
  if(op==='LPUSH'){const l=lists.get(k)||[];l.unshift(rest[0]);lists.set(k,l);return l.length;}
  if(op==='LTRIM'||op==='EXPIRE')return 1;
  if(op==='LRANGE')return lists.get(k)||[];
  if(op==='MGET')return [k,...rest].map(x=>kv.get(x)??null);
  if(op==='EVAL'){const key=rest[1],old=rest[2],next=rest[3];if(kv.get(key)!==old)return 0;kv.set(key,next);return 1;}
  throw Error('unsupported '+op);
 };
}
const OWNER='owner-1',DEVICE='device-abcdef';
const BATCH='batch-11111111-2222-3333-4444-555555555555';
function setup(){
 const command=fakeRedis();let t=1000,n=0;
 const uuid=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');
 const queue=createForgeLeadJobQueue({command,now:()=>(t+=10),uuid});
 return {queue,missions:createForgeMissions({command,queue,now:()=>(t+=10),uuid})};
}
const input={request_id:'mission-req-001',business:'barbers',region:'iowa',count:5,max_cities:3};
const found=(eligibleCount)=>({batch:BATCH,leads:[
 ...Array.from({length:eligibleCount},(_,i)=>({name:'Shop '+i,status:'no_dedicated_site_found',duplicate:false,phone:'',notes:''})),
 {name:'Chain',status:'has_website',duplicate:false,phone:'',notes:''}]});

test('mission spec: Iowa preset or plain city names, capped counts',()=>{
 assert.equal(normalizeMission({business:'barbers',region:'iowa'}).cities.length,25);
 assert.deepEqual(normalizeMission({business:'barbers',cities:['Ames','ames','Ankeny']}).cities,['Ames','Ankeny']);
 assert.equal(IOWA_CITIES[0],'Des Moines');
 for(const bad of [{business:'<b>',region:'iowa'},{business:'barbers',region:'iowa',count:11},{business:'barbers',cities:['x;rm']},{business:'barbers'}])
  assert.throws(()=>normalizeMission(bad));
});

test('mission runs itself: queues one task at a time, ticks it off, adds a preview task for finds',async()=>{
 const {queue,missions}=setup();
 const m=await missions.start(OWNER,DEVICE,input);
 assert.equal(m.tasks.length,3);assert.equal(m.tasks[0].city,'Des Moines, Iowa');
 assert.equal((await missions.start(OWNER,DEVICE,input)).id,m.id,'same submit ID is idempotent');
 await assert.rejects(()=>missions.start(OWNER,DEVICE,{...input,request_id:'mission-req-002'}),/current mission/);
 await missions.advance(OWNER,DEVICE);
 await missions.advance(OWNER,DEVICE);
 assert.equal((await queue.list(OWNER)).length,1,'only one job in flight');
 let job=await queue.claim(OWNER,DEVICE);
 assert.equal(job.kind,'search');assert.equal(job.city,'Des Moines, Iowa');assert.equal(job.business,'barbers');
 const done=await queue.complete(OWNER,DEVICE,{id:job.id,token:job.token,result:{batch:BATCH,leads:found(2).leads}});
 await missions.settle(OWNER,done.id,'done');
 let now=await missions.get(OWNER);
 assert.equal(now.tasks[0].status,'done');assert.equal(now.tasks[0].found,3);assert.equal(now.tasks[0].eligible,2);
 assert.equal(now.tasks[1].type,'build','preview task added right after the search');
 assert.equal(now.tasks.length,4);
 await missions.advance(OWNER,DEVICE);
 job=await queue.claim(OWNER,DEVICE);
 assert.equal(job.kind,'build');assert.equal(job.picks,'eligible');assert.equal(job.offer,false,'launch offer stays an owner choice');
 const built=await queue.complete(OWNER,DEVICE,{id:job.id,token:job.token,result:{batch:BATCH,packs:[{name:'A',pitch:'P',previews:{}}]}});
 await missions.settle(OWNER,built.id,'done');
 now=await missions.get(OWNER);
 assert.equal(now.progress.done,2);
});

test('mission finishes when every task is ticked, and no-site-free cities add no preview task',async()=>{
 const {queue,missions}=setup();
 await missions.start(OWNER,DEVICE,{...input,max_cities:1});
 await missions.advance(OWNER,DEVICE);
 const job=await queue.claim(OWNER,DEVICE);
 const done=await queue.complete(OWNER,DEVICE,{id:job.id,token:job.token,result:{batch:BATCH,leads:found(0).leads}});
 await missions.settle(OWNER,done.id,'done');
 const m=await missions.get(OWNER);
 assert.equal(m.status,'done');assert.equal(m.tasks.length,1);
});

test('two failures in a row pause the mission so it does not hammer Google',async()=>{
 const {queue,missions}=setup();
 await missions.start(OWNER,DEVICE,input);
 for(let i=0;i<2;i++){
  await missions.advance(OWNER,DEVICE);
  const job=await queue.claim(OWNER,DEVICE);
  const failed=await queue.fail(OWNER,DEVICE,{id:job.id,token:job.token,message:'Google needs verification'});
  await missions.settle(OWNER,failed.id,'failed');
 }
 const m=await missions.get(OWNER);
 assert.equal(m.status,'paused');assert.match(m.note,/Resume/);
 await missions.advance(OWNER,DEVICE);
 assert.equal((await queue.list(OWNER)).length,2,'paused missions queue nothing');
 assert.equal((await missions.control(OWNER,{action:'resume'})).status,'active');
});

test('owner and Qwen can add cities (deduped, capped); skip and stop work',async()=>{
 const {queue,missions}=setup();
 await missions.start(OWNER,DEVICE,{...input,max_cities:2});
 let m=await missions.addTasks(OWNER,['Ankeny','ankeny, iowa','Boone'],'qwen');
 assert.deepEqual(m.tasks.map(t=>t.city),['Des Moines, Iowa','Cedar Rapids, Iowa','Ankeny, Iowa','Boone, Iowa']);
 assert.equal(m.tasks[3].added_by,'qwen');
 m=await missions.addTasks(OWNER,['Iowa City'],'qwen');
 assert.equal(m.tasks[4].city,'Iowa City, Iowa','a city with Iowa in its name still gets the state added');
 await assert.rejects(()=>missions.addTasks(OWNER,['a<b>'],'qwen'),/plain city/);
 await assert.rejects(()=>missions.addTasks(OWNER,['A1','A2','A3','A4','A5','A6'],'qwen'),/1-5/);
 m=await missions.control(OWNER,{action:'skip',task_id:m.tasks[1].id});
 assert.equal(m.tasks[1].status,'skipped');
 await missions.advance(OWNER,DEVICE);
 m=await missions.control(OWNER,{action:'stop'});
 assert.equal(m.status,'stopped');
 assert.ok(m.tasks.every(t=>t.status!=='todo'));
 assert.equal((await queue.list(OWNER))[0].cancel_requested||(await queue.list(OWNER))[0].status==='canceled',true);
 await assert.rejects(()=>missions.addTasks(OWNER,['Ames'],'owner'),/finished/);
});

test('API and page expose the mission without new network paths or markup injection',async()=>{
 const api=await readFile(new URL('../api/forge-lead-jobs.js',import.meta.url),'utf8');
 for(const a of ['mission_start','mission_add','mission_control','device_mission_add'])assert.match(api,new RegExp(a));
 assert.match(api,/missions\.settle/);assert.match(api,/missions\.advance/);
 const page=await readFile(new URL('../public/forge-leads.html',import.meta.url),'utf8');
 assert.ok(!/innerHTML|eval\(|new Function\(|document\.write/.test(page));
 assert.match(page,/mission_start/);
});
