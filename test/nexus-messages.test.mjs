import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusMessagesStore} from '../lib/nexusMessagesStore.js';
import {createNexusMessagesHandler} from '../api/nexus-messages.js';
import {conversationThreadId,conversationPreview} from '../public/nexus-messages.js';
import {formatLiveWorkspaceContext} from '../lib/nexBrain.js';
import fs from 'node:fs';

function fixture(){
  const values=new Map();let sequence=0;
  const run=async([command,key,value])=>{if(command==='GET')return values.get(key) || null;if(command==='SET'){values.set(key,value);return 'OK';}throw new Error('Unexpected command');};
  return createNexusMessagesStore({run,idFactory:prefix=>`${prefix}-test-${++sequence}`});
}
function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}

test('specialists keep a clear role and least-context default while groups inherit member scope',async()=>{
  const store=fixture();
  const researcher=await store.createSpecialist('Mrlopez',{name:'Maya',role:'research'});
  const builder=await store.createSpecialist('Mrlopez',{name:'Atlas',role:'build'});
  assert.deepEqual(researcher.scopes,['conversation']);assert.deepEqual(builder.scopes,['conversation','projects']);
  const group=await store.createGroup('Mrlopez',{title:'Launch',member_ids:[researcher.id,builder.id,'agent-missing']});
  assert.deepEqual(group.member_ids,[researcher.id,builder.id]);assert.deepEqual(group.scopes,['conversation','projects']);
  const overview=await store.overview('Mrlopez');assert.deepEqual(overview.specialists.map(item=>item.name),['Atlas','Maya']);assert.equal(overview.groups[0].title,'Launch');
});

test('Messages API derives owner scope and refuses empty groups',async()=>{
  const store=fixture(),handler=createNexusMessagesHandler({getOwner:async()=>({id:'Justin'}),store});
  const created=response();await handler({method:'POST',body:{action:'create_specialist',name:'Maya',role:'research'}},created);assert.equal(created.code,201);
  const rejected=response();await handler({method:'POST',body:{action:'create_group',title:'Empty',member_ids:[]}},rejected);assert.equal(rejected.code,400);assert.match(rejected.data.error,/Choose at least one/);
  const listed=response();await handler({method:'GET'},listed);assert.equal(listed.data.specialists[0].name,'Maya');assert.ok(listed.data.roles.build);
});

test('specialist and group threads stay isolated and previews are compact',()=>{
  assert.equal(conversationThreadId({kind:'specialist',id:'agent-abc'}),'agent-abc');
  assert.equal(conversationThreadId({kind:'group',id:'group-abc'}),'group-abc');
  assert.equal(conversationThreadId({kind:'nex'}),'nex-main');
  assert.equal(conversationPreview({title:'  Plan   the launch  '}),'Plan the launch');
});

test('trusted workspace context names specialist boundaries and makes Nex coordinate groups honestly',()=>{
  const specialist=formatLiveWorkspaceContext({clientContext:{conversation:{kind:'specialist',name:'Maya',job:'Research launch angles',scopes:['conversation']}}});
  assert.match(specialist,/Reply in this specialist's name/);assert.match(specialist,/outside the allowed list/);assert.match(specialist,/Never claim work finished/);
  const group=formatLiveWorkspaceContext({clientContext:{conversation:{kind:'group',title:'Launch',scopes:['conversation','projects'],members:[{name:'Maya',job:'Research'},{name:'Atlas',job:'Build'}]}}});
  assert.match(group,/Nex is coordinating/);assert.match(group,/Maya \(Research\)/);assert.match(group,/real Board tasks/);assert.match(group,/Do not pretend specialists completed/);
});

test('workspace opens on Messages and sends only a saved conversation id back to the server',()=>{
  const source=fs.readFileSync(new URL('../public/workspace.html',import.meta.url),'utf8');
  assert.match(source,/let currentView = 'messages'/);
  assert.match(source,/conversation: activeConversation.*\{kind:activeConversation\.kind,id:activeConversation\.id\}/s);
  assert.match(source,/renderResponseActions\(data\)/);
  assert.match(source,/openSystem/);
});
