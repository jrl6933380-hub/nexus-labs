import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {approvedMissionRoute,missionTransportArgs,missionSummary,workCatalog} from '../scripts/ally/qwen-work-tools.mjs';
import {executeTool,runAgent} from '../scripts/ally/qwen-terminal-agent.mjs';
import {createForgeLeadJobQueue} from '../lib/forgeLeadJobs.js';
import {createForgeMissions} from '../lib/forgeMissions.js';
import {createForgeLeadJobsHandler} from '../api/forge-lead-jobs.js';

test('plain requests start, read or extend a mission; anything odd is left to normal planning',()=>{
 assert.deepEqual(approvedMissionRoute('Find barbers all over Iowa with no sites'),{action:'start',business:'barbers'});
 assert.deepEqual(approvedMissionRoute('please find me hair salons across Iowa that have no website.'),{action:'start',business:'hair salons'});
 assert.deepEqual(approvedMissionRoute('how is the mission going'),{action:'status'});
 assert.deepEqual(approvedMissionRoute('add Boone to the mission'),{action:'add_cities',cities:['Boone']});
 for(const t of ["find barbers all over Iowa, don't search yet",'find barbers all over Iowa; rm -rf','find barbers in Des Moines','start a mission and email every owner','']) assert.equal(approvedMissionRoute(t),null);
});

test('transport arguments are fixed, validated and never free text',()=>{
 assert.deepEqual(missionTransportArgs({action:'status'}),['-Action','mission_get']);
 assert.deepEqual(missionTransportArgs({action:'pause'}),['-Action','mission_control','-Control','pause']);
 assert.deepEqual(missionTransportArgs({action:'start',business:'barbers'}),['-Action','mission_start','-Business','barbers','-Count','5','-MaxCities','25']);
 assert.deepEqual(missionTransportArgs({action:'add_cities',cities:['Ames','Boone']}),['-Action','mission_add','-Cities','Ames,Boone']);
 for(const bad of [{action:'stop'},{action:'start',business:'x;calc'},{action:'start',business:'barbers',count:11},{action:'add_cities',cities:[]},
  {action:'add_cities',cities:['a,b']},{action:'add_cities',cities:['1','2','3','4','5','6'].map(n=>'City'+n)},{action:'delete'}])
  assert.throws(()=>missionTransportArgs(bad));
});

test('lead_mission tool runs only the pinned transport and returns a short checklist',async()=>{
 const calls=[];
 const runner=async(file,argv)=>{calls.push([file,argv]);return {stdout:JSON.stringify({result:{mission:{status:'active',goal:'barbers across Iowa',progress:{done:1,total:3},note:'',
  tasks:[{id:'t1',label:'Search Ames, Iowa',status:'done',found:3,eligible:2},{id:'t2',label:'Search Ankeny, Iowa',status:'todo'}]}}})};};
 const ws=await mkdtemp(join(tmpdir(),'qwen-mission-'));
 try{
  const r=await executeTool({tool:'lead_mission',args:{action:'status'}},{workspace:ws,commandRunner:runner});
  assert.equal(r.status,'succeeded');assert.equal(r.mission.progress.done,1);assert.equal(r.mission.waiting,1);
  assert.equal(calls[0][0],'powershell.exe');assert.match(calls[0][1].join(' '),/forge-lead-transport\.ps1 -Action mission_get/);
  await assert.rejects(()=>executeTool({tool:'lead_mission',args:{action:'status',url:'https://x.test'}},{workspace:ws,commandRunner:runner}),/Unexpected/);
  const failed=await executeTool({tool:'lead_mission',args:{action:'status'}},{workspace:ws,commandRunner:async()=>{throw Error('Bearer abc.def failed');}});
  assert.equal(failed.status,'failed');assert.doesNotMatch(JSON.stringify(failed),/abc\.def/);
 }finally{await rm(ws,{recursive:true,force:true});}
});

