import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runScript} from '../lib/store/lua.js';
import {createPhoneBridge,validatePhoneCommand} from '../lib/phoneBridge.js';
import {createPhoneHandler} from '../api/phone.js';
import {createWorkspaceService} from '../lib/workspaceConnector.js';
import {WORKSPACE_TOOLS,registerWorkspaceBoard} from '../lib/workspaceBoard.js';
function fixture(){const data=new Map(),ttl=new Map();let time=100000,chain=Promise.resolve();
 const primitive=async([op,key,...a])=>{if(ttl.has(key)&&ttl.get(key)<=time){data.delete(key);ttl.delete(key);}if(op==='GET')return data.get(key)??null;if(op==='SET'){data.set(key,a[0]);const ex=a.indexOf('EX');if(ex>=0)ttl.set(key,time+Number(a[ex+1])*1000);return 'OK';}if(op==='DEL'){data.delete(key);return 1;}if(op==='HGET')return data.get(key)?.get(a[0])??null;if(op==='HSET'){const m=data.get(key)||new Map();m.set(a[0],a[1]);data.set(key,m);return 1;}throw Error(op);};
 const command=async a=>{if(a[0]!=='EVAL')return primitive(a);const n=Number(a[2]),work=chain.then(()=>runScript(a[1],{keys:a.slice(3,3+n),argv:a.slice(3+n),redisCall:primitive}));chain=work.catch(()=>{});return work;};
 return {bridge:createPhoneBridge({command,now:()=>time}),data,advance:ms=>time+=ms};}
