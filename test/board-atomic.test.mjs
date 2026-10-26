import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardTaskAccess} from '../lib/boardTaskAccess.js';
import {runScript} from '../lib/store/lua.js';
function fixture(){
 const records=new Map([['task',JSON.stringify({id:'task',status:'idle',owner:null,owner_notes:[]})]]);let chain=Promise.resolve();
 const primitive=async([verb,key,id,value])=>{if(verb==='HGET')return records.get(id)||null;if(verb==='HSET'){records.set(id,value);return 1;}throw Error(verb);};
 const command=async args=>{if(args[0]!=='EVAL')return primitive(args);const work=chain.then(()=>runScript(args[1],{keys:[args[3]],argv:args.slice(4),redisCall:primitive}));chain=work.catch(()=>{});return work;};
 return {records,access:createBoardTaskAccess(command,'tasks',()=>1234)};
}
test('simultaneous agents: exactly one claim wins and the loser gets 409',async()=>{
 const {access,records}=fixture();const out=await Promise.allSettled([access.claim({id:'task',owner:'claude'}),access.claim({id:'task',owner:'chatgpt'})]);
 assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.equal(out.find(r=>r.status==='rejected').reason.status,409);
 const stored=JSON.parse(records.get('task'));assert.equal(stored.owner,out.find(r=>r.status==='fulfilled').value.owner);assert.equal(stored.checkpoints.length,1);
});
test('existing owner is protected; explicit force takeover is allowed',async()=>{
 const {access}=fixture();await access.claim({id:'task',owner:'claude'});await assert.rejects(access.claim({id:'task',owner:'chatgpt'}),e=>e.status===409&&/claude/.test(e.message));
 assert.equal((await access.claim({id:'task',owner:'chatgpt',force:true})).owner,'chatgpt');
});
test('a stale note cannot overwrite an intervening claim',async()=>{
 const {access,records}=fixture(),note=await access.get('task');await access.claim({id:'task',owner:'claude'});note.owner_notes.push({text:'owner note'});
 await assert.rejects(access.save(note),e=>e.code==='TASK_CHANGED'&&e.status===409);assert.equal(JSON.parse(records.get('task')).owner,'claude');
});
test('stale updates neither resurrect deleted tasks nor erase other notes',async()=>{
 const {access,records}=fixture(),one=await access.get('task'),two=await access.get('task');one.owner_notes.push({text:'first'});await access.save(one);
 two.owner_notes.push({text:'second'});await assert.rejects(access.save(two),e=>e.status===409);assert.equal(JSON.parse(records.get('task')).owner_notes[0].text,'first');
 const deleted=await access.get('task');records.delete('task');await assert.rejects(access.save(deleted),e=>e.status===409);assert.equal(records.has('task'),false);
});
test('claims require an owner and saves require a stored baseline',async()=>{
 const {access}=fixture();await assert.rejects(access.claim({id:'task',owner:''}),e=>e.status===400);await assert.rejects(access.save({id:'task'}),/Read the task/);
});
