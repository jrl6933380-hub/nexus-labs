import '../lib/store/installFetch.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
// Human-model sandbox: real agent loop and tool dispatch; local storage and
// model transport substitutes. No Qwen behavior or browser verification claims.
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.argv[2]?path.resolve(process.argv[2]):await fs.mkdtemp(path.join(os.tmpdir(),'nexus-agent-sandbox-'));
await fs.mkdir(output,{recursive:true});
if((await fs.readdir(output)).length)throw new Error('Use an empty output directory so sandbox sessions cannot mix.');
console.log('SANDBOX_OUTPUT',output);
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
 if(target==='https://sandbox-kv.invalid')return response({result:await redis(JSON.parse(options.body))});
 if(target==='https://rest.runpod.io/v1/pods')return response([{id:'sandbox',name:'nex-pod',desiredStatus:'RUNNING'}]);
 if(target==='https://sandbox-8000.proxy.runpod.net/v1/models')return response({data:[{id:'nex-base'}]});
 if(target==='https://sandbox-8000.proxy.runpod.net/v1/chat/completions'){
  if(outages>0){outages--;trace.push({type:'injected-provider-outage'});return response({error:'Injected sandbox timeout'},504);}
  const request=JSON.parse(options.body),id=++sequence;
  await fs.writeFile(path.join(output,`request-${id}.json`),JSON.stringify(request,null,2));
  console.log('MODEL_REQUEST',id,'tools:',request.tools?.map(t=>t.function.name).join(','));
  while(true){
   if(options.signal?.aborted)throw new Error('Sandbox response wait timed out');
   let answer;try{answer=JSON.parse(await fs.readFile(path.join(output,`response-${id}.json`),'utf8'));}catch{}
   if(answer){
    trace.push({type:'model-reply',id,tool_calls:answer.tool_calls?.map(t=>t.function.name) || [],text:answer.content || '',outage:answer.outage || false});
    if(answer.outage){outages=1;return response({error:'Injected sandbox timeout'},504);}
    return response({model:'nex-base',choices:[{finish_reason:answer.tool_calls?.length?'tool_calls':'stop',message:{role:'assistant',...answer}}],usage:{prompt_tokens:0,completion_tokens:0}});
   }
   await new Promise(resolve=>setTimeout(resolve,40));
  }
 }
 throw new Error('SANDBOX EXTERNAL REQUEST BLOCKED: '+target);
};
const {createTeamRunStore}=await import(path.join(repo,'lib/teamRuns.js'));
const {createTeamRunner}=await import(path.join(repo,'lib/teamRunner.js'));
const {CORE_SPECIALISTS}=await import(path.join(repo,'lib/nexusMessagesStore.js'));
const {listProjects}=await import(path.join(repo,'lib/roomHistory.js'));
const roster=CORE_SPECIALISTS;
const runs=createTeamRunStore({command:redis});
const group={id:'group-sandbox',member_ids:roster.map(m=>m.id)};
const runner=createTeamRunner({runs,messages:{overview:async()=>({specialists:roster,groups:[group]})},mode:async()=>({mode:'engaged'}),history:async()=>null});
const run=await runs.create('justin',group.id,roster,'Build a fresh bodyweight workout timer. Use only these supplied requirements: a 30-second countdown with start, pause and reset, and a daily goal checklist saved between visits. Vida scopes goals; Mason builds; Vera checks the saved result. No research sources are required.','sandbox-workout-001',{includeNex:true,autoStart:true});
console.log('TEAM_ORDER',run.steps.map(s=>s.name));
for(let tick=0;tick<100;tick++){
 let [current]=await runs.list('justin',group.id);
 if(current.state==='completed'){await fs.writeFile(path.join(output,'report.json'),JSON.stringify({run:current,projects:await listProjects('Mrlopez'),trace},null,2));console.log('COMPLETED');process.exit(0);}
 if(current.state==='needs_approval'){
  const step=current.steps.find(s=>s.state==='needs_approval');await runs.act('justin',group.id,run.id,'approve_step',step.id);console.log('SANDBOX_BUILD_GRANT',step.name);continue;
 }
 if(current.state==='waiting_input'){
  const step=current.steps.find(s=>s.state==='waiting_input');
  console.log('USER_ANSWER_NEEDED',step.question);await fs.writeFile(path.join(output,'question.json'),JSON.stringify(step.question));
  let answer;while(!answer){try{answer=JSON.parse(await fs.readFile(path.join(output,'answer.json'),'utf8'));}catch{}if(!answer)await new Promise(resolve=>setTimeout(resolve,40));}
  await runs.act('justin',group.id,run.id,'answer',step.id,null,{question_id:step.question.id,answer:answer.answer});continue;
 }
 if(current.state==='blocked'){console.log('BLOCKED',current.steps.find(s=>s.state==='blocked'));await fs.writeFile(path.join(output,'report.json'),JSON.stringify({run:current,trace},null,2));process.exit(1);}
 const retry=current.steps.find(s=>s.state==='retrying');if(retry?.retry_at>Date.now()){await new Promise(resolve=>setTimeout(resolve,Math.min(30000,retry.retry_at-Date.now())));continue;}
 console.log('EXECUTE',current.steps.find(s=>s.state!=='returned')?.name);
 await runner.execute('justin',group.id,run.id);
}
throw new Error('Sandbox tick limit reached');
