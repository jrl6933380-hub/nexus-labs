import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountLoginStore,encryptSecret,decryptSecret} from '../lib/accountLogins.js';
import {createTikTokPlansHandler} from '../api/tiktok-plans.js';

process.env.NEXUS_CREDENTIAL_ENC_KEY='test-key-for-vault';

function memory(){
  const hashes=new Map();
  const h=k=>{if(!hashes.has(k))hashes.set(k,new Map());return hashes.get(k);};
  const command=async parts=>{
    const [cmd,key,...rest]=parts;
    if(cmd==='HGET')return h(key).get(rest[0])??null;
    if(cmd==='HSET'){h(key).set(rest[0],rest[1]);return 1;}
    if(cmd==='HDEL')return h(key).delete(rest[0])?1:0;
    if(cmd==='HVALS')return [...h(key).values()];
    throw new Error('unexpected '+cmd);
  };
  return {command,hashes};
}

test('passwords round-trip through AES-GCM and are not stored in plain text', async()=>{
  const {command,hashes}=memory(),store=createAccountLoginStore({command,now:()=>5});
  await store.save('u',{platform:'tiktok',username:'me@x.com',password:'hunter2-secret'});
  const stored=JSON.stringify([...hashes.values()].flatMap(m=>[...m.values()]));
  assert.ok(!stored.includes('hunter2-secret'));
  assert.deepEqual(await store.reveal('u',{platform:'tiktok'}),{platform:'tiktok',username:'me@x.com',password:'hunter2-secret'});
  assert.equal(decryptSecret(encryptSecret('abc')),'abc');
});

test('status never contains a password and reports has_password', async()=>{
  const store=createAccountLoginStore({command:memory().command});
  await store.save('u',{platform:'instagram',username:'ig',password:'pw1'});
  await store.save('u',{platform:'facebook',username:'fb'});
  const {logins}=await store.status('u');
  assert.deepEqual(logins.map(l=>[l.platform,l.has_password]),[['facebook',false],['instagram',true]]);
  assert.ok(!JSON.stringify(logins).includes('pw1'));
  assert.ok(logins.every(l=>!('password' in l)&&!('password_enc' in l)));
});

test('editing the username keeps the saved password; a new password replaces it', async()=>{
  const store=createAccountLoginStore({command:memory().command});
  await store.save('u',{platform:'tiktok',username:'a',password:'one'});
  await store.save('u',{platform:'tiktok',username:'b'});
  assert.equal((await store.reveal('u',{platform:'tiktok'})).password,'one');
  await store.save('u',{platform:'tiktok',username:'b',password:'two'});
  assert.deepEqual(await store.reveal('u',{platform:'tiktok'}),{platform:'tiktok',username:'b',password:'two'});
});

test('logins are per user, removable, and reject unknown platforms', async()=>{
  const store=createAccountLoginStore({command:memory().command});
  await store.save('u',{platform:'tiktok',username:'a',password:'p'});
  await assert.rejects(store.reveal('other',{platform:'tiktok'}),{status:404});
  assert.deepEqual(await store.remove('u',{platform:'tiktok'}),{deleted:true,platform:'tiktok'});
  await assert.rejects(store.reveal('u',{platform:'tiktok'}),{status:404});
  await assert.rejects(store.save('u',{platform:'myspace',username:'x'}));
  await assert.rejects(store.save('u',{platform:'tiktok',username:'x',extra:1}));
});

test('the api routes login actions to the vault, owner only, and never through the idempotency cache', async()=>{
  const calls=[];
  const logins={status:async u=>({logins:[]}),save:async(u,i)=>{calls.push(['save',i]);return {platform:i.platform,has_password:true};},reveal:async()=>({password:'x'}),remove:async()=>({deleted:true})};
  let onceUsed=false;
  const run=async(owner,action,input)=>{
    const handler=createTikTokPlansHandler({resolveAccount:async()=>({id:'u',owner}),store:{},once:async()=>{onceUsed=true;},logins});
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
    await handler({method:'POST',headers:{'content-type':'application/json'},body:{action,input}},res);
    return res;
  };
  const ok=await run(true,'save_login',{platform:'tiktok',username:'a',password:'p'});
  assert.equal(ok.code,200);
  assert.equal(onceUsed,false);
  assert.equal(ok.headers['Cache-Control'],'private, no-store');
  assert.equal((await run(false,'reveal_login',{platform:'tiktok'})).code,403);
});