test('an approved plain request starts the mission and finishes on the receipt without asking the model',async()=>{
 const ws=await mkdtemp(join(tmpdir(),'qwen-mission-'));
 try{
  let modelCalls=0;
  const execute=async(action)=>({action:action.args.action,status:'succeeded',mission:{status:'active',progress:{done:0,total:25}}});
  const result=await runAgent({task:'Find barbers all over Iowa with no sites',workspace:ws,execute,generate:async()=>{modelCalls++;return '{}';}});
  assert.equal(result.status,'done');assert.match(result.answer,/start succeeded/);assert.equal(modelCalls,0);
  const bad=await runAgent({task:'Find barbers all over Iowa with no sites',workspace:ws,execute:async()=>({status:'failed',error:'Pair the Ally first'}),generate:async()=>'{}'});
  assert.equal(bad.status,'needs_help');
 }finally{await rm(ws,{recursive:true,force:true});}
 assert.equal(workCatalog().permissions.lead_missions.includes('never_send_or_publish'),true);
 assert.equal(missionSummary('{"mission":null}').status,'none');
});

test('device API: Qwen can start, read, add, pause and resume, but never stop or skip',async()=>{
 let t=1000,n=0;const uuid=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');
 const kv=new Map(),lists=new Map();
 const command=async args=>{const [op,k,...rest]=args;
  if(op==='GET')return kv.get(k)??null;if(op==='SET'){if(rest.includes('NX')&&kv.has(k))return null;kv.set(k,rest[0]);return 'OK';}
  if(op==='LPUSH'){const l=lists.get(k)||[];l.unshift(rest[0]);lists.set(k,l);return 1;}if(op==='LTRIM'||op==='EXPIRE')return 1;
  if(op==='LRANGE')return lists.get(k)||[];if(op==='MGET')return [k,...rest].map(x=>kv.get(x)??null);
  if(op==='EVAL'){if(kv.get(rest[1])!==rest[2])return 0;kv.set(rest[1],rest[3]);return 1;}throw Error(op);};
 const queue=createForgeLeadJobQueue({command,now:()=>(t+=10),uuid});
 const missions=createForgeMissions({command,queue,now:()=>(t+=10),uuid});
 const bridge={status:async()=>({paired:true,device_id:'device-abcdef'}),authorizeActiveDevice:async b=>{if(b!=='dev')throw Object.assign(new Error('no'),{status:401});return {owner:'o1',device_id:'device-abcdef'};}};
 const handler=createForgeLeadJobsHandler({queue,missions,bridge,resolveAccount:async()=>null});
 const call=async(action,input)=>{const out={};const res={setHeader(){},status(c){out.status=c;return this;},json(b){out.body=b;return this;}};
  await handler({method:'POST',headers:{host:'x.test','content-type':'application/json',authorization:'Bearer dev'},body:{action,input}},res);return out;};
 const started=await call('device_mission_start',{request_id:'qabcdef123456',business:'barbers',count:5,max_cities:2,region:'anywhere'});
 assert.equal(started.status,200);assert.equal(started.body.result.mission.tasks.length,2);assert.match(started.body.result.mission.tasks[0].city,/Iowa$/);
 assert.equal((await call('device_mission_get',{})).body.result.mission.progress.total,2);
 assert.equal((await call('device_mission_add',{cities:['Boone']})).body.result.mission.tasks[2].added_by,'qwen');
 assert.equal((await call('device_mission_control',{control:'pause'})).body.result.mission.status,'paused');
 assert.equal((await call('device_mission_control',{control:'resume'})).body.result.mission.status,'active');
 assert.equal((await call('device_mission_control',{control:'stop'})).status,403);
 assert.equal((await call('device_mission_control',{control:'skip'})).status,403);
});

test('transport script validates every mission field before it uses the device token',async()=>{
 const ps=await readFile(new URL('../scripts/ally/forge-lead-transport.ps1',import.meta.url),'utf8');
 for(const a of ['mission_get','mission_start','mission_add','mission_control'])assert.match(ps,new RegExp(a));
 assert.ok(ps.indexOf("throw 'Invalid mission'")<ps.indexOf('Import-Clixml'));
 assert.match(ps,/\^\(pause\|resume\)\$/);
 assert.match(ps,/nexus-labs-sigma\.vercel\.app\/api\/forge-lead-jobs/);
});
