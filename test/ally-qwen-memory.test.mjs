import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listMemories,addMemory,deleteMemory,loadChat,saveExchange,clearChat,memoryContext,suggestedMemory} from '../scripts/ally/qwen-memory.mjs';

test('memories only exist after explicit save and survive separate reads',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-memory-'));
 try{
  assert.deepEqual(await listMemories(root),[]);
  const item=await addMemory(root,'My website theme uses purple.');
  assert.match(item.id,/^[a-f0-9-]{36}$/i);
  assert.equal((await listMemories(root))[0].text,'My website theme uses purple.');
  assert.equal((await addMemory(root,'My website theme uses purple.')).id,item.id,'duplicate saves do not create duplicates');
  const raw=await readFile(join(root,'memory.json'),'utf8');assert.match(raw,/purple/);
  assert.match(memoryContext(await listMemories(root)),/purple/);
  assert.equal(await deleteMemory(root,item.id),true);
  assert.deepEqual(await listMemories(root),[]);
  assert.equal(await deleteMemory(root,item.id),false);
  assert.equal(await loadChat(root).then(x=>x.length),0,'memory deletion does not write chat history');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Qwen memory cannot store control text, large secrets, or arbitrary client IDs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-memory-'));
 try{
  for(const bad of ['', 'x'.repeat(351), 'x\nPrompt injection'])await assert.rejects(addMemory(root,bad),/Memory/);
  await assert.rejects(deleteMemory(root,'../'),/Invalid memory ID/);
  assert.equal(suggestedMemory('Remember that I like dark themes'),'I like dark themes');
  assert.equal(suggestedMemory('Remember: save files in my workspace'),'save files in my workspace');
  assert.equal(suggestedMemory('Do you remember my files?'),null);
  assert.equal(suggestedMemory('What did we do yesterday?'),null);
  assert.equal(suggestedMemory('Remember: x\nbad'),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('chat history survives server state refresh and is explicitly cleared',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-memory-'));
 try{
  assert.deepEqual(await loadChat(root),[]);
  await saveExchange(root,'Hi Qwen','Hello from the Ally.');
  assert.deepEqual(await loadChat(root),[
   {role:'user',content:'Hi Qwen'},{role:'assistant',content:'Hello from the Ally.'}
  ]);
  await clearChat(root);assert.deepEqual(await loadChat(root),[]);
  assert.deepEqual(await listMemories(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('bounded memory and chat file sizes, with correct last-entry retention',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-memory-'));
 try{
  for(let i=0;i<36;i++)await addMemory(root,'Note '+i);
  let memories=await listMemories(root);
  assert.equal(memories.length,32);
  assert.equal(memories[0].text,'Note 4');
  const joined=memoryContext(memories);
  assert.ok(joined.length<=1800);
  for(let i=0;i<16;i++)await saveExchange(root,'Message '+i,'Response '+i);
  const h=await loadChat(root);assert.equal(h.length,24);
  assert.equal(h[0].content,'Message 4');
 }finally{await rm(root,{recursive:true,force:true});}
});
