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

test('watch mode needs the watch capability, is bounded, and stops by itself',async()=>{
 const f=fixture(),p=await connected(f);
 await assert.rejects(f.bridge.watch('justin',30),/does not support watch/);
 await f.bridge.start(p.token,p.session,['terminal','self_update','watch']);
 for(const s of [0,4,121,1.5,'30'])await assert.rejects(f.bridge.watch('justin',s),/Watch for 5 to 120/);
 assert.equal((await f.bridge.poll(p.token,p.session)).watch,null);
 const w=await f.bridge.watch('justin',30);
 assert.equal(w.watching,true);
 assert.equal((await f.bridge.poll(p.token,p.session)).watch.interval_ms,350);
 f.advance(30001);
 assert.equal((await f.bridge.poll(p.token,p.session)).watch,null);
 await assert.rejects(f.bridge.completeFrame(p.token,p.session,'/9j/AAAA'),/Watch mode is off/);
 await f.bridge.watch('justin',30);await f.bridge.watchStop('justin');
 assert.equal((await f.bridge.poll(p.token,p.session)).watch,null);
});
test('watch frames come back oldest first with ages, and the newest can drive input until the screen changes',async()=>{
 const f=fixture(),p=await connected(f);
 await f.bridge.start(p.token,p.session,['terminal','self_update','watch']);
 assert.equal((await f.bridge.watchFrames('justin',3)).status,'no_frames');
 await f.bridge.watch('justin',60);
 for(let i=0;i<5;i++){f.advance(600);await f.bridge.completeFrame(p.token,p.session,'/9j/AAA'+'ABCDE'[i]);}
 const r=await f.bridge.watchFrames('justin',3);
 assert.equal(r.status,'ok');assert.equal(r.inline_images.length,3);
 assert.deepEqual(r.inline_images.map(x=>x.data_base64),['/9j/AAAA','/9j/AAAC','/9j/AAAE']);
 assert.ok(r.frames[0].age_ms>r.frames[2].age_ms);
 assert.match(r.frame_id,/^[0-9a-f-]{36}$/);
 const q=await f.bridge.enqueue('justin',{action:'click',x:.5,y:.5,frame_id:r.frame_id});
 await f.bridge.poll(p.token,p.session);
 await f.bridge.completeCommand(p.token,p.session,q.command_id,{ok:true});
 // A frame taken before the click finished cannot drive input; a later one can.
 const again=await f.bridge.watchFrames('justin',1);
 assert.equal(again.frame_id,undefined);assert.match(again.frame_note,/changed/);
 await assert.rejects(f.bridge.enqueue('justin',{action:'click',x:.5,y:.5,frame_id:r.frame_id}),/stale/);
 f.advance(1000);await f.bridge.completeFrame(p.token,p.session,'/9j/AAAF');
 const fresh=await f.bridge.watchFrames('justin',1);
 assert.match(fresh.frame_id,/^[0-9a-f-]{36}$/);
 await f.bridge.enqueue('justin',{action:'scroll',dy:100,frame_id:fresh.frame_id});
});
test('watch frames are owner scoped, session scoped, size bounded and expire quickly',async()=>{
 const f=fixture(),p=await connected(f);
 await f.bridge.start(p.token,p.session,['watch']);
 await f.bridge.watch('justin',60);
 await assert.rejects(f.bridge.completeFrame(p.token,p.session,'not a jpeg'),/Bounded JPEG/);
 await assert.rejects(f.bridge.completeFrame(p.token,p.session,'/9j/'+'A'.repeat(450001)),/Bounded JPEG/);
 await assert.rejects(f.bridge.completeFrame('0'.repeat(64),p.session,'/9j/AAAA'),/Pairing revoked|Pair Ally/);
 await assert.rejects(f.bridge.completeFrame(p.token,randomUUID(),'/9j/AAAA'),/Session stopped/);
 await f.bridge.completeFrame(p.token,p.session,'/9j/AAAA');
 await assert.rejects(f.bridge.watchFrames('other',1),/Session stopped/);
 assert.equal((await f.bridge.watchFrames('justin',1)).status,'ok');
 f.advance(10001);
 assert.equal((await f.bridge.watchFrames('justin',1)).status,'no_frames');
 await assert.rejects(f.bridge.watchFrames('justin',0),/1 to 6/);
 await assert.rejects(f.bridge.watchFrames('justin',7),/1 to 6/);
 await f.bridge.completeFrame(p.token,p.session,'/9j/AAAA').catch(()=>{});
 await f.bridge.start(p.token,randomUUID(),['watch']);
 assert.equal((await f.bridge.watchFrames('justin',1)).status,'no_frames');
});