async function connected(f,owner='justin'){const code=await f.bridge.pairCode(owner),paired=await f.bridge.pair(code.code,'TCL ION V'),session=randomUUID();await f.bridge.start(paired.token,session);await f.bridge.poll(paired.token,session,true);return {...paired,session};}
async function screen(f,p){const q=await f.bridge.enqueue('justin',{action:'screen'});await f.bridge.poll(p.token,p.session,true);await f.bridge.complete(p.token,p.session,q.command_id,{ok:true,image_base64:'/9j/AAAA',width:720,height:1440});return q.command_id;}
test('single-use owner pairing is atomic and token is absent from status and stored records',async()=>{const f=fixture(),code=await f.bridge.pairCode('justin');const attempts=await Promise.allSettled([f.bridge.pair(code.code,'One'),f.bridge.pair(code.code,'Two')]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);const token=attempts.find(x=>x.status==='fulfilled').value.token;assert.ok(!JSON.stringify(await f.bridge.status('justin')).includes(token));assert.ok(!f.data.get('nexus:phone:v1').get('justin').includes(token));assert.deepEqual(await f.bridge.status('other'),{paired:false,active:false});});
test('expired and superseded pairing codes fail; replacement and revoke invalidate old phone',async()=>{const f=fixture(),old=await f.bridge.pairCode('justin');await f.bridge.pairCode('justin');await assert.rejects(f.bridge.pair(old.code,'Old'));const expired=await f.bridge.pairCode('justin');f.advance(300001);await assert.rejects(f.bridge.pair(expired.code,'Expired'));const p=await connected(f);await connected(f);await assert.rejects(f.bridge.poll(p.token,p.session,true),/revoked/);const fresh=await connected(f);await f.bridge.stop('justin',true);await assert.rejects(f.bridge.start(fresh.token,randomUUID()),/revoked/);});
test('command delivery is at-most-once under racing polls and completion returns image only to owner',async()=>{const f=fixture(),p=await connected(f),q=await f.bridge.enqueue('justin',{action:'screen'});const polled=await Promise.all([f.bridge.poll(p.token,p.session,true),f.bridge.poll(p.token,p.session,true)]);assert.equal(polled.filter(r=>r.command).length,1);await f.bridge.complete(p.token,p.session,q.command_id,{ok:true,image_base64:'/9j/AAAA',width:720,height:1440});const r=await f.bridge.result('justin',q.command_id);assert.equal(r.inline_images[0].data_base64,'/9j/AAAA');assert.equal(r.frame_id,q.command_id);assert.equal((await f.bridge.result('other',q.command_id)).status,'unavailable');assert.deepEqual(await f.bridge.complete(p.token,p.session,q.command_id,{ok:true}),{accepted:true});f.advance(120001);assert.equal((await f.bridge.result('justin',q.command_id)).status,'unavailable');});
test('fresh frame required, pending queue bounded, sensitive input removed at delivery and frame invalidated after action',async()=>{const f=fixture(),p=await connected(f);await assert.rejects(f.bridge.enqueue('justin',{action:'tap',x:.2,y:.4,frame_id:randomUUID()}),/stale/);const frame=await screen(f,p);const q=await f.bridge.enqueue('justin',{action:'type',text:'private input',frame_id:frame});await assert.rejects(f.bridge.enqueue('justin',{action:'home'}),/pending/);const r=await f.bridge.poll(p.token,p.session,true);assert.equal(r.command.input.text,'private input');assert.ok(!f.data.get('nexus:phone:v1').get('justin').includes('private input'));await f.bridge.complete(p.token,p.session,q.command_id,{ok:true});await assert.rejects(f.bridge.enqueue('justin',{action:'tap',x:.2,y:.4,frame_id:frame}),/stale/);});
test('stop fences old results, old completions, polls and reconnection sessions',async()=>{const f=fixture(),p=await connected(f),frame=await screen(f,p);const q=await f.bridge.enqueue('justin',{action:'home'});await f.bridge.poll(p.token,p.session,true);await f.bridge.stop('justin');assert.equal((await f.bridge.poll(p.token,p.session,true)).active,false);await assert.rejects(f.bridge.result('justin',frame),/stopped/);await assert.rejects(f.bridge.complete(p.token,p.session,q.command_id,{ok:true}),/stopped/);await assert.rejects(f.bridge.enqueue('justin',{action:'home'}),/Connect/);const newer=randomUUID();await f.bridge.start(p.token,newer);assert.equal((await f.bridge.poll(p.token,p.session,true)).active,false);await f.bridge.disconnect(p.token,p.session);assert.equal((await f.bridge.poll(p.token,newer,true)).active,true);});
test('offline, unavailable accessibility, expired commands and stale frames fail clearly',async()=>{const f=fixture(),p=await connected(f);const frame=await screen(f,p);f.advance(30001);await f.bridge.poll(p.token,p.session,true);await assert.rejects(f.bridge.enqueue('justin',{action:'tap',x:.2,y:.4,frame_id:frame}),/stale/);const q=await f.bridge.enqueue('justin',{action:'home'});await f.bridge.poll(p.token,p.session,true);f.advance(45001);await assert.rejects(f.bridge.complete(p.token,p.session,q.command_id,{ok:true}),/expired/);assert.equal((await f.bridge.result('justin',q.command_id)).status,'expired');await assert.rejects(f.bridge.enqueue('justin',{action:'home'}),/Connect/);await f.bridge.poll(p.token,p.session,false);await assert.rejects(f.bridge.enqueue('justin',{action:'home'}),/accessibility/);});
test('command schema rejects arbitrary shell, non-finite coordinates and unexpected fields',()=>{for(const c of [{action:'shell',text:'id'},{action:'tap',x:NaN,y:0,frame_id:randomUUID()},{action:'tap',x:2,y:0,frame_id:randomUUID()},{action:'home',extra:1},{action:'open_app',package_name:'x; rm'},{action:'type',text:'x'.repeat(2001),frame_id:randomUUID()}])assert.throws(()=>validatePhoneCommand(c));assert.deepEqual(validatePhoneCommand({action:'open_app',package_name:'com.android.chrome'}),{action:'open_app',package_name:'com.android.chrome'});});
const request=(body,headers={})=>({method:'POST',headers:{host:'nexus.test',origin:'https://nexus.test','content-type':'application/json',...headers},body});
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(d){this.body=d;return this;}});
test('HTTP routes require owner or paired phone, refuse cross-site and unsupported fields',async()=>{const f=fixture();const handler=createPhoneHandler({bridge:f.bridge,resolveAccount:async()=>({id:'customer',owner:false})});async function run(body,headers){const res=response();await handler(request(body,headers),res);return res;}
 assert.equal((await run({action:'pair_code'})).code,403);assert.equal((await run({action:'status'},{origin:'https://evil.test'})).code,403);assert.equal((await run({action:'poll',session_id:randomUUID()})).code,401);assert.equal((await run({action:'pair',code:'X',label:'TCL',owner:'victim'})).code,400);const p=await connected(f);const ok=await run({action:'poll',session_id:p.session,accessibility:true},{authorization:'Bearer '+p.token});assert.equal(ok.code,200);assert.equal(ok.body.active,true);assert.equal(ok.headers['Cache-Control'],'private, no-store');});
