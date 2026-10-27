import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createResearchStore} from '../lib/researchJobs.js';
import {createActorCreditsHandler} from '../api/actor-credits.js';
import {createResearchHandler} from '../api/research-jobs.js';
const records=new Map();
const command=async parts=>{const [cmd,,...rest]=parts;if(cmd==='HGET')return records.get(rest[0])??null;if(cmd==='HVALS')return [...records.values()];if(cmd==='HDEL'){records.delete(rest[0]);return 1;}if(cmd==='EVAL'){const [field,old,next,limit]=parts.slice(4);if((records.get(field)||'')!==old)return 0;if(!records.has(field)&&records.size>=Number(limit))return -1;records.set(field,next);return 1;}throw Error(cmd);};
const store=createResearchStore({command,wake:async()=>({woke:true})});
const wallet=await store.createLink({label:'Browser fixture',credits:16});
const job=await store.submit(wallet.token,{competitor:'Fixture service'});await store.claim({job_id:job.job_id});await store.complete({job_id:job.job_id,result:{summary:'Fixture completed report',sources:[{title:'Example source',url:'https://example.com'}]}});
const handlers={'/api/actor-credits':createActorCreditsHandler({store,configured:()=>false}),'/api/research-jobs':createResearchHandler({store})};
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}: {})});
try{
 let failBalance=false;
 const context=await browser.newContext({viewport:{width:393,height:852},colorScheme:'dark',acceptDownloads:true});
 await context.route('https://nexus.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(handlers[path]){
   const req={method:route.request().method(),headers:{...await route.request().allHeaders(),host:'nexus.test'},body:route.request().postDataJSON()};
   if(failBalance&&req.body.action==='balance')return route.fulfill({status:503,json:{error:'Temporary connection problem'}});
   const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
   await handlers[path](req,res);return route.fulfill({status:res.code,headers:res.headers,json:res.body});
  }
  try{const body=await readFile(new URL('../public'+path,import.meta.url));return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/html',body});}catch{return route.fulfill({status:404,body:'Not found'});}
 });
 // No external image/network calls in this fixture.
 await context.route('https://cdn.pixabay.com/**',route=>route.abort());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://nexus.test/marketplace.html');
 assert((await page.locator('#grid').boundingBox()).y<(await page.locator('#wallet').boundingBox()).y);
 await page.getByRole('link',{name:'See a sample report'}).click();
 await page.getByText('Illustrative output only.',{exact:false}).waitFor();
 const sampleDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download report',exact:true}).click();assert.equal((await sampleDownload).suggestedFilename(),'nexus-research-report.json');
 // Restore a backup on an empty browser, then open research without a key in the URL.
 await page.goto('https://nexus.test/marketplace.html');
 await page.getByRole('textbox',{name:'Saved private wallet link'}).fill('https://nexus.test/marketplace.html?k='+wallet.token);
 await page.getByRole('button',{name:'Restore wallet',exact:true}).click();await page.getByText('8 credits',{exact:true}).waitFor();
 const backup=page.waitForEvent('download');await page.getByRole('button',{name:'Download wallet backup'}).click();assert.equal((await backup).suggestedFilename(),'nexus-wallet-backup.txt');
 await page.goto('https://nexus.test/research.html');await page.getByText('8 credits left',{exact:false}).waitFor();
 await page.locator('#past-reports option').waitFor({state:'attached'});await page.locator('#past-reports').selectOption(job.job_id);
 await page.getByText('Fixture completed report',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Start research'}).isEnabled(),true);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download report',exact:true}).click();const file=await download;const saved=JSON.parse(await readFile(await file.path(),'utf8'));assert.equal(saved.result.summary,'Fixture completed report');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.ACTOR_QA_SCREENSHOT)await page.screenshot({path:process.env.ACTOR_QA_SCREENSHOT,fullPage:true});
 failBalance=true;await page.goto('https://nexus.test/marketplace.html');await page.getByText('Your saved wallet link has been kept.',{exact:false}).waitFor();
 assert((await page.getByRole('link',{name:'Open',exact:true}).getAttribute('href')).includes(wallet.token));
 assert.equal(errors.length,0,errors.join('\n'));
 await page.setViewportSize({width:1280,height:800});await page.emulateMedia({colorScheme:'light'});failBalance=false;await page.reload();await page.getByText('8 credits',{exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('PASS: discovery first; sample; wallet restore/backup; direct Research saved access; history; JSON download; transient error preserves wallet; 393px dark + 1280px light; no page errors.');
}finally{await browser.close();}
