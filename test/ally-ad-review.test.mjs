import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reviewProject, parseModelJson, applyRepair, runReview, runJob, buildPreview, localGenerator} from '../scripts/ally/ad-review-loop.mjs';
const good = () => ({specVersion:2,name:'Review fixture',brand:'Nexus Labs',initial:'N',mood:'clean',palette:'electric-pop',platform:{format:'portrait',lengthSec:15},concept:true,scenes:[
 {id:'hook',type:'hook_text',duration:4,params:{headline:'Too many ideas?',support:'Make a clear plan.'}},
 {id:'change',type:'before_after',duration:7,params:{beforeText:'Scattered tasks',afterText:'Clear next steps'}},
 {id:'close',type:'end_card',duration:4,params:{cta:'Explore Nexus',tagline:'Concept preview'}}]});
const reply = x => ({content:JSON.stringify(x),metrics:{seconds:.01}});
test('review uses canonical validation plus exact duration, CTA, hook and reading-time checks',()=>{
 assert.equal(reviewProject(good()).ok,true);
 const p=good();p.scenes[2].duration=1;assert.equal(reviewProject(p).issues[0].code,'schema');
 p.scenes[2].duration=2;p.scenes[1].duration=9;
 assert.ok(reviewProject(p).issues.some(x=>x.code==='cta_hold'));
 p.concept=false;p.scenes[0].params.headline='one two three four five six seven eight';
 const codes=reviewProject(p).issues.map(x=>x.code);assert.ok(codes.includes('concept'));assert.ok(codes.includes('hook_length'));
 const wrong=good();wrong.scenes[1].duration=6;assert.ok(reviewProject(wrong).issues.some(x=>x.code==='total_duration'));
 const dense=good();dense.scenes[1]={id:'steps',type:'steps_list',duration:7,params:{items:[{title:'Capture',detail:'one two three four five six seven eight nine ten'},{title:'Plan',detail:'one two three four five six seven eight nine ten'},{title:'Make',detail:'one two three four five six seven eight nine ten'}],stagger:.8}};
 assert.ok(reviewProject(dense).issues.some(x=>x.code==='reading_time'));
});
test('invalid seed gets real feedback, narrow repair, and still requires visual review',async()=>{
 const p=good();p.scenes[2].duration=2;p.scenes[1].duration=9;const states=[],attempts=[];let calls=0;
 const r=await runReview({brief:'A Nexus concept',seedProject:p},{generate:async request=>{calls++;assert.match(request.prompt,/cta_hold/);return reply({durations:{change:8,close:3}});},onState:async x=>states.push(x.status),onAttempt:async x=>attempts.push(x)});
 assert.equal(calls,1);assert.equal(r.repairCount,1);assert.equal(r.status,'awaiting_visual_review');assert.equal(r.visualReview,'pending');assert.equal(r.project.scenes[0].params.headline,p.scenes[0].params.headline);
 assert.deepEqual(states,['drafting','checking','revising','checking','awaiting_visual_review']);assert.equal(attempts.length,2);
 assert.equal(p.scenes[2].duration,2,'input must not be mutated');
});
test('bad repairs stop at two and preserve the last draft for handoff',async()=>{
 const p=good();p.concept=false;let calls=0;
 const r=await runReview({brief:'A concept',seedProject:p},{generate:async()=>{calls++;return {content:'not json'};}});
 assert.equal(calls,2);assert.equal(r.repairCount,2);assert.equal(r.status,'needs_help');assert.deepEqual(r.project,p);assert.ok(r.issues.some(x=>x.code==='repair_format'));
});
test('malformed initial JSON can be repaired without executing model text',async()=>{
 let calls=0;const r=await runReview({brief:'A concept'},{generate:async()=>++calls===1?{content:'console.log("not executable")'}:reply(good())});
 assert.equal(calls,2);assert.equal(r.status,'awaiting_visual_review');
 assert.throws(()=>parseModelJson('{"__proto__":{"polluted":true}}'),/Unsafe/);
 assert.equal({}.polluted,undefined);
 assert.equal(parseModelJson('```json\n{"ok":true}\n```').strippedFence,true);
 assert.throws(()=>applyRepair(good(),{durations:{missing:3}}),/Unknown/);
 assert.throws(()=>applyRepair(good(),{command:'Remove-Item'}),/Repair must contain/);
});
test('cancel stops before generation, and provider errors do not loop or switch providers',async()=>{
 const c=new AbortController();c.abort(new Error('stop'));let calls=0;
 const r=await runReview({brief:'A concept'},{signal:c.signal,generate:async()=>{calls++;return reply(good());}});
 assert.equal(r.status,'canceled');assert.equal(calls,0);
 const failed=await runReview({brief:'A concept'},{generate:async()=>{calls++;throw new Error('offline');}});
 assert.equal(failed.status,'failed');assert.equal(calls,1);
});
test('local client calls loopback only, disables thinking, and does not execute generated tools',async()=>{
 const calls=[];const generate=localGenerator({fetchImpl:async(url,options)=>{
  calls.push({url,options});if(url.endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'local-qwen'}]})};
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(good())},finish_reason:'stop'}],usage:{completion_tokens:10}})};
 }});
 const r=await generate({system:'schema',prompt:'brief'});assert.ok(r.content.includes('Review fixture'));assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url.startsWith('http://127.0.0.1:9931/')));
 const sent=JSON.parse(calls[1].options.body);assert.equal(sent.model,'local-qwen');assert.equal(sent.chat_template_kwargs.enable_thinking,false);assert.equal(sent.tools,undefined);
});
test('job writes durable attempts, state and preview and refuses to overwrite prior work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ally-review-'));try{
  const result=await runJob({brief:'A concept',seedProject:good()},root,{generate:async()=>{throw new Error('should not call model');}});
  assert.equal(result.status,'awaiting_visual_review');const state=JSON.parse(await readFile(join(root,'state.json'),'utf8'));
  assert.equal(state.preview,'preview.html');assert.equal(state.visualReview,'pending');assert.ok((await readFile(join(root,'preview.html'),'utf8')).includes('Review fixture'));
  assert.equal(JSON.parse(await readFile(join(root,'attempt-0.json'),'utf8')).seeded,true);
  await assert.rejects(runJob({brief:'Other'},root),/existing drafts/);
  assert.equal(JSON.parse(await readFile(join(root,'state.json'),'utf8')).status,'awaiting_visual_review');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('stop file aborts a running inference and leaves a canceled receipt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ally-review-stop-'));try{
  const r=await runJob({brief:'A concept'},root,{pollMs:10,generate:({signal})=>new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>reject(signal.reason),{once:true});void writeFile(join(root,'stop'),'stop');
  })});
  assert.equal(r.status,'canceled');assert.equal(JSON.parse(await readFile(join(root,'state.json'),'utf8')).status,'canceled');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('preview embeds only validated data and escapes closing script tags',()=>{
 const p=good();p.scenes[0].params.headline='</script><script>bad</script>';
 const html=buildPreview(p,'<script>window.__capture=()=>{};</script>');
 assert.ok(html.includes('\\u003c/script>'));assert.ok(!html.includes('<script>bad'));
 const bad=good();bad.concept=false;assert.throws(()=>buildPreview(bad,'<script>window.__capture=()=>{};</script>'),/passing/);
});
