import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {workspaceOAuthEnvironment} from './helpers/workspaceOAuthEnvironment.mjs';
import {WORKSPACE_RESOURCE,WORKSPACE_ORIGIN} from '../lib/workspaceOAuth.js';
import {customerWorkspaceAccount,validWorkspaceAccount} from '../lib/workspaceAccount.js';

const callback='https://chatgpt.com/connector_platform_oauth_redirect';
async function start(env){
 const client=await (await fetch(env.base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'ChatGPT',redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})})).json();
 const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
 const response=await fetch(env.base+'/authorize?'+new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:callback,code_challenge:challenge,code_challenge_method:'S256',scope:'workspace:read workspace:write',state:'customer-state',resource:WORKSPACE_RESOURCE}),{redirect:'manual'});
 return {client,verifier,request:new URL(response.headers.get('location')).searchParams.get('request')};
}
const session=username=>username==='owner'?{'x-test-owner':'yes'}:{'x-test-user':username};
async function approval(env,flow,username){
 const response=await fetch(env.base+'/api/workspace-consent?request='+flow.request,{headers:session(username)});assert.equal(response.status,200);return response.json();
}
async function consent(env,flow,username,csrf){
 return fetch(env.base+'/api/workspace-consent',{method:'POST',headers:{'Content-Type':'application/json',Origin:WORKSPACE_ORIGIN,...session(username)},body:JSON.stringify({request:flow.request,csrf,decision:'allow'})});
}
async function exchange(env,client,params){
 const response=await fetch(env.base+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.client_id,resource:WORKSPACE_RESOURCE,...params})});assert.equal(response.status,200);return response.json();
}
async function connect(env,username){
 const flow=await start(env),view=await approval(env,flow,username),response=await consent(env,flow,username,view.csrf);assert.equal(response.status,200);
 const redirect=new URL((await response.json()).redirect_url),tokens=await exchange(env,flow.client,{grant_type:'authorization_code',code:redirect.searchParams.get('code'),code_verifier:flow.verifier,redirect_uri:callback});
 const mcp=new Client({name:'customer-fixture',version:'1'});await mcp.connect(new StreamableHTTPClientTransport(new URL(env.base+'/api/workspace-mcp'),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}}));
 return {...flow,tokens,view,mcp,call:async(name,args={})=>mcp.callTool({name,arguments:args})};
}
test('customers get the same workspace operations with private Projects, Schedule, Reminders and existing limits',async()=>{
 const env=await workspaceOAuthEnvironment(),clients=[];
 try{
  const alice=await connect(env,'alice'),bob=await connect(env,'bob'),owner=await connect(env,'owner');clients.push(alice,bob,owner);
  assert.deepEqual(alice.view.account,{name:'alice',owner:false});assert.equal(owner.view.account.owner,true);
  const saved=await alice.call('save_nexus_project',{project_id:'customer-project',html:'<html><body>Alice only</body></html>',label:'My project',request_id:'customer-project-001'});assert.equal(saved.isError,undefined);
  assert.equal((await alice.call('create_nexus_event',{title:'Alice work',starts_at:'2099-10-16T14:00:00-05:00',ends_at:'2099-10-16T15:00:00-05:00',request_id:'customer-event-001'})).isError,undefined);
  assert.equal((await alice.call('create_nexus_reminder',{title:'Alice reminder',due_date:'2099-10-16',request_id:'customer-reminder-001'})).isError,undefined);
  const own=(await alice.call('show_nexus_board')).structuredContent;assert.equal(own.account.id,'customer:alice');assert.equal(own.account.name,'alice');assert.equal(own.account.owner,false);assert.equal(own.usage.exempt,false);assert.equal(own.board_studio.available,false);assert.equal(own.projects.length,1);assert.equal(own.schedule.length,1);assert.equal(own.reminders.length,2);assert.ok(own.reminders.some(r=>r.title==='Alice reminder'));
  for(const client of [bob,owner]){const data=(await client.call('show_nexus_board')).structuredContent;assert.equal(data.projects.length,0);assert.equal(data.schedule.length,0);assert.equal(data.reminders.length,0);}
  assert.equal((await bob.call('read_nexus_project',{project_id:'customer-project'})).isError,true);
  assert.equal((await alice.call('import_form_project',{request_id:'customer-no-owner-import'})).isError,true);
  assert.equal((await alice.call('save_nexus_project',{project_id:'over-free-limit',html:'<html><body>Second</body></html>',request_id:'customer-limit-001'})).isError,true);
 }finally{await Promise.all(clients.map(c=>c.mcp.close()));await env.close();}
});
test('refresh preserves the customer identity, including a customer named like the private owner',async()=>{
 const env=await workspaceOAuthEnvironment();let user;
 try{user=await connect(env,'justin');const before=await env.provider.verifyAccessToken(user.tokens.access_token);assert.deepEqual(before.extra.account,customerWorkspaceAccount('justin'));
  const renewed=await exchange(env,user.client,{grant_type:'refresh_token',refresh_token:user.tokens.refresh_token});const after=await env.provider.verifyAccessToken(renewed.access_token);assert.deepEqual(after.extra.account,before.extra.account);assert.equal(after.extra.account.owner,false);assert.equal(after.extra.account.scheduleUserId,'room:justin');assert.notEqual(after.extra.account.id,'justin');
 }finally{await user?.mcp.close();await env.close();}
});
test('switching signed-in accounts invalidates the previous consent and requires a fresh review',async()=>{
 const env=await workspaceOAuthEnvironment();try{
  const flow=await start(env),alice=await approval(env,flow,'alice');assert.equal((await consent(env,flow,'bob',alice.csrf)).status,400);
  const bob=await approval(env,flow,'bob');assert.notEqual(bob.csrf,alice.csrf);assert.equal((await consent(env,flow,'alice',alice.csrf)).status,400);
  const accepted=await consent(env,flow,'bob',bob.csrf);assert.equal(accepted.status,200);const code=new URL((await accepted.json()).redirect_url).searchParams.get('code');const tokens=await exchange(env,flow.client,{grant_type:'authorization_code',code,code_verifier:flow.verifier,redirect_uri:callback});assert.equal((await env.provider.verifyAccessToken(tokens.access_token)).extra.account.id,'customer:bob');
 }finally{await env.close();}
});
test('malformed customer/owner mappings cannot be accepted as token identities',()=>{
 assert.equal(validWorkspaceAccount(customerWorkspaceAccount('alice'),'justin'),true);
 for(const account of [{...customerWorkspaceAccount('alice'),id:'justin'},{...customerWorkspaceAccount('alice'),owner:true},{...customerWorkspaceAccount('alice'),scheduleUserId:'owner:justin'},{...customerWorkspaceAccount('alice'),workbenchUserId:'bob'}])assert.equal(validWorkspaceAccount(account,'justin'),false);
});
test('deleted customer accounts lose existing access and cannot renew their grants',async()=>{
 let exists=true;const env=await workspaceOAuthEnvironment({customerExists:async()=>exists});let user;
 try{user=await connect(env,'alice');exists=false;await assert.rejects(env.provider.verifyAccessToken(user.tokens.access_token),/Invalid, expired, or revoked/);await assert.rejects(env.provider.exchangeRefreshToken(user.client,user.tokens.refresh_token,undefined,new URL(WORKSPACE_RESOURCE)),/Invalid workspace account/);}
 finally{await user?.mcp.close();await env.close();}
});
