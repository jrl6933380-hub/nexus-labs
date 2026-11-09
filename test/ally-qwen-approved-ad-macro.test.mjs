import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {approvedAdMacroRoute} from '../scripts/ally/qwen-work-tools.mjs';
import {runAgent} from '../scripts/ally/qwen-terminal-agent.mjs';

const a=(tool,args={})=>JSON.stringify({tool,args});

test('approved ad macro dispatch selects only exact owner-visible, low-risk actions',()=>{
 assert.deepEqual(approvedAdMacroRoute('Start a new ad project named "Fall Sale" on the Ally.'),{action:'start_ad',name:'Fall Sale'});
 assert.deepEqual(approvedAdMacroRoute('Please preview ad project abc-123 before rendering.'),{action:'preview_ad',project_id:'abc-123'});
 assert.deepEqual(approvedAdMacroRoute('Make ad variations for ad project abc-123.'),{action:'variants_ad',project_id:'abc-123'});
 assert.deepEqual(approvedAdMacroRoute('Package ad project abc-123.'),{action:'package_ad',project_id:'abc-123'});
 for(const text of [
  'Explain how to start an ad project named "Fall Sale"',
  'Do not start ad project named "Fall Sale"',
  'Please start ad project named "bad; rm"',
  'Render ad project abc-123',
  'Submit ad project abc-123 for private review',
  'Save approved video to board',
  'Please make me an ad',
  'Start ad project named "Fall Sale" but do not start yet'
 ])assert.equal(approvedAdMacroRoute(text),null,text);
});

test('verified ad macro runs before any Qwen generation and ends the job with its receipt',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'qwen-ad-macro-first-'));
 let generateCalls=0;const seen=[];
 try{
  const result=await runAgent({task:'Start a new ad project named "Fall Sale" on the Ally.',workspace,
   execute:async(action)=>{seen.push(action);if(action.tool==='ad_macro')return {action:'start_ad',status:'succeeded',output:'CREATED sample project'};throw Error('Unexpected tool');},
   generate:async()=>{generateCalls++;return a('finish',{message:'should never be asked'});}});
  assert.equal(result.status,'done');assert.equal(generateCalls,0);assert.equal(seen.length,1);
  assert.match(result.answer,/start_ad succeeded.*CREATED sample project/);
  assert.equal(seen[0].tool,'ad_macro');assert.equal(seen[0].args.name,'Fall Sale');
  assert.equal(result.history[0].step,0);assert.equal(result.history[0].result.status,'succeeded');
 }finally{await rm(workspace,{recursive:true,force:true});}
});

test('macro failure stops before model generation and never claims completion',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'qwen-ad-macro-failed-'));let called=0;
 try{
  const result=await runAgent({task:'Preview ad project abc-123.',workspace,execute:async()=>({status:'failed',error:'Missing verified project'}),generate:async()=>{called++;return a('finish',{message:'Preview is ready'});}});
  assert.equal(result.status,'needs_help');assert.match(result.reason,/Missing verified project/);assert.equal(called,0);
 }finally{await rm(workspace,{recursive:true,force:true});}
});

test('checksum-pinned installer stages private review uploader for BOTH runners',async()=>{
 const installer=await readFile(new URL('../scripts/ally/install-qwen-console.ps1',import.meta.url),'utf8');
 const manifest=installer.match(/\$files=@\(([\s\S]*?)\)\s*foreach\(\$item/);
 const copies=installer.match(/\$copies=@\(([\s\S]*?)\)\s*foreach\(\$copy/);
 assert.ok(manifest&&copies,'installer stage and runner copy lists must exist');
 assert.match(installer,/\[string\]\$SubmitReviewSha256/);
 assert.match(manifest[1],/path='scripts\/ally\/submit-ad-review\.ps1';hash=\$SubmitReviewSha256/);
 assert.match(copies[1],/from='scripts\\ally\\submit-ad-review\.ps1';hash=\$SubmitReviewSha256/);
 const uploader=await readFile(new URL('../scripts/ally/submit-ad-review.ps1',import.meta.url),'utf8');
 assert.match(uploader,/NEXUS_REVIEW_SUBMITTED/);
 assert.match(uploader,/device-token\.xml/);
 assert.match(uploader,/nexus-labs-sigma\.vercel\.app/);
 assert.doesNotMatch(uploader,/tiktok\.com|youtube\.com|instagram\.com/i);
});

test('local ad macros cannot claim success without expected artifact receipts',async()=>{
 const {executeTool}=await import('../scripts/ally/qwen-terminal-agent.mjs');
 const workspace=await mkdtemp(join(tmpdir(),'qwen-ad-macro-receipt-'));
 const original=process.env.USERPROFILE;process.env.USERPROFILE='C:\\Users\\test';
 try{
  const run=async()=>({stdout:'OK',stderr:''});
  const started=await executeTool({tool:'ad_macro',args:{action:'start_ad',name:'My Ad'}},{workspace,commandRunner:run});
  assert.equal(started.status,'failed');assert.match(started.error,/did not confirm/);
  const preview=await executeTool({tool:'ad_macro',args:{action:'preview_ad',project_id:'test-123'}},{workspace,commandRunner:run});
  assert.equal(preview.status,'failed');assert.match(preview.error,/verified result/);
  const submitted=await executeTool({tool:'ad_macro',args:{action:'submit_ad',project_id:'test-123'}},{workspace,commandRunner:run});
  assert.equal(submitted.status,'failed');assert.match(submitted.error,/receipt missing/);
  const valid=await executeTool({tool:'ad_macro',args:{action:'submit_ad',project_id:'test-123'}},{workspace,commandRunner:async()=>({stdout:'NEXUS_REVIEW_SUBMITTED '+('a'.repeat(32)),stderr:''})});
  assert.equal(valid.status,'succeeded');
 }finally{if(original===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=original;await rm(workspace,{recursive:true,force:true});}
});
