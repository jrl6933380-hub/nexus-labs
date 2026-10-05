import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSocialAuth, providerStatus } from '../lib/socialAuth.js';
import { createSocialAuthHandler } from '../api/board.js';

test('social sign-in advertises only configured providers and stores a one-time state',async()=>{
  const commands=[];
  const auth=createSocialAuth({env:{GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'},random:()=> 'state-token',command:async(command)=>{commands.push(command);return 'OK';}});
  assert.deepEqual(auth.status(),{google:true,apple:false});
  const url=new URL(await auth.begin('google','https://attacker.example','browser'));
  assert.equal(url.hostname,'accounts.google.com');
  assert.equal(url.searchParams.get('state'),'state-token');
  assert.equal(commands[0][0],'SET');
  assert.match(commands[0][2],/"next":"\/workspace\.html"/u);
  assert.deepEqual(providerStatus({APPLE_CLIENT_ID:'id',APPLE_TEAM_ID:'team',APPLE_KEY_ID:'key',APPLE_PRIVATE_KEY:'private'}),{google:false,apple:true});
});

test('social callback creates a normal private account session',async()=>{
  const headers={};let ended=false;
  const res={statusCode:0,setHeader(name,value){headers[name]=value;},end(){ended=true;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};
  const handler=createSocialAuthHandler({
    auth:{status:()=>({google:true,apple:true}),begin:async()=>'',finish:async()=>({request:{next:'/workspace.html'},identity:{provider:'google',subject:'123',email:'person@example.com',name:'Person'}})},
    findUser:async(identity)=>{assert.equal(identity.email,'person@example.com');return {username:'person'};},
    createSession:async(username)=>{assert.equal(username,'person');return 'session';},
    serializeCookie:token=>`nexus_room_session=${token}`,
  });
  await handler({method:'GET',url:'/api/social-auth/callback/google',query:{code:'code',state:'state'},headers:{}},res);
  assert.equal(res.statusCode,302);assert.equal(headers.Location,'/workspace.html');assert.equal(headers['Set-Cookie'][0],'nexus_room_session=session');assert.equal(ended,true);
});

test('Forge signup offers Google, Apple, and a simple manual account',()=>{
  const html=fs.readFileSync(new URL('../public/room-login.html',import.meta.url),'utf8');
  const forge=fs.readFileSync(new URL('../public/forge.html',import.meta.url),'utf8');
  assert.match(html,/Continue with Google/u);assert.match(html,/Continue with Apple/u);assert.match(html,/simple-signup/u);
  assert.match(html,/placeholder="Your name"/u);assert.match(html,/placeholder="Email"/u);assert.doesNotMatch(html,/id="signup-security-question"/u);
  assert.match(forge,/Continue with Google/u);assert.match(forge,/Continue with Apple/u);assert.match(forge,/simple-signup/u);
  assert.doesNotMatch(forge,/Recovery question/u);
});

 test('social state rejects callbacks from a different browser before exchanging credentials',async()=>{
  const auth=createSocialAuth({env:{GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'},command:async()=>JSON.stringify({provider:'google',browserBinding:'original',next:'/workspace.html'})});
  await assert.rejects(()=>auth.finish('google',{state:'state',code:'code',browserBinding:'other'}),/this browser/u);
  await assert.rejects(()=>auth.finish('google',{state:'state',code:'code'}),/this browser/u);
 });
 test('social redirect rejects backslash URLs and requires a browser binding',async()=>{
  const commands=[],auth=createSocialAuth({env:{GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'},command:async c=>{commands.push(c);return 'OK';}});
  await assert.rejects(()=>auth.begin('google','/workspace.html'),/this browser/u);
  await auth.begin('google','/\\attacker.example','browser');
  assert.equal(JSON.parse(commands[0][2]).next,'/workspace.html');
 });
