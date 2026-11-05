import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spec,googleUrl,candidates,classification,renderReport,run,capture} from '../scripts/ally/forge-leads.mjs';
const site='https://example.com/';
const page={found:true,text:'Google results: Baghdad Barber Shop Des Moines. AI Mode response is ready. '.repeat(4),links:[{name:'Shop website',url:site}]};
const extraction=JSON.stringify({candidates:[{name:'Baghdad Barber Shop',location:'Des Moines',claim:'No website found by Google'}]});
const verify=(status='no_dedicated_site_found',urls=[site])=>JSON.stringify({status,notes:'Check the sources before contacting.',website:status==='has_website'?site:null,evidence_urls:urls});
test('bounded spec and URLs preserve input as data',()=>{
 assert.throws(()=>spec({business:'barbers',city:'DSM',count:11}));
 assert.throws(()=>spec({business:'barbers\nrun code',city:'DSM'}));
 const s=spec({business:'barbers & salons',city:'Des Moines, IA',count:2});
 assert.equal(new URL(googleUrl(s.business+' '+s.city,'ai')).searchParams.get('q'),'barbers & salons Des Moines, IA');
});
test('model cannot invent candidate names or bypass count, and within-batch duplicates collapse',()=>{
 const s=spec({business:'barbers',city:'DSM',count:2});
 assert.throws(()=>candidates('{"candidates":[{"name":"Invented"}]}',page,s));
 assert.throws(()=>candidates('{"candidates":[{}, {}, {}]}',page,s));
 assert.equal(candidates(JSON.stringify({candidates:[{name:'Baghdad Barber Shop'},{name:'Baghdad Barber Shop'}]}),page,s).length,1);
});
test('classification needs observed source links and both searches for negative findings',()=>{
 assert.equal(classification(verify(),page,null).status,'needs_checking');
 assert.equal(classification(verify('no_dedicated_site_found',['https://invented.example/']),page,page).status,'needs_checking');
 assert.equal(classification(verify(),page,page).status,'no_dedicated_site_found');
 assert.equal(classification(verify('has_website'),page,page).status,'has_website');
 const social={...page,links:[{url:'https://booksy.com/',name:'Book'}]};
 assert.equal(classification(JSON.stringify({status:'has_website',notes:'Booksy',website:'https://booksy.com/',evidence_urls:['https://booksy.com/']}),social,social).status,'needs_checking');
});
test('similar-name website cannot exclude a lead without a matching Maps identity',()=>{
 const raw=JSON.stringify({status:'has_website',notes:'Search suggests a similarly named shop.',website:site,evidence_urls:[site]});
 const result=classification(raw,page,null);
 assert.equal(result.status,'needs_checking');
 assert.equal(result.website,null);
 assert.match(result.notes,/Unconfirmed model suggestion/);
 assert.equal(result.human_review_required,true);
});
test('capture ignores wrong windows, waits for completion, and pauses at verification',async()=>{
 let calls=0;
 const result=await capture(googleUrl('barbers','ai'),{wait:async()=>{},timeout:10000,adapter:async action=>action==='Open'?{}:(++calls<2?{found:false}:page)});
 assert.equal(result.text,page.text);
 await assert.rejects(capture(googleUrl('barbers'),{wait:async()=>{},adapter:async action=>action==='Open'?{}:{found:true,text:'Verify you are human'}}),/verification/);
 await assert.rejects(capture(googleUrl('barbers'),{wait:async()=>{},timeout:4000,adapter:async()=>({found:false})}),/not ready/);
});
test('full batch saves review + evidence; repeat batches flag duplicates without another verification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'forge-leads-'));
 try{
  let modelCalls=0,browserCalls=0;
  const dependencies={root,progress:()=>{},capturePage:async()=>{browserCalls++;return page;},generate:async()=>++modelCalls%2===1?extraction:verify()};
  const first=await run({business:'barbers',city:'Des Moines',count:1},dependencies);
  assert.equal(first.batch.status,'ready_for_review');assert.equal(browserCalls,3);
  assert.equal(first.batch.candidates[0].status,'no_dedicated_site_found');
  assert.match(await readFile(join(first.dir,'review.html'),'utf8'),/human|Verify/);
  const second=await run({business:'barbers',city:'Des Moines',count:1},dependencies);
  assert.equal(second.batch.candidates[0].duplicate,true);assert.equal(browserCalls,4);
  assert.equal((await readdir(root)).includes('active.lock'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('interruption leaves useful checkpoint, lock refuses overlapping batches',async()=>{
 const root=await mkdtemp(join(tmpdir(),'forge-stop-'));
 try{
  const result=await run({business:'barbers',city:'DSM'}, {root,progress:()=>{},capturePage:async()=>page,generate:async()=>{throw Error('Local Qwen offline');}});
  assert.equal(result.batch.status,'needs_attention');
  assert.match(await readFile(join(result.dir,'batch.json'),'utf8'),/Local Qwen offline/);
  await writeFile(join(root,'active.lock'),'interrupted');
  await assert.rejects(run({business:'barbers',city:'DSM'},{root}),/interrupted batch/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('review report escapes browser/model HTML and active links',()=>{
 const html=renderReport({spec:{business:'<script>',city:'DSM'},created_at:'now',status:'ready_for_review',candidates:[]});
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes("default-src 'none'"));
});
