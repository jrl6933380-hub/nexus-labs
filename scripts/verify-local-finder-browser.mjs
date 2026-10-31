// Fixture-only UI verification; does not call providers, Stripe, or production.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {publicCatalog} from '../lib/actorCatalog.js';
import {createResearchStore} from '../lib/researchJobs.js';
import {createResearchHandler} from '../api/research-jobs.js';
import {OPPORTUNITY_COLUMNS} from '../lib/localOpportunities.js';
const map=new Map();
const command=async p=>{
  if(p[0]==='HGET')return map.get(p[2])??null;
  if(p[0]==='HVALS')return [...map.values()];
  if(p[0]==='HDEL'){map.delete(p[2]);return 1;}
  if(p[0]==='EVAL'){
    const [field,old,next,limit]=p.slice(4);
    if((map.get(field)||'')!==old)return 0;
    if(!map.has(field)&&map.size>=Number(limit))return -1;
    map.set(field,next);return 1;
  }
  throw Error('Unexpected '+p[0]);
};
const store=createResearchStore({command,wake:async()=>({woke:false})});
const handler=createResearchHandler({store});
const hostile='<img src=x onerror=window.pwned=1>';
const rows=Array.from({length:25},(_,i)=>[
  i===0?hostile:'Example Salon '+i,'salons','Des Moines',i+' Main St',
  'https://example.test/'+i,'listed',i<10?'yes':'no',
  '+15155550100','public@example.test','https://directory.test/'+i,'https://example.test/contact',
  'Booking is by phone on the contact page.','https://example.test/contact','2026-10-27T22:00:00Z',
  '=draft only; no message sent',
]);
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);
      const send=(data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
      if(req.url==='/api/actor-credits'){
        if(body.action==='catalog')return send({data:{actors:publicCatalog()}});
        if(body.action==='balance')return send({data:{credits:(await store.walletByToken(body.key)).credits}});
        throw Error('Unexpected credits action');
      }
      if(req.url==='/api/research-jobs'){
        const out={setHeader:(k,v)=>res.setHeader(k,v),status(c){res.statusCode=c;return this;},async json(data){
          if(body.action==='submit'&&data.ok){
            const id=data.data.job_id;await store.claim({job_id:id});
            await store.complete({job_id:id,result:{summary:'Fixture results.',sections:[{title:'Coverage and limits',items:['25 businesses, ten sites inspected; fixture only.']}],tables:[{name:'Opportunities',columns:OPPORTUNITY_COLUMNS,rows}]}});
          }
          send(data);
        }};
        // Real API handler calls json synchronously; await its asynchronous fixture completion before releasing.
        let pending;
        const json=out.json.bind(out);out.json=data=>(pending=json(data));
        await handler({method:'POST',headers:req.headers,body},out);await pending;return;
      }
      throw Error('Unexpected endpoint');
    }
    const pathname=new URL(req.url,'http://fixture.test').pathname;
    const path=resolve('public','.'+pathname);
    if(!path.startsWith(resolve('public')+'/'))throw Error('Bad path');
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');
    res.end(await readFile(path));
  }catch(e){res.statusCode=500;res.end(String(e));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [393,1280]){
    const context=await browser.newContext({viewport:{width,height:852},acceptDownloads:true});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const wallet=await store.createLink({label:'browser fixture',credits:50});
    await page.goto(base+'/actor.html?a=localfinder&k='+wallet.token);
    await page.getByLabel('Business category').fill('salons');
    await page.getByLabel('City and state or country').fill('Des Moines');
    await page.getByLabel('What service are you selling?').fill('booking websites');
    await page.locator('#go').click();
    await page.getByRole('heading',{name:'25 business opportunities',exact:true}).waitFor();
    assert.equal(await page.locator('#out article').count(),25);
    assert.equal(await page.locator('#out img').count(),0);
    assert.equal(await page.evaluate(()=>window.pwned),undefined);
    assert.equal(await page.locator('#out article h3').first().textContent(),hostile);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('#out article').first().getByRole('link',{name:'Contact source',exact:true}).getAttribute('href'),'https://example.test/contact');
    const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download opportunities (.csv)'}).click()]);
    const csv=await readFile(await dl.path(),'utf8');
    assert.ok(csv.includes('"\'+15155550100"'));assert.ok(csv.includes('"\'=draft only; no message sent"'));
    await page.reload();await page.getByRole('heading',{name:'25 business opportunities',exact:true}).waitFor();
    assert.equal(await page.locator('#out article').count(),25);
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('PASS '+width+'px: submit → result, 25 cards, literal hostile text, source links, safe CSV, reload');
  }
}finally{await browser?.close();await new Promise(r=>server.close(r));}
