import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {approvedStarterRoute,siteStarterHtml,workCatalog} from '../scripts/ally/qwen-work-tools.mjs';
import {executeTool,runAgent} from '../scripts/ally/qwen-terminal-agent.mjs';

const action=(tool,args={})=>({tool,args});
const text=a=>JSON.stringify(a);

test('macro catalog keeps nine existing workflows and adds three fixed local site starters',()=>{
 const catalog=workCatalog();
 assert.equal(catalog.macros.length,9);
 assert.deepEqual(catalog.site_starters.map(t=>t.id),['barbershop','salon','service']);
 assert.equal(catalog.permissions.publishing,'not_available');
 assert.equal(catalog.permissions.github,'not_available');
 for(const template of ['barbershop','salon','service']){
  const html=siteStarterHtml({template,name:'Example and Company'});
  assert.match(html,/\.hero\{[^}]*flex-direction:column/);
  assert.match(html,/@media\(max-width:650px\)/);
  assert.match(html,/<section class="content" id="services">/);
  assert.match(html,/<section class="content" id="contact">/);
  assert.doesNotMatch(html,/<script|https?:\/\//i);
 }
 assert.match(siteStarterHtml({template:'salon',name:'A & B "Beauty"'}),/A &amp; B &quot;Beauty&quot;/);
 assert.throws(()=>siteStarterHtml({template:'unknown',name:'Example'}),/verified/);
 assert.throws(()=>siteStarterHtml({template:'barbershop',name:'<script>'}),/Business name/);
});

test('macro-first routing requires explicit local file path and site-build instruction',()=>{
 const job=`Create 'barber-smoke-3/index.html' in the local workspace with a black-and-gold one-page layout for 'The Gentleman's Cut', including Hero, Services, About and Contact`;
 assert.deepEqual(approvedStarterRoute(job),{template:'barbershop',path:'barber-smoke-3/index.html',name:"The Gentleman's Cut"});
 assert.equal(approvedStarterRoute('Fix existing local draft site in sites/a/index.html'),null);
 assert.equal(approvedStarterRoute('Do not create a site in sites/barber/index.html'),null);
 assert.equal(approvedStarterRoute('Build a website for a salon, but do not write files yet'),null);
 assert.equal(approvedStarterRoute('Create a public website, no local target'),null);
 assert.equal(approvedStarterRoute('Make an ad for a barbershop'),null);
});

test('site starter writes only new isolated index.html; no overwrite or path traversal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-macro-site-'));
 try{
  const result=await executeTool(action('site_starter',{template:'barbershop',path:'demo/index.html',name:"The Gentleman's Cut"}),{workspace:root});
  assert.equal(result.status,'succeeded');
  const html=await readFile(join(root,'demo','index.html'),'utf8');
  assert.match(html,/The Gentleman&#39;s Cut/);
  assert.match(html,/id="about"/);
  await assert.rejects(executeTool(action('site_starter',{template:'barbershop',path:'demo/index.html',name:'New Business'}),{workspace:root}),e=>e.code==='EEXIST');
  assert.equal(await readFile(join(root,'demo','index.html'),'utf8'),html);
  await assert.rejects(executeTool(action('site_starter',{template:'barbershop',path:'../outside/index.html',name:'Example'}),{workspace:root}),/Unsafe workspace path/);
  await assert.rejects(executeTool(action('site_starter',{template:'barbershop',path:'draft.js',name:'Example'}),{workspace:root}),/index.html/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('approved website task runs macro before first model generation and records its action',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-macro-first-'));
 try{
  let calls=0;const target=join(root,'sites','test','index.html');
  const tasks=[
   action('set_plan',{steps:['Inspect the starter','Confirm the page']}),
   action('read_file',{path:'sites/test/index.html'}),
   action('update_step',{id:1,status:'done'}),
   action('update_step',{id:2,status:'done'}),
   action('finish',{message:'Static starter exists and was inspected'})
  ];
  const result=await runAgent({task:'Create a simple local barbershop website in sites/test/index.html for "My Barber"',workspace:root,
   generate:async(messages)=>{calls++;assert.match(await readFile(target,'utf8'),/My Barber/);if(calls===1)assert.match(messages.at(-1).content,/ALREADY CREATED/);return text(tasks.shift());}});
  assert.equal(result.status,'done');
  assert.equal(result.history[0].tool,'site_starter');
  assert.equal(result.history[0].step,0);
  assert.equal(calls,5);
  assert.deepEqual(result.plan.map(x=>x.status),['done','done']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('non-website work never auto-generates site content',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-no-macro-'));
 try{
  const r=await runAgent({task:'Write a short note',workspace:root,generate:async()=>text(action('finish',{message:'No site requested'}))});
  assert.equal(r.status,'done');assert.equal(r.history.length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('plural barbers and salons choose the matching starter instead of the generic one',()=>{
 assert.equal(approvedStarterRoute("Create 'smoke-b/index.html' in the local workspace as a one-page site for 'Smoke Test Barbers', including Hero and Contact").template,'barbershop');
 assert.equal(approvedStarterRoute("Build a landing page at 'nails/index.html' for 'Glow Salons'").template,'salon');
 assert.equal(approvedStarterRoute("Build a landing page at 'plumb/index.html' for 'Pipe Pros'").template,'service');
});