test('workspace tools enforce customer exclusion and screen results become actual MCP images',async()=>{const f=fixture(),service=createWorkspaceService({phone:f.bridge});const customer={id:'c',owner:false,workbenchUserId:'c',scheduleUserId:'c'};for(const action of ['phone_status','phone_command','phone_result','phone_stop'])await assert.rejects(service(action,action==='phone_command'?{command:{action:'home'}}:action==='phone_result'?{command_id:randomUUID()}:{},customer),/owner only/);
 const p=await connected(f),frame=await screen(f,p),registered=new Map();registerWorkspaceBoard({registerResource(){},registerTool(name,schema,fn){registered.set(name,fn);}},{authorize:async()=>{},call:async(action,input)=>service(action,input,{id:'justin',owner:true,workbenchUserId:'owner',scheduleUserId:'owner'})});
 const result=await registered.get('read_nexus_phone_result')({command_id:frame});assert.equal(result.content.find(c=>c.type==='image').mimeType,'image/jpeg');assert.ok(!JSON.stringify(result.structuredContent).includes('/9j/AAAA'));assert.equal(WORKSPACE_TOOLS.filter(t=>t[1].startsWith('phone_')).length,4);
});
test('v0.2 action image is a new usable frame and data stays owner/session scoped',async()=>{
 const f=fixture(),p=await connected(f),q=await f.bridge.enqueue('justin',{action:'home'});
 await f.bridge.poll(p.token,p.session,true);await f.bridge.complete(p.token,p.session,q.command_id,{ok:true,image_base64:'/9j/AAAA',width:720,height:1440});
 const r=await f.bridge.result('justin',q.command_id);assert.equal(r.frame_id,q.command_id);assert.equal(r.inline_images.length,1);
 const tap=await f.bridge.enqueue('justin',{action:'tap',x:.5,y:.5,frame_id:r.frame_id});await f.bridge.poll(p.token,p.session,true);
 await f.bridge.complete(p.token,p.session,tap.command_id,{ok:true,screen_error:'Protected screen.'});
 const done=await f.bridge.result('justin',tap.command_id);assert.equal(done.ok,true);assert.equal(done.screen_error,'Protected screen.');assert.equal(done.frame_id,undefined);
 await assert.rejects(f.bridge.enqueue('justin',{action:'tap',x:.5,y:.5,frame_id:r.frame_id}),/stale/);
 const info=await f.bridge.enqueue('justin',{action:'device_info'});await f.bridge.poll(p.token,p.session,true);
 await f.bridge.complete(p.token,p.session,info.command_id,{ok:true,data:{version:'0.2.0',device_owner:true,shizuku_ready:false}});
 assert.equal((await f.bridge.result('justin',info.command_id)).data.device_owner,true);assert.equal((await f.bridge.result('customer',info.command_id)).status,'unavailable');
 await f.bridge.stop('justin');await assert.rejects(f.bridge.result('justin',info.command_id),/stopped/);
});
test('deeper command schemas bound settings and block core apps and injection',()=>{
 for(const c of [{action:'brightness',value:0},{action:'brightness',value:256},{action:'brightness',value:12.5},{action:'stay_awake',enabled:'true'},{action:'open_nexus',view:'https://evil.test'},{action:'force_stop',package_name:'com.android.settings'},{action:'force_stop',package_name:'app.nexus.phone'},{action:'force_stop',package_name:'moe.shizuku.privileged.api'},{action:'force_stop',package_name:'com.example.x;id'},{action:'device_info',extra:1}])assert.throws(()=>validatePhoneCommand(c));
 for(const c of [{action:'brightness',value:180},{action:'stay_awake',enabled:false},{action:'open_nexus',view:'board'},{action:'force_stop',package_name:'com.example.playground'},{action:'list_apps'},{action:'notifications'},{action:'recents'}])assert.deepEqual(validatePhoneCommand(c),c);
 const schema=WORKSPACE_TOOLS.find(t=>t[0]==='control_nexus_phone')[3].command;
 assert.equal(schema.safeParse({action:'brightness',value:200}).success,true);assert.equal(schema.safeParse({action:'open_nexus',view:'evil'}).success,false);
});
test('data and image payloads cannot be confused, oversized or attached to the wrong operation',async()=>{
 const f=fixture(),p=await connected(f),q=await f.bridge.enqueue('justin',{action:'home'});await f.bridge.poll(p.token,p.session,true);
 await assert.rejects(f.bridge.complete(p.token,p.session,q.command_id,{ok:true,data:{apps:[]}}),/data commands/);
 await assert.rejects(f.bridge.complete(p.token,p.session,q.command_id,{ok:true,data:{text:'x'.repeat(40001)}}),/Invalid device data/);
 await f.bridge.complete(p.token,p.session,q.command_id,{ok:true});
 const info=await f.bridge.enqueue('justin',{action:'list_apps'});await f.bridge.poll(p.token,p.session,true);
 await assert.rejects(f.bridge.complete(p.token,p.session,info.command_id,{ok:true}),/needs device data/);
 await assert.rejects(f.bridge.complete(p.token,p.session,info.command_id,{ok:true,image_base64:'/9j/AAAA',width:720,height:1440}),/Data commands/);
 await f.bridge.complete(p.token,p.session,info.command_id,{ok:true,data:{apps:[]}});
});
test('combined MCP observation reuses durable receipts but never persists or replays screenshots',async()=>{
 const {waitForPhoneFeedback}=await import('../lib/phoneFeedback.js');
 const {createWorkspaceRequests}=await import('../lib/workspaceRequests.js');
 const {WORKSPACE_WRITES}=await import('../lib/workspaceConnector.js');
 const f=fixture(),p=await connected(f),records=new Map();let enqueues=0;
 const once=createWorkspaceRequests({command:async([op,key,value,flag])=>{
  if(op==='SET'){if(flag==='NX'&&records.has(key))return null;records.set(key,value);return 'OK';}
  if(op==='GET')return records.get(key)||null;
  if(op==='LPUSH')return 1;throw Error(op);
 }});
 const service=createWorkspaceService({phone:f.bridge}),owner={id:'justin',owner:true,workbenchUserId:'owner',scheduleUserId:'owner'};
 const registered=new Map();registerWorkspaceBoard({registerResource(){},registerTool(name,schema,fn){registered.set(name,fn);}},{authorize:async()=>{},phoneFeedback:options=>waitForPhoneFeedback({...options,timeoutMs:0}),call:async(action,input,id)=>{
  const run=async()=>{const result=await service(action,input,owner);if(action==='phone_command'){
   enqueues++;await f.bridge.poll(p.token,p.session,true);await f.bridge.complete(p.token,p.session,result.command_id,{ok:true,image_base64:'/9j/AAAA',width:720,height:1440});
  }return result;};return WORKSPACE_WRITES.has(action)?once(owner.id,id,action,input,run):run();
 }});
 const control=registered.get('control_nexus_phone'),args={command:{action:'home'},request_id:'fast-phone-receipt-1'};
 const first=await control(args);assert.equal(first.structuredContent.status,'done');assert.equal(first.structuredContent.requires_result_read,false);assert.equal(first.content.filter(c=>c.type==='image').length,1);assert.ok(!JSON.stringify([...records.values()]).includes('/9j/AAAA'));
 const retry=await control(args);assert.equal(enqueues,1);assert.equal(retry.structuredContent.replayed,true);assert.equal(retry.content.filter(c=>c.type==='image').length,1);
 await f.bridge.stop('justin');const stopped=await control(args);assert.equal(enqueues,1);assert.equal(stopped.structuredContent.status,'unavailable');assert.equal(stopped.content.filter(c=>c.type==='image').length,0);
});
test('write-only phone callers keep queue access but never read private images',async()=>{
 const registered=new Map();let reads=0;
 registerWorkspaceBoard({registerResource(){},registerTool(name,schema,fn){registered.set(name,fn);}},{authorize:async(name,write)=>{if(!write)throw Object.assign(Error('read scope denied'),{status:403});},call:async(action)=>{if(action==='phone_result')reads++;return {command_id:randomUUID(),status:'queued'};}});
 const result=await registered.get('control_nexus_phone')({command:{action:'home'},request_id:'fast-phone-write-only'});assert.equal(result.structuredContent.status,'queued');assert.equal(reads,0);assert.equal(result.content.filter(c=>c.type==='image').length,0);
});

