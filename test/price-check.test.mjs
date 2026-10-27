import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchStore} from '../lib/researchJobs.js';
import {parseUrls,compare,buildPriceResult,baselineField,MAX_URLS} from '../lib/priceBaselines.js';
import {ACTORS,publicCatalog} from '../lib/actorCatalog.js';

const PRICES='nexus:research:prices:v1';
function memory(){
  const h=new Map(),p=new Map();
  const fn=async parts=>{
    const [cmd,key,...rest]=parts;
    if(key===PRICES){
      if(cmd==='HSET'){p.set(rest[0],rest[1]);return 1;}
      if(cmd==='HGET')return p.get(rest[0])??null;
      if(cmd==='HDEL'){p.delete(rest[0]);return 1;}
      throw new Error('unexpected prices '+cmd);
    }
    if(cmd==='HGET')return h.get(rest[0])??null;
    if(cmd==='HVALS')return [...h.values()];
    if(cmd==='HDEL'){h.delete(rest[0]);return 1;}
    if(cmd==='EVAL'){
      const [field,old,next,limit]=[parts[4],parts[5],parts[6],parts[7]];
      const cur=h.get(field)??'';
      if(cur!==old)return 0;
      if(cur===''&&h.size>=Number(limit))return -1;
      h.set(field,next);return 1;
    }
    throw new Error('unexpected '+cmd);
  };
  fn.prices=p;
  return fn;
}
const store=()=>{const command=memory();const s=createResearchStore({command,wake:async()=>({woke:false})});s.command=command;return s;};
const A='https://shop.example.com/widget',B='https://other.example.org/gadget';
const ok=(url,price,extra={})=>({url,status:'ok',product:'Widget',price,currency:'USD',available:'in_stock',evidence:'Price $'+price,...extra});

test('links: bare domains get https, junk and private hosts are dropped, duplicates removed',()=>{
  assert.deepEqual(parseUrls('shop.example.com/widget, https://shop.example.com/widget#top\nhttp://localhost:3000/x 192.168.1.5/a javascript:alert(1) https://user:pw@a.example.com/'),[A]);
  assert.equal(parseUrls('').length,0);
  assert.equal(MAX_URLS,5);
});

test('compare: first, same, up, down, stock and currency changes',()=>{
  assert.equal(compare(null,{price:10,currency:'USD'}).kind,'first');
  const prev={price:20,currency:'USD',available:'in_stock'};
  assert.equal(compare(prev,{price:20,currency:'USD',available:'in_stock'}).kind,'same');
  assert.match(compare(prev,{price:25,currency:'USD',available:'in_stock'}).text,/Up 5\.00 \(\+25\.0%\)/);
  assert.match(compare(prev,{price:15,currency:'USD',available:'in_stock'}).text,/Down 5\.00 \(-25\.0%\)/);
  assert.match(compare(prev,{price:20,currency:'USD',available:'out_of_stock'}).text,/Now out of stock/);
  assert.equal(compare(prev,{price:20,currency:'EUR',available:'in_stock'}).kind,'currency');
  assert.equal(compare(prev,{price:20,currency:'USD',available:'unknown'}).kind,'same');
});

test('buildPriceResult: first run saves baselines; blocked pages are named and keep the old price',()=>{
  const first=buildPriceResult({urls:[A,B],items:[ok(A,20),{url:B,status:'blocked'}],baselines:new Map(),at:Date.UTC(2026,9,27)});
  assert.equal(first.checked,1);
  assert.match(first.result.summary,/Saved the current price of 1 product/);
  assert.equal(first.updates.length,1);
  assert.match(first.result.sections.find(s=>s.title==='Could not check').items[0],/blocked the check/);
  assert.equal(first.result.tables[0].rows[1][2],'Not checked');
  const second=buildPriceResult({urls:[A,B],items:[ok(A,18,{available:'out_of_stock'}),ok(B,5)],baselines:new Map([[A,first.updates[0].rec]]),at:Date.UTC(2026,10,3)});
  assert.equal(second.changed,1);
  assert.match(second.result.summary,/1 of 1 saved price changed/);
  assert.match(second.result.sections[0].items[0],/Down 2\.00 \(-10\.0%\)\. Now out of stock \(was 20\.00 USD, now 18\.00 USD\)/);
  assert.match(second.result.summary,/1 new baseline saved/);
  assert.equal(second.result.tables[0].rows[0][1],'20.00 USD');
});

test('agent answers for links the customer did not submit, or without a price or currency, are ignored',()=>{
  const r=buildPriceResult({urls:[A],items:[ok('https://evil.example.net/x',1),{url:A,status:'ok',price:5},{url:A,status:'ok',currency:'USD'}],baselines:new Map(),at:1});
  assert.equal(r.checked,0);
  assert.equal(r.updates.length,0);
  assert.equal(r.result.summary,'No prices could be read.');
});

test('catalog entry: in the price range, public view hides instructions',()=>{
  const a=ACTORS.price;
  assert.ok(a&&a.cost>=8&&a.cost<=12);
  assert.ok(!('instructions' in publicCatalog().find(x=>x.id==='price')));
  for(const s of ['never guess a price','blocked','never calculate','saved_baselines','exact quote'])assert.ok(a.instructions.includes(s),s);
});

test('end to end on the queue: baseline saved, then compared on the next run; failure refunds and saves nothing',async()=>{
  const s=store();
  const {token,link_id}=await s.createLink({label:'W',credits:40});
  await assert.rejects(()=>s.submit(token,{actor:'price',urls:'not a link'}),/valid web link/);
  await assert.rejects(()=>s.submit(token,{actor:'price',urls:Array.from({length:6},(_,i)=>'https://a'+i+'.example.com/p').join(' ')}),/up to 5/i);
  const q1=await s.submit(token,{actor:'price',urls:A+' '+B});
  assert.equal(q1.credits_left,40-ACTORS.price.cost);
  const c1=await s.claim({job_id:q1.job_id});
  assert.equal(c1.actor,'price');
  assert.match(c1.instructions,/"saved_baselines": \[\]/);
  const d1=await s.complete({job_id:q1.job_id,result:{summary:'x',sections:[{title:'Checks',items:[]}],items:[ok(A,20),ok(B,7)]}});
  assert.equal(d1.status,'done');
  assert.equal(s.command.prices.size,2);
  const st1=await s.status(token,{job_id:q1.job_id});
  assert.equal(st1.result.tables[0].name,'Prices');
  assert.equal(st1.result.items,undefined);
  const q2=await s.submit(token,{actor:'price',urls:A});
  const c2=await s.claim({job_id:q2.job_id});
  assert.match(c2.instructions,/"price": 20/);
  await s.complete({job_id:q2.job_id,result:{summary:'x',sections:[{title:'Checks',items:[]}],items:[ok(A,25)]}});
  const st2=(await s.status(token,{job_id:q2.job_id})).result;
  assert.match(st2.sections[0].items[0],/Up 5\.00/);
  assert.equal(JSON.parse(s.command.prices.get(baselineField(link_id,A))).price,25);
  const q3=await s.submit(token,{actor:'price',urls:A});
  await s.claim({job_id:q3.job_id});
  const before=s.command.prices.get(baselineField(link_id,A));
  const d3=await s.complete({job_id:q3.job_id,result:{summary:'x',sections:[{title:'Checks',items:[]}],items:[{url:A,status:'blocked'}]}});
  assert.equal(d3.status,'failed');
  assert.equal(d3.refunded,true);
  assert.equal(s.command.prices.get(baselineField(link_id,A)),before);
  assert.equal((await s.walletInfo({link_id})).credits,40-ACTORS.price.cost*2);
});
