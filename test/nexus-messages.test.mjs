import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusMessagesStore,MESSAGE_SYSTEM_IDS} from '../lib/nexusMessagesStore.js';
import {createNexusMessagesHandler} from '../api/nexus-messages.js';
import {conversationThreadId,conversationPreview} from '../public/nexus-messages.js';
import {buildActiveTools,buildConversationAccessPolicy,formatLiveWorkspaceContext} from '../lib/nexBrain.js';
import {isProtectedConversationThreadId} from '../lib/nexConversationStore.js';
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
  const pins=response();await handler({method:'POST',body:{action:'set_pinned_systems',pinned_system_ids:['life','workbench']}},pins);assert.deepEqual(pins.data.pinned_system_ids,['life','workbench']);
});

test('pinned Nexus spaces have useful defaults and persist an account choice',async()=>{
  const store=fixture();
  assert.deepEqual((await store.overview('Mrlopez')).pinned_system_ids,['planner','reminders','workbench','life']);
  assert.deepEqual(await store.setPinnedSystems('Mrlopez',['life','workbench','not-a-space','life']),['life','workbench']);
  assert.deepEqual((await store.overview('Mrlopez')).pinned_system_ids,['life','workbench']);
  assert.ok(MESSAGE_SYSTEM_IDS.includes('teams'));
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
  assert.match(group,/Nex is coordinating/);assert.match(group,/Maya \(Research\)/);assert.match(group,/handoffs and status clear/);assert.match(group,/Do not pretend specialists completed/);
});

test('specialist access is enforced as a backend tool allowlist',()=>{
  const research=buildConversationAccessPolicy({kind:'specialist',role:'research',scopes:['conversation']});
  assert.equal(research.restricted,true);assert.equal(research.allowNativeWeb,true);
  assert.deepEqual([...research.allowedToolNames],['ask_user_question']);

  const builder=buildConversationAccessPolicy({kind:'specialist',role:'build',scopes:['conversation','projects']});
  assert.equal(builder.allowedToolNames.has('read_repo_file'),true);
  assert.equal(builder.allowedToolNames.has('patch_repo_file'),true);
  assert.equal(builder.allowedToolNames.has('delete_repo'),false);
  assert.equal(builder.allowedToolNames.has('save_memory'),false);
  assert.equal(builder.allowedToolNames.has('approve_pending_action'),false);

  const visible=buildActiveTools(new Set(['coding','board_admin','memory_admin']),builder.allowedToolNames).map(tool=>tool.name);
  assert.ok(visible.includes('tool_search'));assert.ok(visible.includes('patch_repo_file'));
  assert.ok(!visible.includes('delete_repo'));assert.ok(!visible.includes('read_board'));assert.ok(!visible.includes('save_memory'));

  const nex=buildConversationAccessPolicy(null);
  assert.equal(nex.restricted,false);assert.equal(nex.allowedToolNames,null);assert.equal(nex.allowNativeWeb,true);
});

test('scoped conversations cannot inherit ambient founder workspace context',()=>{
  const context=formatLiveWorkspaceContext({
    board:{tasks:[{title:'Secret acquisition',status:'active'}],agents:[{display_name:'Founder bot',status:'working'}]},
    rooms:[{name:'Private command room',url:'/command'}],
    clientContext:{
      screen:{title:'Founder controls',viewport_text:['Revenue and private customer list'],controls:['Delete account']},
      conversation:{kind:'specialist',name:'Maya',role:'research',job:'Research',scopes:['conversation']},
    },
  });
  for(const secret of ['Secret acquisition','Founder bot','Private command room','Revenue and private customer list','Delete account'])assert.doesNotMatch(context,new RegExp(secret));
  assert.match(context,/hidden from this scoped conversation/);
});

test('workspace opens on Messages and sends only a saved conversation id back to the server',()=>{
  const source=fs.readFileSync(new URL('../public/workspace.html',import.meta.url),'utf8');
  assert.match(source,/let currentView = 'messages'/);
  assert.match(source,/conversation: activeConversation.*\{kind:activeConversation\.kind,id:activeConversation\.id\}/s);
  assert.match(source,/renderResponseActions\(data\)/);
  assert.match(source,/openSystem/);
  assert.doesNotMatch(source,/id="burger"|class="rail"/);
  assert.match(source,/id="backMessages"/);
  assert.match(source,/class="messagebrand"/);
  assert.doesNotMatch(source,/id="navMessages"|class="messagenav"/);
});

test('Messages carries the old navigation as colored connected conversation rows',()=>{
  const source=fs.readFileSync(new URL('../public/nexus-messages.js',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../public/nexus-messages.css',import.meta.url),'utf8');
  for(const name of ['Schedule','Reminders','Nexus Life','Projects','Nexus Legacy','Nexus Teams','Command Deck','Capabilities'])assert.match(source,new RegExp(`name:'${name}'`));
  assert.match(css,/tone-schedule/);assert.match(css,/tone-reminders/);assert.match(css,/tone-life/);assert.match(css,/tone-projects/);
  assert.match(css,/messageitem\.pinned/);assert.match(css,/rolechoice/);assert.match(css,/messageprimary/);
  assert.match(source,/Create a specialist/);assert.match(source,/Step 1 of 2/);assert.match(source,/You choose what this agent can access/);
  assert.match(source,/Customize Messages/);assert.match(source,/set_pinned_systems/);assert.match(css,/pinmanager/);
});

test('conversation cleanup protects permanent and shared Nexus threads',()=>{
  for(const id of ['nex-main','agent-maya','group-launch'])assert.equal(isProtectedConversationThreadId(id),true);
  for(const id of ['tnewidea','chat-123'])assert.equal(isProtectedConversationThreadId(id),false);
  const source=fs.readFileSync(new URL('../public/nexus-messages.js',import.meta.url),'utf8');
  assert.match(source,/Clear recent conversations/);
  assert.match(source,/Choose Keep on any recent chat you still want/);
  assert.match(source,/clearRecentThreads/);
});
