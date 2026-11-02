import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runScript} from '../lib/store/lua.js';
import {createAllyBridge} from '../lib/allyBridge.js';
function fixture(){const data=new Map(),ttl=new Map();let time=100000,chain=Promise.resolve();
 const primitive=async([op,key,...a])=>{if(ttl.has(key)&&ttl.get(key)<=time){data.delete(key);ttl.delete(key);}if(op==='GET')return data.get(key)??null;if(op==='SET'){data.set(key,a[0]);const ex=a.indexOf('EX');if(ex>=0)ttl.set(key,time+Number(a[ex+1])*1000);return 'OK';}if(op==='DEL'){data.delete(key);return 1;}if(op==='HGET')return data.get(key)?.get(a[0])??null;if(op==='HSET'){const m=data.get(key)||new Map();m.set(a[0],a[1]);data.set(key,m);return 1;}throw Error(op);};
 const command=async a=>{if(a[0]!=='EVAL')return primitive(a);const n=Number(a[2]),work=chain.then(()=>runScript(a[1],{keys:a.slice(3,3+n),argv:a.slice(3+n),redisCall:primitive}));chain=work.catch(()=>{});return work;};
 return {bridge:createAllyBridge({command,now:()=>time}),data,advance:ms=>time+=ms};}

async function connected(f,owner='justin') {
 const {code}=await f.bridge.pairCode(owner);
 const paired=await f.bridge.pair(code,'ROG Ally'),session=randomUUID();
 await f.bridge.start(paired.token,session);
 return {...paired,session};
}
async function screen(f,p) {
 const q=await f.bridge.requestScreen('justin');
 assert.equal((await f.bridge.poll(p.token,p.session)).command.command_id,q.command_id);
 await f.bridge.completeScreen(p.token,p.session,q.command_id,'/9j/AAAA');
 return f.bridge.screenResult('justin',q.command_id);
}
test('existing screenshot completion returns a usable frame for bounded input and a receipt',async()=>{
 const f=fixture(),p=await connected(f),r=await screen(f,p);
 assert.equal(r.frame_id,r.command_id);
 assert.equal(r.inline_images[0].data_base64,'/9j/AAAA');
 const q=await f.bridge.enqueue('justin',{action:'click',frame_id:r.frame_id,x:.5,y:.5});
 const polls=await Promise.all([f.bridge.poll(p.token,p.session),f.bridge.poll(p.token,p.session)]);
 assert.equal(polls.filter(x=>x.command).length,1);
 await f.bridge.completeCommand(p.token,p.session,q.command_id,{ok:true});
 assert.equal((await f.bridge.commandResult('justin',q.command_id)).ok,true);
 await assert.rejects(f.bridge.enqueue('justin',{action:'type',frame_id:r.frame_id,text:'Nexus test'}),/stale/);
});
test('each bounded action works with a new frame and consumes it',async()=>{
 const f=fixture(),p=await connected(f);
 for(const input of [{action:'type',text:'Nexus Ally test'},{action:'key',key:'ArrowLeft'},{action:'scroll',dy:120}]) {
  const r=await screen(f,p),q=await f.bridge.enqueue('justin',{...input,frame_id:r.frame_id});
  await f.bridge.poll(p.token,p.session);
  await f.bridge.completeCommand(p.token,p.session,q.command_id,{ok:true});
  await assert.rejects(f.bridge.enqueue('justin',{...input,frame_id:r.frame_id}),/stale/);
 }
});
test('expired, superseded and previous-session frames cannot drive input',async()=>{
 const f=fixture(),p=await connected(f),old=await screen(f,p);
 f.advance(30001);await f.bridge.poll(p.token,p.session);
 await assert.rejects(f.bridge.enqueue('justin',{action:'click',x:0,y:0,frame_id:old.frame_id}),/stale/);
 const r=await screen(f,p);await screen(f,p);
 await assert.rejects(f.bridge.enqueue('justin',{action:'click',x:0,y:0,frame_id:r.frame_id}),/stale/);
 const latest=await screen(f,p);await f.bridge.start(p.token,randomUUID());
 await assert.rejects(f.bridge.enqueue('justin',{action:'click',x:0,y:0,frame_id:latest.frame_id}),/stale/);
 await assert.rejects(f.bridge.screenResult('justin',latest.command_id),/Expired session/);
});
test('screenshot completion rejects non-screen commands and results stay owner scoped',async()=>{
 const f=fixture(),p=await connected(f),q=await f.bridge.enqueue('justin',{action:'status'});
 await f.bridge.poll(p.token,p.session);
 await assert.rejects(f.bridge.completeScreen(p.token,p.session,q.command_id,'/9j/AAAA'),/Screen command/);
 await f.bridge.completeCommand(p.token,p.session,q.command_id,{ok:true,data:{version:'0.3.1'}});
 await assert.rejects(f.bridge.commandResult('other',q.command_id),/stopped/);
 const r=await screen(f,p);
 await assert.rejects(f.bridge.screenResult('other',r.command_id),/stopped/);
});
