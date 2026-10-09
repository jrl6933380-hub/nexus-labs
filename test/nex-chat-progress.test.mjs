import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatProgress,modelProgressText,progressPhase,publicProgressUpdate} from '../lib/nexChatProgress.js';
import {INDIVIDUAL_WORK_MS,remainingModelTimeout} from '../lib/nexWorkTiming.js';

test('public model progress excludes thinking and tool payloads',()=>{
  assert.equal(modelProgressText([{type:'thinking',thinking:'private reasoning'},{type:'tool_use',input:{secret:'hidden'}},{type:'text',text:'I found the strongest direction. I’m checking the details.'}]),'I found the strongest direction. I’m checking the details.');
});
test('progress is emitted immediately and stored in order before the final status',async()=>{
  const saved=[],events=[];
  const progress=createChatProgress({save:async value=>{await Promise.resolve();saved.push(value);},emit:(type,value)=>events.push({type,value}),now:()=>123});
  progress.record({type:'stage',tool:'read_repo_file',label:'technical filename'});
  progress.record({type:'commentary',text:'I found the best direction.'});
  progress.record({type:'commentary',text:'I found the best direction.'});
  progress.record({type:'commentary',text:'Now I’m building the draft.'});
  await progress.flush();
  assert.equal(events.length,3);assert.equal(saved.length,3);
  assert.deepEqual(saved.at(-1).updates.map(x=>x.text),['I found the best direction.','Now I’m building the draft.']);
  assert.equal(saved[0].stage.label,'Planning the work');
  assert.equal(saved.at(-1).updates[0].type,'update');
  assert.equal(saved.at(-1).updates[0].phase,'working');
  assert.deepEqual(saved.at(-1).updates.map(x=>x.id),[1,2]);
});
test('progress phases describe meaningful public states without payloads',()=>{
  assert.equal(progressPhase({tool:'test_code'}),'verifying');
  assert.equal(progressPhase({tool:'planning'}),'planning');
  assert.equal(progressPhase({tool:'ask_user_question'}),'waiting');
  assert.equal(progressPhase({tool:'commit_repo_files'}),'working');
  const update=publicProgressUpdate({phase:'verifying',text:'```json\n{"secret":true}\n```Checking the finished flow.'},{id:4,now:()=>50});
  assert.deepEqual(update,{id:4,type:'update',phase:'verifying',status:'active',text:'Checking the finished flow.',createdAt:50});
});
test('progress storage is bounded and survives a temporary storage failure',async()=>{
  let count=0;
  const progress=createChatProgress({save:async()=>{if(++count===1)throw new Error('offline');}});
  for(let i=0;i<25;i++)progress.record({type:'commentary',text:`Update ${i}`});
  await progress.flush();assert.equal(count,25);assert.equal(progress.snapshot().updates.length,20);assert.equal(progress.snapshot().updates.at(-1).id,25);
});
test('individual requests allow four minutes but later calls use the remaining budget',()=>{
  assert.equal(INDIVIDUAL_WORK_MS,240000);
  const context={providerTimeoutMs:INDIVIDUAL_WORK_MS,reasoningState:{startedAt:1000,budgets:{maxElapsedMs:INDIVIDUAL_WORK_MS}}};
  assert.equal(remainingModelTimeout(context,1000),240000);
  assert.equal(remainingModelTimeout(context,201000),40000);
  assert.equal(remainingModelTimeout({providerTimeoutMs:240000},1000),240000);
});

test('polling renders each saved update once before completion',async()=>{
  const {readFile}=await import('node:fs/promises');
  const vm=await import('node:vm');
  const html=await readFile(new URL('../public/workspace.html',import.meta.url),'utf8');
  const source=html.slice(html.indexOf('async function waitForChatRequest('),html.indexOf('async function durableChatRequest('));
  const requests=[{state:'running',updates:[{id:1,text:'Checking sources.'}]},{state:'running',updates:[{id:1,text:'Checking sources.'},{id:2,text:'Building the draft.'}]},{state:'finished',updates:[{id:1,text:'Checking sources.'},{id:2,text:'Building the draft.'}],response:{reply:'Done'}}];
  const clears=[],seen=[];
  const context={Date,Set,document:{hidden:false},pause:async()=>{},chatRequestStatus:async()=>requests.shift(),savePendingChat:value=>clears.push(value)};
  vm.createContext(context);vm.runInContext(source,context);
  const result=await context.waitForChatRequest({requestId:'test'},{onProgress:update=>seen.push(update.text)});
  assert.deepEqual(seen,['Checking sources.','Building the draft.']);assert.equal(result.reply,'Done');assert.deepEqual(clears,[null]);
});
