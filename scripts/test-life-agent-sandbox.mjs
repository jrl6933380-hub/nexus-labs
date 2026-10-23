import '../lib/store/installFetch.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
// Deterministic Life-agent scenarios through the real askNex loop and dispatch.
// Only local Redis/model transport are substituted; no Qwen or device-push claims.
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.argv[2]?path.resolve(process.argv[2]):await fs.mkdtemp(path.join(os.tmpdir(),'nexus-agent-sandbox-'));
await fs.mkdir(output,{recursive:true});
if((await fs.readdir(output)).length)throw new Error('Use an empty output directory so sandbox sessions cannot mix.');
console.log('SANDBOX_OUTPUT',output);
let modelReply,failNextScheduleWrite=false;
for(const name of ['E2B_API_KEY','ANTHROPIC_API_KEY','AI_GATEWAY_API_KEY','GITHUB_TOKEN','VERCEL_TOKEN','OPENAI_API_KEY'])delete process.env[name];
Object.assign(process.env,{KV_REST_API_URL:'https://sandbox-kv.invalid',KV_REST_API_TOKEN:'sandbox-only',RUNPOD_API_KEY:'sandbox-only',NEX_POD_KEY:'sandbox-only',NEX_QWEN_ONLY:'true',NEXUS_OWNER_ID:'justin',NEXUS_FORGE_OWNER_USERNAME:'Mrlopez',NEXUS_OPERATOR_USERNAMES:'Mrlopez'});
process.chdir(repo);
const db=new Map(),trace=[];let sequence=0,outages=0;
function hash(key){if(!db.has(key))db.set(key,new Map());return db.get(key);}
function list(key){if(!db.has(key))db.set(key,[]);return db.get(key);}
async function redis(parts){
 const [op,k,...args]=parts;
 switch(op){
 case 'GET':return db.get(k) ?? null;
 case 'SET':if(args.includes('NX') && db.has(k))return null;db.set(k,args[0]);return 'OK';
 case 'DEL':return Number(db.delete(k));
 case 'EXPIRE':return 1;
 case 'HGET':return db.get(k)?.get(args[0]) ?? null;
 case 'HSET':{let added=0;for(let i=0;i<args.length;i+=2){if(!hash(k).has(args[i]))added++;hash(k).set(args[i],args[i+1]);}return added;}
 case 'HDEL':return args.reduce((n,a)=>n+Number(db.get(k)?.delete(a) || false),0);
 case 'HGETALL':return [...(db.get(k) || new Map())].flat();
 case 'HVALS':return [...(db.get(k)?.values() || [])];
 case 'HMGET':return args.map(a=>db.get(k)?.get(a) ?? null);
 case 'MGET':return [k,...args].map(a=>db.get(a) ?? null);
 case 'LPUSH':list(k).unshift(...args);return list(k).length;
 case 'RPUSH':list(k).push(...args);return list(k).length;
 case 'LRANGE':return list(k).slice(Number(args[0]),Number(args[1])===-1?undefined:Number(args[1])+1);
 case 'LTRIM':db.set(k,list(k).slice(Number(args[0]),Number(args[1])===-1?undefined:Number(args[1])+1));return 'OK';
 case 'EVAL':{
  const script=k,count=Number(args[0]),keys=args.slice(1,1+count),values=args.slice(1+count);
  if(script.includes("redis.call('GET',KEYS[1])") && count===2){if(db.get(keys[0])!==values[0])return 0;db.set(keys[1],values[1]);db.delete(keys[0]);return 1;}
  if(script.includes("redis.call('GET',KEYS[1])") && count===1){if(db.get(keys[0])!==values[0])return 0;db.delete(keys[0]);return 1;}
  if(script.includes("redis.call('LPUSH',KEYS[1]")){await redis(['LPUSH',keys[0],values[0]]);return 1;}
  if(script.includes('HINCRBY'))return 1; // usage telemetry only
  throw new Error('Unsupported Redis script: '+script.slice(0,120));
 }
 default:throw new Error('Unsupported Redis operation '+op);
 }
}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
global.fetch=async(url,options={})=>{
 const target=String(url);
 if(target==='https://sandbox-kv.invalid'){
  const command=JSON.parse(options.body);
  if(failNextScheduleWrite && command[0]==='HSET' && command[1].startsWith('nexus:schedule:items:')){failNextScheduleWrite=false;return response({error:'Injected storage write failure'});}
  return response({result:await redis(command)});
 }
 if(target==='https://rest.runpod.io/v1/pods')return response([{id:'sandbox',name:'nex-pod',desiredStatus:'RUNNING'}]);
 if(target==='https://sandbox-8000.proxy.runpod.net/v1/models')return response({data:[{id:'nex-base'}]});
 if(target==='https://sandbox-8000.proxy.runpod.net/v1/chat/completions'){
  if(outages>0){outages--;trace.push({type:'injected-provider-outage'});return response({error:'Injected sandbox timeout'},504);}
  const request=JSON.parse(options.body),id=++sequence;
  const answer=await modelReply(request,id);
  trace.push({type:'model-reply',id,tool_calls:answer.tool_calls?.map(t=>t.function.name) || []});
  if(answer.outage){outages=1;return response({error:'Injected sandbox timeout'},504);}
  return response({model:'nex-base',choices:[{finish_reason:answer.tool_calls?.length?'tool_calls':'stop',message:{role:'assistant',...answer}}],usage:{prompt_tokens:0,completion_tokens:0}});
 }
 throw new Error('SANDBOX EXTERNAL REQUEST BLOCKED: '+target);
};
const {askNex}=await import(path.join(repo,'lib/nexBrain.js'));
const {listPlannerItems}=await import(path.join(repo,'lib/planner.js'));
const {reminderStore}=await import(path.join(repo,'lib/reminders.js'));
const {lifeStore}=await import(path.join(repo,'lib/life.js'));
const {duePushNotifications}=await import(path.join(repo,'lib/pushNotifications.js'));
let scenarioId=0,queue=[],lastTool=null,fixtureError=null;
const results=[];
function parsed(request){const last=request.messages.at(-1);if(last?.role!=='tool')return null;const text=last.content;try{return JSON.parse(text.replace(/^Planner item (?:created|updated|deleted): /u,''));}catch{return {error:text};}}
function step(name,args,verify){queue.push({name,args,verify});}
modelReply=async(request,id)=>{try{
  lastTool=parsed(request);
  const next=queue.shift();
  if(!next)return {content:'Sandbox verification complete. Only confirmed tool outcomes are reported.'};
  if(next.verify)await next.verify(lastTool,request);
  if(next.outage)return {outage:true};
  if(!next.name)return {content:'Sandbox step complete.'};
  const tool=request.tools.find(t=>t.function.name===next.name);
  assert.ok(tool,`${next.name} must be discoverable in the active scope`);
  const args=typeof next.args==='function'?next.args(lastTool):next.args;
  for(const key of Object.keys(args || {}))assert.ok(Object.hasOwn(tool.function.parameters.properties,key),`${next.name} schema does not expose ${key}`);
  for(const key of tool.function.parameters.required || [])assert.ok(Object.hasOwn(args,key),`Missing ${next.name}.${key}`);
  return {content:'Checking the requested private records.',tool_calls:[{id:`life-fixture-${id}`,type:'function',function:{name:next.name,arguments:JSON.stringify(args || {})}}]};
}catch(error){fixtureError=error;throw error;}};
function expect(verify){queue.push({verify});}
function good(value){assert.ok(value && !value.error,JSON.stringify(value));return value;}
async function turn(message='Operate Life, calendar schedule and reminders for this approved sandbox scenario.',extra={}){
  const context={timezone:'America/Chicago',conversation:{id:`vida-sandbox-${scenarioId}`,kind:'specialist',name:'Vida',role:'life',scopes:['conversation','schedule','reminders','life'],execution_mode:'approved'}};
  const result=await askNex(message,[],'standard',context,null,{userId:'justin',scheduleUserId:`owner:life-sandbox-${scenarioId}`,allowAgentDelegation:false,...extra});
  if(fixtureError)throw fixtureError;
  assert.equal(queue.length,0,'All model fixture steps should execute');
  return result;
}
const user=()=>`owner:life-sandbox-${scenarioId}`;
async function scenario(name,run){scenarioId++;queue=[];outages=0;fixtureError=null;try{await run();results.push({name,status:'passed'});console.log('PASS',name);}catch(error){results.push({name,status:'failed',error:error.message});console.log('FAIL',name,error.message);}}
const start='2026-10-13T09:00:00-05:00',end='2026-10-13T10:00:00-05:00';
const saveArgs=(preview,destination='linked')=>{good(preview);const keys=['id','kind','title','pillar','starts_at','ends_at','due_date','due_at','notes','person','place','protected','created_at','updated_at','reminder_minutes','end_reminder','timezone'];return {...Object.fromEntries(keys.filter(k=>Object.hasOwn(preview.item,k)).map(k=>[k,preview.item[k]])),action:'save',baseline:preview.baseline,destination};};
await scenario('Live clock, local tomorrow, in-place move and account isolation',async()=>{
  let id,tomorrow;
  step('get_current_time',{},clock=>{assert.equal(clock,null);});
  step('read_planner',{},clock=>{good(clock);assert.equal(clock.timezone,'America/Chicago');tomorrow=clock.tomorrow;});
  step('create_planner_item',()=>({title:'Approved workout',starts_at:`${tomorrow}T10:00`,ends_at:`${tomorrow}T11:00`,category:'gym',reminder_minutes:15}),data=>assert.equal(data.items.length,0));
  step('update_planner_item',data=>{id=good(data).id;return {id,starts_at:`${tomorrow}T11:00`,ends_at:`${tomorrow}T12:00`};});
  step('read_planner',{},data=>assert.equal(good(data).id,id));expect(data=>{assert.equal(data.items.length,1);assert.equal(data.items[0].id,id);assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',hourCycle:'h23'}).format(new Date(data.items[0].starts_at)),'11');});
  await turn();assert.equal((await listPlannerItems({},'owner:other-account')).length,0);
});
await scenario('Calendar range includes sleep crossing into the requested day',async()=>{
  step('create_planner_item',{title:'Sleep',starts_at:'2026-10-12T23:00:00-05:00',ends_at:'2026-10-13T07:00:00-05:00',category:'rest'});
  step('read_planner',{from:'2026-10-13T00:00:00-05:00',to:'2026-10-14T00:00:00-05:00'},good);expect(data=>assert.equal(data.items.length,1,'Overnight sleep must appear in a day review'));await turn();
});
await scenario('Overrun conflict leaves fixed and flexible commitments unchanged',async()=>{
  let focus,before;
  step('create_planner_item',{title:'Focus',starts_at:start,ends_at:end,flexibility:'flexible'});
  step('create_planner_item',{title:'Family',starts_at:'2026-10-13T10:30:00-05:00',ends_at:'2026-10-13T11:30:00-05:00',protected:true,flexibility:'fixed'},data=>{focus=good(data).id;});
  step('read_planner',{},good);
  step('adjust_schedule_overrun',()=>({id:focus,ends_at:'2026-10-13T11:00:00-05:00',day_end:'2026-10-14T00:00:00-05:00'}),data=>{before=data.items;});
  step('adjust_schedule_overrun',data=>({id:focus,ends_at:'2026-10-13T11:00:00-05:00',day_end:'2026-10-14T00:00:00-05:00',apply:true,baseline:good(data).baseline}),data=>assert.ok(data.conflicts.length));
  step('read_planner',{},data=>assert.ok(data.error));expect(data=>assert.deepEqual(data.items,before));await turn();
});
await scenario('Daily reminder is discoverable and preserves local time across DST',async()=>{
  let id;
  step('manage_reminder',{action:'create',title:'Morning routine',repeat:'daily',timezone:'America/Chicago',due_date:'2026-10-31',due_at:'2026-10-31T09:00:00-05:00'});
  step('manage_reminder',data=>({action:'update',id:(id=good(data).id),status:'done'}));
  step('read_reminders',{},good);expect(data=>{assert.equal(data.items.length,2);assert.equal(data.items.find(i=>i.id!==id).due_at,'2026-11-01T15:00:00.000Z');});await turn();
});
await scenario('Life preview, linked save, alert settings and honest actual time',async()=>{
  let id;
  step('manage_life',{action:'preview',title:'Walk',pillar:'health',starts_at:start,ends_at:end,reminder_minutes:10,end_reminder:true});
  step('manage_life',data=>{id=good(data).item.id;return saveArgs(data);});
  step('read_life',{},good);expect(data=>{assert.equal(data.items.length,1);assert.equal(data.summary.accounted,0);assert.equal(data.summary.pillars.health.actual_minutes,0);});await turn();
  const blocks=await listPlannerItems({},user());assert.equal(blocks.length,1);assert.equal(blocks[0].reminder_minutes,10);
  const notifications=duePushNotifications({schedule:blocks,now:Date.parse(start)-10*60000});assert.equal(notifications.length,1);assert.match(notifications[0].url,/view=life/);
  step('manage_life',{action:'check_in',id,outcome:'happened',actual_starts_at:'2026-10-13T09:10:00-05:00',actual_ends_at:'2026-10-13T09:40:00-05:00',energy:4});
  step('read_life',{},good);expect(data=>assert.equal(data.summary.pillars.health.actual_minutes,30));await turn();
});
await scenario('Removing linked Life reminder time releases its reserved calendar block',async()=>{
  let id;
  step('manage_life',{action:'preview',kind:'reminder',title:'Call family',pillar:'social',starts_at:start,ends_at:end});
  step('manage_life',data=>{id=good(data).item.id;return saveArgs(data);});expect(good);await turn();
  assert.equal((await listPlannerItems({},user())).length,1);
  step('manage_life',{action:'preview',id,starts_at:null,ends_at:null});step('manage_life',data=>saveArgs(data));expect(good);await turn();
  assert.equal((await listPlannerItems({},user())).length,0,'Cleared reservation must disappear');
  assert.equal((await reminderStore.list(user())).length,1,'Keep the reminder itself');
});
await scenario('Rejected Life reminder check-in cannot partially complete linked records',async()=>{
  let id;
  step('manage_life',{action:'preview',kind:'reminder',title:'Call family',pillar:'social',starts_at:start,ends_at:end});
  step('manage_life',data=>{id=good(data).item.id;return saveArgs(data);});expect(good);await turn();
  step('manage_life',{action:'check_in',id,status:'done',memory_url:'http://invalid.example'});expect(data=>assert.match(data.error,/https/));await turn();
  assert.equal((await reminderStore.list(user()))[0].status,'planned','Rejected check-in must not complete the reminder');
  assert.equal((await listPlannerItems({},user()))[0].status,'planned');
});
await scenario('Timed reminder rejects a due date that disagrees with the local alert date',async()=>{
  step('manage_reminder',{action:'create',title:'Wrong date',due_date:'2026-10-14',due_at:'2026-10-13T09:00:00-05:00'});expect(data=>assert.ok(data.error,'Date mismatch must be actionable instead of silently saved'));await turn();
  assert.equal((await reminderStore.list(user())).length,0);
});
await scenario('Life save interruption resumes by reading the saved record, without duplicates',async()=>{
  let id;
  step('manage_life',{action:'preview',title:'Walk',pillar:'health',starts_at:start,ends_at:end});
  step('manage_life',data=>{id=good(data).item.id;return saveArgs(data);});queue.push({outage:true,verify:good});
  const interrupted=await turn();assert.equal(interrupted.provider,'none');assert.equal(interrupted.runState.state,'waiting');
  step('read_life',{});expect(data=>{assert.equal(data.items.length,1);assert.equal(data.items[0].id,id);});
  const resumed=await turn('Continue the Life and calendar assignment. Read saved work before making changes.',{resumeRunId:interrupted.runState.runId});assert.equal(resumed.runState.resumed,true);
  assert.equal((await lifeStore.overview(user())).items.length,1);assert.equal((await listPlannerItems({},user())).length,1);
});
await scenario('Late-night Life reminder retains its local date when linked to Reminders',async()=>{
  step('manage_life',{action:'preview',kind:'reminder',title:'Night reminder',due_date:'2026-10-13',due_at:'2026-10-13T23:30:00-05:00'});
  step('manage_life',data=>saveArgs(data));step('read_reminders',{},good);
  expect(data=>{assert.equal(data.items.length,1);assert.equal(data.items[0].due_date,'2026-10-13');assert.equal(data.items[0].due_at,'2026-10-14T04:30:00.000Z');assert.equal(data.items[0].timezone,'America/Chicago');});await turn();
});
await scenario('Vida can ask, pause with no writes, then use the user’s answer',async()=>{
  step('ask_user_question',{question:'Where should I keep your walk?',options:['Life only','Link to calendar'],blocking:true});
  const waiting=await turn('Help me choose where to put a walk in Life and the calendar. Ask before saving.');
  assert.ok(waiting.question);assert.equal((await lifeStore.overview(user())).items.length,0);
  step('manage_life',{action:'preview',title:'Walk',pillar:'health',starts_at:start,ends_at:end});
  step('manage_life',data=>saveArgs(data,'life'));expect(good);
  await turn('My answer is Life only. I approve saving the walk tomorrow at 9 to 10 in Life without linking it to calendar.',{resumeRunId:waiting.runState.runId});
  assert.equal((await listPlannerItems({},user())).length,0);assert.equal((await lifeStore.overview(user())).items.length,1);
});
await scenario('Ambiguous daylight-saving time produces an actionable error without writing',async()=>{
  step('create_planner_item',{title:'Ambiguous time',starts_at:'2026-11-01T01:30',ends_at:'2026-11-01T02:30'});expect(data=>assert.match(data.error,/ambiguous/));await turn();
  assert.equal((await listPlannerItems({},user())).length,0);
});
await scenario('Scoped customer cannot edit another account’s calendar item',async()=>{
  let id;
  step('create_planner_item',{title:'Private commitment',starts_at:start,ends_at:end});expect(data=>{id=good(data).id;});await turn();
  step('read_planner',{});step('update_planner_item',()=>({id,title:'Hijacked'}),data=>assert.equal(data.items.length,0));expect(data=>assert.match(data.error,/not found/));
  await turn('Update the calendar item from this provided ID.',{userId:'customer-sandbox',scheduleUserId:'room:customer-sandbox'});
  assert.equal((await listPlannerItems({},user()))[0].title,'Private commitment');
});
await scenario('Reminder reservation, calendar completion, reopening and deletion keep one link',async()=>{
  let id,blockId;
  step('manage_reminder',{action:'create',title:'Call family'});
  step('manage_reminder',data=>({action:'schedule',id:(id=good(data).id),starts_at:start,ends_at:end,apply:false}));
  step('manage_reminder',()=>({action:'schedule',id,starts_at:start,ends_at:end,apply:true}),data=>assert.equal(good(data).conflicts.length,0));
  step('update_planner_item',data=>({id:(blockId=good(data).block.id),status:'done'}));
  step('read_reminders',{},good);
  step('manage_reminder',()=>({action:'update',id,status:'planned'}),data=>assert.equal(data.items[0].status,'done'));
  step('read_planner',{},good);
  step('manage_reminder',()=>({action:'delete',id}),data=>{assert.equal(data.items.length,1);assert.equal(data.items[0].id,blockId);assert.equal(data.items[0].status,'planned');});
  step('read_reminders',{},good);expect(data=>assert.equal(data.items.length,0));await turn();assert.equal((await listPlannerItems({},user())).length,0);
});
await scenario('Life weekly reset is previewed, repeat-safe and never invents experience',async()=>{
  let source,preview;
  step('manage_life',{action:'preview',title:'Walk',pillar:'health',starts_at:start,ends_at:end});step('manage_life',data=>{source=good(data).item.id;return saveArgs(data,'life');});
  step('manage_life',()=>({action:'check_in',id:source,use_planned_times:true,energy:4}),good);
  step('manage_life',()=>({action:'preview_week',entries:[{source_id:source,copy_date:'2026-10-20',starts_at:'2026-10-20T09:00:00-05:00',ends_at:'2026-10-20T10:00:00-05:00'}]}),good);
  step('manage_life',data=>{preview=good(data);assert.equal(preview.conflicts.length,0);preview.entries=preview.entries.map(entry=>Object.fromEntries(['source_id','copy_date','title','starts_at','ends_at','created_at','updated_at'].filter(key=>Object.hasOwn(entry,key)).map(key=>[key,entry[key]])));return {action:'save_week',entries:preview.entries,baseline:preview.baseline};});
  step('manage_life',()=>({action:'preview_week',entries:preview.entries}),good);
  step('manage_life',data=>({action:'save_week',entries:good(data).entries.map(entry=>Object.fromEntries(['source_id','copy_date','title','starts_at','ends_at','created_at','updated_at'].filter(key=>Object.hasOwn(entry,key)).map(key=>[key,entry[key]]))),baseline:data.baseline}));
  step('read_life',{},good);expect(data=>{assert.equal(data.items.length,2);const copy=data.items.find(item=>item.id!==source);assert.equal(copy.outcome,'unknown');assert.equal(copy.energy,null);assert.equal(copy.link,null);assert.equal(data.summary.accounted,1);});await turn();
});
await scenario('Calendar storage errors cannot be reported as successful saves',async()=>{
  step('create_planner_item',()=>{failNextScheduleWrite=true;return {title:'Unsaved block',starts_at:start,ends_at:end};});
  expect(data=>assert.match(data.error,/failed/));await turn();assert.equal((await listPlannerItems({},user())).length,0);
});
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({results,modelRequests:sequence,trace},null,2));
console.log(JSON.stringify({passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,modelRequests:sequence,report:path.join(output,'report.json')}));
process.exitCode=results.some(r=>r.status==='failed')?1:0;
