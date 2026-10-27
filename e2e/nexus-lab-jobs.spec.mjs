import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {labJobMemory} from '../test-support/labJobMemory.mjs';
import {createNexusLabJobs} from '../lib/nexusLabJobs.js';
import {createNexusLab} from '../lib/nexusLab.js';
import {workLabJobOnce} from '../lib/nexusLabWorker.js';
import {createNexusLabHandler} from '../api/nexus-lab.js';
const shell=readFileSync(new URL('../public/workspace.html',import.meta.url),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
async function setup(page){
 const command=labJobMemory(),owner={id:'test-owner'},store=createNexusLabJobs({command}),service=createNexusLab({command,env:{}}),control={auto:false,steps:[],tasks:[]};
 const kick=(owner,id)=>{const task=workLabJobOnce({owner,id,store,service,sleep:()=>control.auto?new Promise(r=>setTimeout(r,5)):new Promise(r=>control.steps.push(r))});control.tasks.push(task);task.catch(()=>{});};
 const handler=createNexusLabHandler({authenticate:async()=>owner,jobs:store,service,kick});
 await page.route('**/workspace.html',route=>route.fulfill({contentType:'text/html',body:shell}));
 await page.route('**/api/nexus-lab',async route=>{const request=route.request();let code=200;const res={setHeader(){return this;},status(status){code=status;return this;},json(body){this.body=body;return this;}};await handler({method:request.method(),headers:{...request.headers(),origin:'http://127.0.0.1:4173',host:'127.0.0.1:4173'},body:request.postDataJSON()},res);await route.fulfill({status:code,json:res.body});});
 const mount=()=>page.evaluate(async()=>{document.documentElement.classList.remove('workspace-loading');const {renderNexusLab}=await import('/nexus-lab.js');document.querySelector('.thread').replaceChildren(await renderNexusLab({go(){}}));});
 await page.goto('/workspace.html');await mount();return {store,owner,control,mount};
}
for(const width of [320,393,1000])test(`durable job survives reload, cancels, retries from a checkpoint, and opens a result at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:852});const {store,owner,control,mount}=await setup(page);
 try{
  await page.getByRole('button',{name:'Jobs',exact:true}).click();await page.getByRole('button',{name:'Run background check',exact:true}).click();await expect.poll(()=>control.steps.length).toBe(1);await page.getByRole('button',{name:'Refresh jobs'}).click();await expect(page.locator('.labjobstatus')).toHaveText('running');
  const id=(await store.list(owner))[0].id;control.steps.shift()();await expect.poll(async()=> (await store.get(owner,id)).checkpoint.completed).toBe(1);
  await page.reload();await mount();await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible();await page.getByRole('button',{name:'Refresh jobs'}).click();await expect(page.locator('.labjobstatus')).toHaveText('running');await expect(page.locator('.labjobs')).toContainText('Checkpoint 1 of 15');
  await page.getByRole('button',{name:'Cancel job'}).click();await expect(page.locator('.labjobstatus')).toHaveText('canceled');for(const resolve of control.steps.splice(0))resolve();await Promise.allSettled(control.tasks);expect((await store.get(owner,id)).status).toBe('canceled');
  control.auto=true;await page.getByRole('button',{name:'Retry job'}).click();await expect.poll(async()=> (await store.get(owner,id)).status).toBe('succeeded');await page.getByRole('button',{name:'Refresh jobs'}).click();await expect(page.locator('.labjobstatus')).toHaveText('succeeded');expect((await store.get(owner,id)).attempts).toBe(2);expect((await store.get(owner,id)).checkpoint.completed).toBe(15);
  await page.getByRole('button',{name:'Back to workspace'}).click();await page.getByRole('button',{name:/Available Rank/}).click();await page.getByLabel('Brief / matching criteria').fill('shoe');await page.getByLabel('Candidates').fill('shoe\ndress');await page.getByRole('button',{name:'Run in background'}).click();await expect.poll(async()=> (await store.list(owner)).find(j=>j.kind==='run')?.status).toBe('succeeded');await page.getByRole('button',{name:'Refresh jobs'}).click();await page.getByRole('button',{name:'Open result'}).click();await expect(page.locator('.labresults')).toContainText('shoe');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{control.auto=true;for(const resolve of control.steps.splice(0))resolve();await Promise.allSettled(control.tasks);}
});
