import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MACRO_CONTROLLERS,VERIFIED_MACROS,MACRO_MODES,findMacro,filterMacros,reviewSummary} from '../public/nexus-macro-registry.js';

test('one central library has specialized controllers and no invented active macros',()=>{
 const ids=VERIFIED_MACROS.map(m=>m.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.ok(VERIFIED_MACROS.length>=8);
 const groups=new Map(MACRO_CONTROLLERS.map(c=>[c.id,c]));
 assert.equal(groups.size,MACRO_CONTROLLERS.length);
 assert.ok(['ads','reviews','boards'].every(id=>groups.get(id)?.live));
 assert.ok(!groups.get('research')?.live && !groups.get('devices')?.live);
 for(const macro of VERIFIED_MACROS){
   assert.ok(groups.get(macro.controller)?.live,'Every listed macro must be in a working controller: '+macro.id);
   assert.equal(findMacro(macro.id),macro);
   assert.equal(typeof MACRO_MODES[macro.mode],'string');
   for(const field of ['name','summary','need','result','gate','linkLabel','link'])assert.ok(macro[field]?.length>3,macro.id+' missing '+field);
   assert.ok(Array.isArray(macro.simple)&&macro.simple.length>=2,macro.id+' needs simple steps');
   assert.ok(macro.simple.every(step=>typeof step==='string'&&step.length>15));
   assert.match(macro.link,/^\/[a-z0-9-]+\.html$/);
   assert.ok(macro.technical?.source,'No agent-facing technical source');
   assert.ok(!/\b(publish|post-to-social|tiktok-upload)\b/i.test(macro.technical.action||''),'No public posting action in registry');
 }
 assert.equal(findMacro('nonexistent'),null);
});
test('plain-English filters find existing grouped macros',()=>{
 assert.ok(filterMacros({controller:'boards'}).every(m=>m.controller==='boards'));
 assert.equal(filterMacros({search:'does-not-exist-qwerty'}).length,0);
 assert.ok(filterMacros({search:'downloads'}).some(m=>m.id==='video-to-board'));
 assert.equal(filterMacros().length,VERIFIED_MACROS.length);
 assert.ok(filterMacros({controller:'research'}).length===0);
});
test('private review summary counts only relevant verified queue states',()=>{
 assert.deepEqual(reviewSummary(),{toReview:0,changesRunning:0,boardWorking:0,savedToBoard:0,needsHelp:0});
 const data=[
  {status:'pending_review'},
  {status:'rejected',revision_status:'processing'},
  {status:'rejected',revision_status:'needs_help'},
  {status:'approved',board_status:'saved'},
  {status:'approved',board_status:'queued'},
  {status:'approved',board_status:'needs_help'},
  {status:'approved',board_status:null},
 ];
 assert.deepEqual(reviewSummary(data),{toReview:1,changesRunning:1,boardWorking:1,savedToBoard:1,needsHelp:2});
});
test('owner Home has the controller only inside owner options',async()=>{
 const code=await readFile(new URL('../public/nexus-messages.js',import.meta.url),'utf8');
 const p=code.indexOf("{name:'Macro Controller'");
 const owner=code.indexOf("...(!ctx.customer?[");
 const end=code.indexOf("]:[])",owner);
 assert.ok(owner>=0&&p>owner&&p<end,'Macro Controller must be owner-only Home tile');
 assert.match(code.slice(p,p+200),/nexus-macro-controller\.html/);
});
test('dashboard gates all workflow cards behind existing authenticated owner review API',async()=>{
 const html=await readFile(new URL('../public/nexus-macro-controller.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../public/nexus-macro-controller.js',import.meta.url),'utf8');
 assert.match(html,/<div id="app" hidden>/);
 assert.match(js,/fetch\('\/api\/ally-ad-review\?action=list'/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/response\.status===401\|\|response\.status===403/);
 assert.match(js,/by\('gate'\)\.hidden=true;by\('app'\)\.hidden=false/);
 assert.ok(!/eval\(|new Function\(|innerHTML|terminal.*action/i.test(js),'UI never runs arbitrary code or shell commands');
 assert.match(html,/nexus-macro-controller\.js/);
});
