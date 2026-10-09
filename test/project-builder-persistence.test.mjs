import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,samplePage} from './project-builder-fixture.mjs';
import {saveTeamProjects} from '../lib/teamProjectSave.js';
import {saveChatProject,checkNewVisualCapacity} from '../lib/chatProjectSave.js';
import {withProjectSaveLock} from '../lib/projectSaveLock.js';
import {chatVisualPromotionId} from '../public/project-identity.js';

test('fine-tune and restore save new versions in one slot, including at capacity',async()=>{
 const f=fixture({plan:'hosted',initial:[{id:'b1',projectId:'p1',html:samplePage,sourceConversation:{kind:'team',id:'group-garden'}},{id:'b2',projectId:'p2',html:'Other'},{id:'b3',projectId:'p3',html:'Another'}]});
 const edit=await f.request({action:'save_project_edit',projectId:'p1',baseline:'b1',html:samplePage.replace('Creekside Lawn','Garden team')});assert.equal(edit.code,201);assert.equal(f.projects().length,3);assert.equal(edit.data.build.sourceConversation.id,'group-garden');
 const restore=await f.request({action:'restore_project_version',projectId:'p1',baseline:edit.data.build.id,buildId:'b1'});assert.equal(restore.code,201);assert.equal(restore.data.build.html,samplePage);assert.equal(f.projects().length,3);
 const newProject=await f.request({action:'save_chat_visual',promotionId:'another',html:samplePage});assert.equal(newProject.code,402);assert.equal(f.writes.length,2);
});
test('ownership, cross-project restore, stale baseline and invalid changes cannot write',async()=>{
 const f=fixture({initial:[{id:'b1',projectId:'p1',html:samplePage},{id:'b2',projectId:'p2',html:'Other'}]});
 assert.equal((await f.request({action:'save_project_edit',projectId:'p1',baseline:'b1',html:'Changed'},{testOwner:'bob'})).code,404);
 assert.equal((await f.request({action:'restore_project_version',projectId:'p1',baseline:'b1',buildId:'b2'})).code,404);
 assert.equal((await f.request({action:'save_project_edit',projectId:'p1',baseline:'stale',html:'Changed'})).code,409);
 for(const html of ['', 'x'.repeat(100001)])assert.equal((await f.request({action:'save_project_edit',projectId:'p1',baseline:'b1',html})).code,400);
 assert.equal(f.writes.length,0);
});
test('chat background saving and frontend replay converge on the same draft; failures can retry',async()=>{
 const f=fixture({initial:[]}),reply='Here it is.\n```html\n'+samplePage+'\n```';f.setFailure(true);await assert.rejects(saveChatProject({},'nex-main',reply,'Build a site',{handler:f.handler}));f.setFailure(false);
 const background=await saveChatProject({},'nex-main',reply,'Build a site',{handler:f.handler});const replay=await f.request({action:'save_chat_visual',promotionId:chatVisualPromotionId(reply,'nex-main'),html:samplePage});
 assert.equal(replay.data.build.id,background.build.id);assert.equal(f.writes.length,1);assert.equal(f.projects()[0].label,'Creekside Lawn');
});
test('completed team output saves once with its original run; unrelated activity saves nothing',async()=>{
 const f=fixture({initial:[]}),runs=[{id:'run-garden',state:'completed',message:'Build a lawn site',steps:[{id:'build-garden',role:'build',state:'returned',result:'```html\n'+samplePage+'\n```'},{id:'research',role:'research',state:'returned',result:'Research'}]}];
 await saveTeamProjects({},'group-garden',runs,{handler:f.handler});await saveTeamProjects({},'group-garden',runs,{handler:f.handler});assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].sourceConversation,{kind:'team',id:'group-garden',runId:'run-garden'});
 await saveTeamProjects({},'group-garden',[{...runs[0],state:'running'}],{handler:f.handler});assert.equal(f.writes.length,1);
});
test('new visual requests stop at capacity before model work; ordinary conversation remains available',async()=>{
 const f=fixture({plan:'free',initial:[]});await assert.rejects(checkNewVisualCapacity({},'Build a website',{handler:f.handler}),error=>error.status===402);await checkNewVisualCapacity({},'Research lawn pricing',{handler:f.handler});
});
test('concurrent save cannot enter another account-scoped save; lock releases on failure',async()=>{
 const held=new Map();const command=async([op,key,value])=>{if(op==='SET'){if(held.has(key))return null;held.set(key,value);return 'OK';}if(op==='EVAL'){held.clear();return 1;}};
 let release;const first=withProjectSaveLock('alice',()=>new Promise(resolve=>release=resolve),{command});await Promise.resolve();await assert.rejects(withProjectSaveLock('alice',async()=>{}, {command}),error=>error.status===409);release();await first;
 await assert.rejects(withProjectSaveLock('alice',async()=>{throw new Error('Write failed');},{command}));assert.equal(held.size,0);
});

test('team scheduling saves the completed project after the browser leaves and GET replay adds no slot',async()=>{
 const {createTeamMessagesHandler}=await import('../lib/teamMessagesHandler.js');const f=fixture({initial:[]}),scheduled=[],steps=[{id:'build-garden',role:'build',name:'Mason',state:'returned',result:'```html\n'+samplePage+'\n```'}];let run;
 const runs={list:async()=>run?[run]:[],create:async()=>run={id:'run-garden',request_id:'request-garden',state:'queued',message:'Build a lawn site',steps}};
 const runner={group:async()=>({members:[{id:'mason',role:'build'}]}),execute:async()=>{run.state='completed';return true;}};
 const handler=createTeamMessagesHandler({runs,runner,missions:{track:async()=>{}},schedule:task=>scheduled.push(task),persistProjects:(req,id,runs)=>saveTeamProjects(req,id,runs,{handler:f.handler})});
 const res={status(){return this;},json(data){this.data=data;}};await handler({method:'POST',body:{action:'team_create',group_id:'group-garden',request_id:'request-garden',message:'Build a lawn site'}},res,{id:'alice'});assert.equal(f.writes.length,0);await scheduled[0]();assert.equal(f.writes.length,1);
 await handler({method:'GET',query:{group_id:'group-garden'}},res,{id:'alice'});assert.equal(f.writes.length,1);
});
test('team capacity denial occurs before any run or model is started',async()=>{
 const {createTeamMessagesHandler}=await import('../lib/teamMessagesHandler.js');let created=false;
 const handler=createTeamMessagesHandler({runs:{list:async()=>[],create:async()=>{created=true;}},runner:{group:async()=>({members:[]})},checkCapacity:async()=>{const error=new Error('Project limit reached');error.status=402;throw error;}});
 await assert.rejects(handler({method:'POST',body:{action:'team_create',group_id:'garden',message:'Build a site'}},{},{id:'alice'}),error=>error.status===402);assert.equal(created,false);
});

test('a failed first builder save can recover idempotently without overwriting another version or bypassing capacity',async()=>{
 const f=fixture({initial:[]}),body={action:'save_project_draft',projectId:'builder-first',html:samplePage};
 f.setFailure(true);assert.equal((await f.request(body)).code,500);f.setFailure(false);const saved=await f.request(body);assert.equal(saved.code,201);assert.equal((await f.request(body)).code,200);assert.equal(f.writes.length,1);
 assert.equal((await f.request({...body,html:'<p>Overwrite</p>'})).code,409);assert.equal(f.writes.length,1);
 const free=fixture({plan:'free',initial:[]});assert.equal((await free.request(body)).code,402);assert.equal(free.writes.length,0);
});
