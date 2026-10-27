import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createNexusLab} from '../lib/nexusLab.js';
import {createNexusLabHandler} from '../api/nexus-lab.js';
const shell=readFileSync(new URL('../public/workspace.html',import.meta.url),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
async function setup(page,customer=false){
 const runs=[];const command=async([op,key,...args])=>{if(op==='LRANGE')return runs.slice(0,40);if(op==='LPUSH')return runs.unshift(args[0]);if(op==='LTRIM'){runs.splice(40);return 'OK';}throw Error(op);};
 const handler=createNexusLabHandler({authenticate:async()=>({id:'test-owner'}),service:createNexusLab({command,env:{},catalog:async()=>[{id:'tool:calendar',name:'Calendar search',text:'Find calendar events',source:'Installed tool'}]})});
 await page.route('**/workspace.html',r=>r.fulfill({contentType:'text/html',body:shell}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/nexus-lab'){
   const headers=route.request().headers();const req={method:route.request().method(),headers:{...headers,host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173'},body:route.request().postDataJSON()};let code=200;const res={setHeader(){return this;},status(value){code=value;return this;},json(body){this.body=body;return this;}};await handler(req,res);return route.fulfill({status:code,json:res.body});
  }
  return route.fulfill({json:path==='/api/nexus-messages'?{specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:[]}:path==='/api/room-history'?{projects:[],workbench:{count:0,limit:null}}:{items:[],pulses:[]}});
 });
 await page.goto('/workspace.html');
 await page.evaluate(async customer=>{document.documentElement.classList.remove('workspace-loading');document.body.dataset.view='messages';const host=document.querySelector('.thread');const {renderMessages}=await import('/nexus-messages.js');const {renderNexusLab}=await import('/nexus-lab.js');window.labCtx={customer,recentThreads:()=>[],async go(view){window.destination=view;host.replaceChildren(view==='lab'?await renderNexusLab(window.labCtx):await renderMessages(window.labCtx));},openConversation(){}};host.replaceChildren(await renderMessages(window.labCtx));},customer);
}
for(const width of [320,393,1000])test(`owner Home → Lab → run → history → Home at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:852});await setup(page);
 await page.getByRole('button',{name:/Nexus Lab Seven capability/}).click();
 await expect(page.getByRole('heading',{name:'Nexus Lab',exact:true})).toBeVisible();await expect(page.locator('.labtile')).toHaveCount(7);
 await page.getByRole('button',{name:/Available Search/}).click();await page.getByLabel('Search your installed').fill('calendar');await page.getByRole('button',{name:'Run',exact:true}).click();await expect(page.getByRole('heading',{name:'Calendar search'})).toBeVisible();await expect(page.locator('.labresults')).toContainText('token-coverage-v1');
 await page.getByRole('button',{name:'All capabilities'}).click();await page.getByRole('button',{name:/Available Rank/}).click();await page.getByLabel('Brief / matching criteria').fill('gold shoes');await page.getByLabel('Candidates').fill('blue dress\ngold shoes');await page.getByRole('button',{name:'Run',exact:true}).click();await expect(page.locator('.labresult').first()).toContainText('gold shoes');
 await page.getByRole('button',{name:'All capabilities'}).click();await page.getByRole('button',{name:/Available Predict/}).click();await page.getByLabel('Equally spaced observations').fill('2,4,6,8,10,12,14,16');await page.getByRole('button',{name:'Run',exact:true}).click();await expect(page.locator('.labmetric')).toHaveText('18.00');await expect(page.locator('.labresults svg')).toBeVisible();
 await page.getByRole('button',{name:'All capabilities'}).click();await page.getByRole('button',{name:/Needs connection Cutout/}).click();await expect(page.getByRole('heading',{name:'What this workspace needs'})).toBeVisible();await expect(page.getByRole('button',{name:'Run',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:'← Owner Home'}).click();await page.getByRole('button',{name:/Nexus Lab Seven capability/}).click();await expect(page.getByRole('heading',{name:'Cutout',exact:true})).toBeVisible();await page.getByRole('button',{name:'All capabilities'}).click();await expect(page.locator('.labhistory button')).toHaveCount(3);
 await page.screenshot({path:`/tmp/nexus-lab-${width}.png`,fullPage:true});
});
test('customer Home does not advertise the owner Lab',async({page})=>{await setup(page,true);await expect(page.getByRole('button',{name:/Nexus Lab/})).toHaveCount(0);});