async function sensitiveReady(f,p){const q=await f.bridge.enqueue('justin',{action:'device_info'});await f.bridge.poll(p.token,p.session,true);await f.bridge.complete(p.token,p.session,q.command_id,{ok:true,data:{sensitive_text:true,version:'0.3.1'}});}
test('password flag is explicit, strictly typed and requires fresh native capability',async()=>{
 const schema=WORKSPACE_TOOLS.find(t=>t[0]==='control_nexus_phone')[3].command,frame_id=randomUUID();
 assert.equal(schema.safeParse({action:'type',text:'fixture',frame_id,sensitive:true}).success,true);
 assert.throws(()=>validatePhoneCommand({action:'type',text:'fixture',frame_id,sensitive:'true'}));
 assert.equal(schema.safeParse({action:'home',sensitive:true}).success,false);
 const f=fixture(),p=await connected(f),frame=await screen(f,p);
 await assert.rejects(f.bridge.enqueue('justin',{action:'type',text:'fixture',frame_id:frame,sensitive:true}),/verify sensitive text support/);
 assert.ok(![...f.data.keys()].some(k=>k.startsWith('nexus:phone:secret:')));
 await sensitiveReady(f,p);assert.equal((await f.bridge.status('justin')).sensitive_text,true);
 await f.bridge.start(p.token,randomUUID());assert.equal((await f.bridge.status('justin')).sensitive_text,false);
});
test('sensitive text has short-lived transit, one delivery, and no screenshot, echo or frame in its result',async()=>{
 const f=fixture(),p=await connected(f);await sensitiveReady(f,p);const frame=await screen(f,p),secret='synthetic-secret-for-test';
 const q=await f.bridge.enqueue('justin',{action:'type',text:secret,frame_id:frame,sensitive:true});
 assert.ok(!f.data.get('nexus:phone:v1').get('justin').includes(secret));
 const polls=await Promise.all([f.bridge.poll(p.token,p.session,true),f.bridge.poll(p.token,p.session,true)]);
 assert.equal(polls.filter(x=>x.command).length,1);assert.equal(polls.find(x=>x.command).command.input.text,secret);
 assert.ok(![...f.data.keys()].some(k=>k.startsWith('nexus:phone:secret:')));
 await f.bridge.complete(p.token,p.session,q.command_id,{ok:true,image_base64:'/9j/AAAA',width:720,height:1440});
 const result=await f.bridge.result('justin',q.command_id);assert.equal(result.ok,true);assert.equal(result.sensitive,true);
 assert.equal(result.frame_id,undefined);assert.equal(result.inline_images,undefined);assert.ok(!JSON.stringify(result).includes(secret));
 assert.equal(JSON.parse(f.data.get('nexus:phone:v1').get('justin')).frame,null);
 const q2=await f.bridge.enqueue('justin',{action:'screen'});await f.bridge.poll(p.token,p.session,true);await f.bridge.complete(p.token,p.session,q2.command_id,{ok:true,image_base64:'/9j/AAAA',width:720,height:1440});
 const q3=await f.bridge.enqueue('justin',{action:'type',text:secret,frame_id:q2.command_id,sensitive:true});await f.bridge.poll(p.token,p.session,true);
 await f.bridge.complete(p.token,p.session,q3.command_id,{ok:false,error:secret});assert.ok(!JSON.stringify(await f.bridge.result('justin',q3.command_id)).includes(secret));
});
test('lost sensitive transit text is never delivered or retried from metadata',async()=>{
 const f=fixture(),p=await connected(f);await sensitiveReady(f,p);const frame=await screen(f,p);
 const q=await f.bridge.enqueue('justin',{action:'type',text:'synthetic-secret',frame_id:frame,sensitive:true});
 f.data.delete(`nexus:phone:secret:justin:${q.command_id}`);
 assert.equal((await f.bridge.poll(p.token,p.session,true)).command,null);assert.equal((await f.bridge.result('justin',q.command_id)).status,'expired');
});
