import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceService,resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {createWorkspaceConnectorHandler} from '../api/workspace-connector.js';
import {createWorkspaceRequests} from '../lib/workspaceRequests.js';
import {createPlannerStore} from '../lib/planner.js';
import {createReminderStore} from '../lib/reminders.js';
import {executeWorkbenchTool} from '../lib/workbenchTools.js';
import {createHistoryHandler} from '../api/room-history.js';
import {workspaceFixture as fixture} from './helpers/workspaceFixture.mjs';
const owner={id:'justin',owner:true,workbenchUserId:'Mrlopez',scheduleUserId:'owner:justin'};
const alice={id:'alice',owner:false,workbenchUserId:'alice',scheduleUserId:'room:alice'};
const bob={id:'bob',owner:false,workbenchUserId:'bob',scheduleUserId:'room:bob'};
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
test('no authentication, claimed owner input, and invalid private bearer fail closed',async()=>{
 const auth={getOwner:async()=>null,getUser:async()=>null,agentAuthorized:async()=>false};
 await assert.rejects(resolveWorkspaceAccount({headers:{}},auth),e=>e.status===401);
 await assert.rejects(resolveWorkspaceAccount({headers:{authorization:'Bearer made-up'}},auth),e=>e.status===401);
 const f=fixture();await assert.rejects(f.execute('board',{user_id:'Mrlopez'},alice),/Unsupported field/);
});
test('owner and customer scope mapping match the real Nexus UI',async()=>{
 const customer=await resolveWorkspaceAccount({headers:{}},{getOwner:async()=>null,getUser:async()=> 'alice'});assert.deepEqual(customer,alice);
 const account=await resolveWorkspaceAccount({headers:{authorization:'Bearer private'}},{getOwner:async()=>null,agentAuthorized:async()=>true,env:{NEXUS_OWNER_ID:'justin'}});assert.equal(account.scheduleUserId,'owner:justin');assert.equal(account.workbenchUserId,'Mrlopez');
});
test('save/read/list run the existing history flow and never cross accounts',async()=>{
 const f=fixture(),html='<html><title>Demo tool</title><body>real draft</body></html>';
 const result=await f.execute('save_project',{project_id:'demo',html},alice);assert.equal(result.saved,true);
 assert.equal((await f.execute('projects',{},alice)).projects[0].project_id,'demo');
 assert.equal((await f.execute('project',{project_id:'demo'},alice)).html,html);
 assert.equal((await f.execute('projects',{},bob)).projects.length,0);
 await assert.rejects(f.execute('project',{project_id:'demo'},bob),/not found/);
});
test('existing project edits require the current baseline and plan limits stay intact',async()=>{
 const f=fixture(),html='<html><body>one</body></html>';await f.execute('save_project',{project_id:'one',html},alice);
 await assert.rejects(f.execute('save_project',{project_id:'two',html},alice),e=>e.status===402);
 await assert.rejects(f.execute('save_project',{project_id:'one',html:'<html>changed</html>'},alice),e=>e.status===409);
 const read=await f.execute('project',{project_id:'one'},alice);await f.execute('save_project',{project_id:'one',html:'<html>changed</html>',baseline:read.baseline},alice);
 await assert.rejects(f.execute('save_project',{project_id:'one',html:'<html>stale</html>',baseline:read.baseline},alice),e=>e.status===409);
});
test('FORM imports once, remains private, and preserves later edits',async()=>{
 const f=fixture();await f.execute('import_form',{},owner);const read=await f.execute('project',{project_id:'form-bodyweight-showcase'},owner);
 await f.execute('save_project',{project_id:read.project_id,baseline:read.baseline,html:'<html>my edit</html>'},owner);const count=f.saveCount;
 const result=await f.execute('import_form',{},owner);assert.equal(result.already_saved,true);assert.equal(f.saveCount,count);assert.equal((await f.execute('project',{project_id:read.project_id},owner)).html,'<html>my edit</html>');
 assert.equal((await f.execute('projects',{},alice)).projects.length,0);await assert.rejects(f.execute('import_form',{},alice),e=>e.status===403);
});
test('schedule creates and moves the same record with Chicago local-time conversion',async()=>{
 const f=fixture();const {item}=await f.execute('create_event',{title:'Workout',starts_at:'2026-10-13T17:30',ends_at:'2026-10-13T18:00',timezone:'America/Chicago'},alice);assert.equal(item.starts_at,'2026-10-13T22:30:00.000Z');
 await f.execute('update_event',{id:item.id,starts_at:'2026-10-13T18:00',ends_at:'2026-10-13T18:30',timezone:'America/Chicago'},alice);
 const list=await f.execute('schedule',{},alice);assert.equal(list.items.length,1);assert.equal(list.items[0].starts_at,'2026-10-13T23:00:00.000Z');assert.equal((await f.execute('schedule',{},bob)).items.length,0);
 await assert.rejects(f.execute('update_event',{id:item.id,title:'steal'},bob),/not found/i);
});
test('timing is not guessed and malformed dates are rejected',async()=>{
 const f=fixture();await assert.rejects(f.execute('create_event',{title:'bad',starts_at:'2026-10-13T17:30'},alice),/offset/);
 await assert.rejects(f.execute('create_event',{title:'bad',starts_at:'2026-11-01T01:30',timezone:'America/Chicago'},alice),/ambiguous/);
 await assert.rejects(f.execute('create_event',{title:'bad',starts_at:'2026-02-30T01:30Z'},alice),/Invalid/);
});
test('reminders use the real store, completion and account isolation',async()=>{
 const f=fixture(),{item}=await f.execute('create_reminder',{title:'Review the ad',due_date:'2026-10-13'},alice);
 await f.execute('update_reminder',{id:item.id,status:'done'},alice);assert.equal((await f.execute('reminders',{},alice)).items[0].status,'done');assert.equal((await f.execute('reminders',{},bob)).items.length,0);
 await assert.rejects(f.execute('delete_reminder',{id:item.id},bob),/not found/);
});
test('board loads actual storage and does not invent hosted or external AI charges',async()=>{
 const f=fixture();await f.execute('create_reminder',{title:'check'},owner);const board=await f.execute('board',{},owner);assert.equal(board.reminders.length,1);assert.equal(board.projects.length,0);assert.equal(board.usage.exempt,true);assert.match(board.usage_scope,/separate chat-provider/);
});
test('identical mutation retries replay one result; changed input cannot reuse an ID',async()=>{
 const f=fixture();let calls=0;const task=async()=>{calls++;return f.execute('create_reminder',{title:'once'},alice);};
 await f.once('alice','request-123','create_reminder',{title:'once'},task);const result=await f.once('alice','request-123','create_reminder',{title:'once'},task);assert.equal(result.replayed,true);assert.equal(calls,1);
 await assert.rejects(f.once('alice','request-123','create_reminder',{title:'changed'},task),e=>e.code==='REQUEST_ID_CONFLICT');
 await f.once('bob','request-123','create_reminder',{title:'once'},async()=>f.execute('create_reminder',{title:'once'},bob));assert.equal((await f.execute('reminders',{},bob)).items.length,1);
});
test('uncertain writes and concurrent submissions do not blindly repeat the mutation',async()=>{
 const f=fixture();let calls=0;await assert.rejects(f.once('alice','request-456','create_event',{},async()=>{calls++;throw new Error('transport lost');}));
 await assert.rejects(f.once('alice','request-456','create_event',{},async()=>{calls++;}),e=>e.code==='CHECK_SAVED_STATE');assert.equal(calls,1);
 let finish;const first=f.once('alice','request-789','create_reminder',{},()=>new Promise(resolve=>finish=resolve));await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.once('alice','request-789','create_reminder',{},async()=>({})),e=>e.code==='CHECK_SAVED_STATE');finish({saved:true});await first;
});
test('HTTP boundary requires request IDs and refuses arbitrary tools or account selection',async()=>{
 const f=fixture(),handler=createWorkspaceConnectorHandler({resolveAccount:async()=>alice,execute:f.execute,once:f.once});
 for(const body of [{action:'read_file',input:{}},{action:'board',input:{owner:'Mrlopez'}},{action:'board',user:'Mrlopez'},{action:'create_reminder',input:{title:'test'}}]){const res=response();await handler({method:'POST',body},res);assert.equal(res.code,400);}
 const res=response();await handler({method:'POST',body:{action:'create_reminder',input:{title:'real'},request_id:'http-12345'}},res);assert.equal(res.code,200);assert.equal(res.data.ok,true);
});

test('connector Calendar exposes private reminder markers that move and disappear with their source',async()=>{
 const env=fixture(),service=env.execute;
 const created=await service('create_reminder',{title:'Medicine',due_date:'2026-10-15',due_at:'2026-10-15T09:00:00Z',timezone:'UTC'},alice);
 let result=await service('schedule',{},alice);assert.equal(result.items.length,1);assert.equal(result.items[0].reminder_id,created.item.id);assert.equal(result.items[0].calendar_marker,true);
 assert.equal((await service('schedule',{},bob)).items.length,0);
 await service('update_reminder',{id:created.item.id,due_at:'2026-10-15T10:00:00Z',due_date:'2026-10-15',timezone:'UTC'},alice);result=await service('schedule',{},alice);assert.equal(result.items[0].starts_at,'2026-10-15T10:00:00.000Z');
 await service('update_reminder',{id:created.item.id,status:'done'},alice);assert.equal((await service('schedule',{},alice)).items.length,0);
});
