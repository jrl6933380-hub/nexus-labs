import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFeedbackStore} from '../lib/feedback.js';
import {createFeedbackHandler} from '../api/board.js';

function response(){return {statusCode:0,status(value){this.statusCode=value;return this;},setHeader(){},json(value){this.body=value;return this;}};}

test('feedback is account scoped, bounded, and plain text',async()=>{
  const commands=[],store=createFeedbackStore({command:async command=>{commands.push(command);return 'OK';},now:()=>123,idFactory:()=> 'feedback-1'});
  const item=await store.submit({category:'problem',message:'The button did not open',page:'/forge.html'},'room:person');
  assert.equal(item.user,'room:person');assert.equal(commands[0][0],'LPUSH');assert.equal(commands[1][0],'LTRIM');
  await assert.rejects(()=>store.submit({message:' '},'room:person'),/little more/u);
});

test('feedback endpoint requires an account',async()=>{
  const handler=createFeedbackHandler({getOwner:async()=>null,getUser:async()=>null,store:{submit:async()=>({})}}),res=response();
  await handler({method:'POST',body:{message:'test'},headers:{}},res);assert.equal(res.statusCode,401);
});

test('launch surfaces include feedback, privacy, terms, and private analytics',()=>{
  const files=['room-login.html','forge.html','workspace.html'].map(name=>fs.readFileSync(new URL(`../public/${name}`,import.meta.url),'utf8'));
  for(const html of files)assert.match(html,/\/_vercel\/insights\/script\.js/u);
  const login=files[0],messages=fs.readFileSync(new URL('../public/nexus-messages.js',import.meta.url),'utf8');
  assert.match(login,/\/terms\.html/u);assert.match(login,/\/privacy\.html/u);assert.match(messages,/Report a problem/u);
  assert.equal(fs.existsSync(new URL('../public/privacy.html',import.meta.url)),true);assert.equal(fs.existsSync(new URL('../public/terms.html',import.meta.url)),true);
});
