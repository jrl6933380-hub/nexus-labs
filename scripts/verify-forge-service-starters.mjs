import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { generateServiceVariants, renderServiceTemplate } from '../public/forge-service-templates.js';

const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote'], ...(process.env.NEXUS_TEST_BROWSER_PATH ? {executablePath:process.env.NEXUS_TEST_BROWSER_PATH} : {}) });
const errors=[];
const page = await browser.newPage({viewport:{width:393,height:852}});
page.on('pageerror',error=>errors.push(error.message));
let checks=0;
const sample={id:'lead-sample',businessName:'Example Barber',category:'Barber',location:'Example City',phone:'515-555-0100',siteStatus:'none',pitch:{opener:'Sample opener',weaknesses:[],discoveryQuestions:[],objections:[],demoLine:'Sample',upsell:'Sample',nextStep:'Sample'}};
const root=resolve('public');
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  try{const data=await readFile(path);res.setHeader('Content-Type',extname(path)==='.js'?'application/javascript':'text/html');res.end(data);}catch{res.writeHead(404);res.end();}
});
try {
  for(const width of [393,1280])for(const id of ['editorial','bold','fresh']){
    await page.setViewportSize({width,height:852});await page.setContent(renderServiceTemplate(sample,id));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks++;
    await page.getByRole('button',{name:'Book a visit',exact:true}).click();
    await page.getByLabel('Name (use sample details)').fill('Sample guest');await page.getByLabel('Preferred day').fill('2026-12-01');
    await page.getByRole('button',{name:'Preview request',exact:true}).click();
    assert.match(await page.locator('#booking-feedback').textContent(),/No appointment was booked/);checks++;
    await page.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.locator('#booking').evaluate(el=>el.open),false);checks++;
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let json={};
    if(path==='/api/forge-leads')json={leads:[sample]};
    if(path==='/api/forge-clients')json={clients:[],owedCents:0,paidCents:0};
    if(path==='/api/forge-site'){
      const body=route.request().postDataJSON();
      if(body.action==='templates'){sample.siteVariants=generateServiceVariants(sample);sample.siteTemplateId='editorial';sample.siteHtml=sample.siteVariants[0].html;sample.siteStatus='ready';}
      else if(body.action==='select_template'){const variant=sample.siteVariants.find(v=>v.id===body.templateId);assert(variant);sample.siteHtml=variant.html;sample.siteTemplateId=variant.id;}
      else throw new Error('Unexpected action: '+body.action);
      json={lead:sample};
    }
    await route.fulfill({json});
  });
  await page.setViewportSize({width:393,height:852});await page.goto(base+'/forge-caller.html');
  await page.locator('#menu-btn').click();await page.locator('.queue-item').click();
  await page.getByRole('button',{name:'They answered — build the site now',exact:true}).click();
  await page.locator('[data-template="bold"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-template="bold"]')?.getAttribute('aria-pressed')==='true');
  assert.equal(sample.siteVariants.length,3);assert.equal(sample.siteTemplateId,'bold');checks++;
  await page.getByRole('button',{name:'Full screen ↗',exact:true}).click();
  const full=page.frameLocator('dialog iframe');await full.getByRole('button',{name:'Book a visit',exact:true}).click();
  assert.equal(await full.locator('#booking').evaluate(el=>el.open),true);checks++;
  await full.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'← Back to call',exact:true}).click();
  assert.equal(await page.locator('dialog').count(),0);checks++;
  await page.goto(base+'/forge-templates.html');await page.locator('#business-kind').selectOption('nails');
  await page.locator('#business-name').fill('My Nail Studio');await page.locator('[data-template="fresh"]').click();
  assert.match(await page.frameLocator('#preview').locator('.brand').textContent(),/My Nail Studio/);checks++;
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks++;
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download HTML',exact:true}).click()]);
  assert.match(download.suggestedFilename(),/my-nail-studio-fresh\.html/);checks++;
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:checks,browser:'Chromium',viewports:[393,1280],scope:'Template interactions and layout; gallery edits/download; mocked caller generation, selection and full-screen preview',errors}));
} finally {server.close();await browser.close();}
