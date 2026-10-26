import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountLoginStore} from '../lib/accountLogins.js';
import {createWorkspaceService,WORKSPACE_WRITES,validateWorkspaceInput} from '../lib/workspaceConnector.js';

process.env.NEXUS_CREDENTIAL_ENC_KEY='test-key-for-vault';

function memory(){
  const hashes=new Map();
  const h=k=>{if(!hashes.has(k))hashes.set(k,new Map());return hashes.get(k);};
  return async parts=>{
    const [cmd,key,...rest]=parts;
    if(cmd==='HGET')return h(key).get(rest[0])??null;
    if(cmd==='HSET'){h(key).set(rest[0],rest[1]);return 1;}
    if(cmd==='HDEL')return h(key).delete(rest[0])?1:0;
    if(cmd==='HVALS')return [...h(key).values()];
    throw new Error('unexpected '+cmd);
  };
}
const owner={id:'justin',workbenchUserId:'w',scheduleUserId:'owner:justin',owner:true};
const customer={id:'c',workbenchUserId:'w',scheduleUserId:'s',owner:false};

test('agents: login_get returns the password to the owner only, login_list never does', async()=>{
  let t=0;
  const logins=createAccountLoginStore({command:memory(),now:()=>++t});
  await logins.save('justin',{platform:'tiktok',username:'me@x.com',password:'s3cret-pw'});
  const exec=createWorkspaceService({logins});
  const list=await exec('login_list',{},owner);
  assert.ok(!JSON.stringify(list).includes('s3cret-pw'));
  assert.equal(list.logins[0].last_revealed_at,null);
  const got=await exec('login_get',{platform:'tiktok'},owner);
  assert.deepEqual(got,{platform:'tiktok',username:'me@x.com',password:'s3cret-pw'});
  assert.ok((await exec('login_list',{},owner)).logins[0].last_revealed_at>0);
  await assert.rejects(()=>exec('login_get',{platform:'tiktok'},customer),/owner/i);
  await assert.rejects(()=>exec('login_list',{},customer),/owner/i);
  await assert.rejects(()=>exec('login_get',{platform:'tiktok',extra:1},owner),/Unsupported field/);
  await assert.rejects(()=>exec('login_get',{platform:'myspace'},owner));
  await assert.rejects(()=>exec('login_get',{platform:'instagram'},owner),/No login saved/);
});

test('login actions are read-only: no write flag, so no request id is needed', async()=>{
  assert.ok(!WORKSPACE_WRITES.has('login_get'));
  assert.ok(!WORKSPACE_WRITES.has('login_list'));
  assert.doesNotThrow(()=>validateWorkspaceInput('login_get',{platform:'tiktok'}));
  let TOOLS=null;
  try{({WORKSPACE_TOOLS:TOOLS}=await import('../lib/workspaceBoard.js'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
  if(TOOLS){
    const names=TOOLS.map(t=>t[0]);
    assert.equal(new Set(names).size,names.length);
    for(const n of ['list_nexus_account_logins','get_nexus_account_login'])assert.ok(names.includes(n),n);
    const get=TOOLS.find(t=>t[0]==='get_nexus_account_login');
    assert.equal(get[4],false);
    assert.match(get[2],/never repeat the password/i);
  }
});
