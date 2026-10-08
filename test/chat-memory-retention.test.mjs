import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveChatMemories,retentionSources,verifiedRetention,retainedConversationMemories} from '../lib/chatMemoryRetention.js';

const thread={id:'t-work',messages:[{role:'user',content:'I prefer morning workouts before work.'},{role:'assistant',content:'You should train six days a week.'}]};
const decision={memories:[{content:'Prefers morning workouts before work.',thread:'t-work',quote:'I prefer morning workouts before work.',scope:'preference'}]};
test('keeps supported user facts without storing assistant advice or the transcript',async()=>{
  const saved=[];
  const result=await preserveChatMemories([thread],{list:async()=>[],curator:async sources=>{assert.deepEqual(sources,[{thread:'t-work',text:thread.messages[0].content}]);return decision;},save:async(...args)=>saved.push(args)});
  assert.equal(result.saved,1);assert.equal(saved[0][0],'Prefers morning workouts before work.');assert.equal(saved[0][3].scope,'preference');
});
test('unimportant chats save nothing and existing key details are not duplicated',async()=>{
  let saves=0;
  assert.equal((await preserveChatMemories([thread],{list:async()=>[],curator:async()=>({memories:[]}),save:async()=>saves++})).saved,0);
  assert.equal((await preserveChatMemories([thread],{list:async()=>[{content:'Prefers morning workouts before work.',status:'active'}],curator:async()=>decision,save:async()=>saves++})).saved,0);
  assert.equal(saves,0);
});
test('unsupported claims and credentials cannot become retained memories',()=>{
  assert.equal(verifiedRetention({memories:[{content:'Has a gym membership.',thread:'t-work',quote:'Has a gym membership.'}]},retentionSources([thread])).length,0);
  assert.equal(retentionSources([{id:'t-login',messages:[{role:'user',content:'My password is private'}]}]).length,0);
});
test('failed review or failed saving prevents successful cleanup',async()=>{
  await assert.rejects(preserveChatMemories([thread],{list:async()=>[],curator:async()=>{throw new Error('pod unavailable');}}),/pod unavailable/);
  await assert.rejects(preserveChatMemories([thread],{list:async()=>[],curator:async()=>decision,save:async()=>{throw new Error('storage unavailable');}}),/storage unavailable/);
});

test('specialists recall only retained details from their own cleared conversation',()=>{
  const memories=[{id:'own',source_turn:'chat-cleanup:agent-core-vida',content:'Prefers morning workouts.'},{id:'other',source_turn:'chat-cleanup:agent-core-mason',content:'Private website plan.'},{id:'founder',content:'Founder-only operations.'},{id:'old',source_turn:'chat-cleanup:agent-core-vida',status:'superseded',content:'Old preference.'}];
  assert.deepEqual(retainedConversationMemories(memories,'agent-core-vida').map(item=>item.id),['own']);
  assert.deepEqual(retainedConversationMemories(memories,null),[]);
});
