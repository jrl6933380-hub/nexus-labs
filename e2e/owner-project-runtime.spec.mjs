import {test,expect} from '@playwright/test';
import {fixture,samplePage} from '../test/project-builder-fixture.mjs';
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
async function setup(page,{operator=false,embed=false}={}){
 const html=embed?samplePage.replace('<body','<!--nexus:embed=/tiktok-planner.html--><body'):samplePage;
 const f=fixture({initial:[{id:'b1',projectId:'p1',label:'Creekside Lawn',html,createdAt:1}]});
 const errors=[],calls=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/_vercel/insights/script.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
 await page.route('**/tiktok-planner.html',route=>route.fulfill({body:'<!doctype html><html><body><h1>Live planner</h1><button onclick="this.textContent=\'Working\'">Planner action</button></body></html>',contentType:'text/html'}));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());calls.push({path:url.pathname,method:request.method()});
  if(url.pathname==='/api/room-history'){
   const res=await f.request(request.method()==='POST'?request.postDataJSON():null,{method:request.method(),query:Object.fromEntries(url.searchParams)});
   if(res.data.workbench)res.data.workbench.operator=operator;
   return route.fulfill({status:res.code,json:res.data});
  }
  let data={};
  if(url.pathname==='/api/room-auth')data={username:'alice'};
  if(url.pathname==='/api/forge-brain')data={connected:true,provider:'test',plan:'unlimited'};
  if(url.pathname==='/api/room-conversation')data={turns:[]};
  if(url.pathname==='/api/nexus-auth')data={authenticated:true,owner:{id:'alice'}};
  if(url.pathname==='/api/chat')data={messages:[],threads:[]};
  if(url.pathname==='/api/nexus-messages')data={specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:[]};
  if(url.pathname==='/api/nexus-controls')data={preferences:{accent:'gold'}};
  await route.fulfill({json:data});
 });
 await page.goto('/forge.html?surface=workbench&view=chat&build=b1');
 await expect(page.locator('.projectbuilder')).not.toHaveClass(/pb-checking/);
 return {errors,calls};
}
test('owner opens saved HTML as a usable project without customer editor controls',async({page})=>{
 const f=await setup(page,{operator:true});
 const shell=page.locator('.projectbuilder');await expect(shell).toHaveClass(/pb-bare/);
 for(const selector of ['.pb-chat','.pb-dock','.pb-status','.pb-sheet','.pb-top>.pb-gold'])await expect(shell.locator(selector)).toBeHidden();
 await expect(shell).toHaveAttribute('data-mode','preview');
 const frame=page.frameLocator('.pb-canvas iframe');
 await frame.getByRole('button',{name:'Test button',exact:true}).click();await expect(frame.getByRole('button',{name:'Clicked'})).toBeVisible();
 await expect(page.locator('.pb-canvas iframe')).toHaveAttribute('sandbox','allow-scripts allow-forms');
 expect(await frame.locator('body').innerHTML()).not.toContain('nexusBuilder');
 const top=await shell.locator('.pb-top').boundingBox(),canvas=await shell.locator('.pb-canvas').boundingBox();
 expect(canvas.y).toBeGreaterThanOrEqual(top.y+top.height);expect(canvas.y+canvas.height).toBeGreaterThan(840);
 await shell.getByRole('button',{name:'Back to Projects',exact:true}).click();await expect(shell).toHaveCount(0);
 expect(f.calls.filter(c=>c.method!=='GET')).toEqual([]);expect(f.errors).toEqual([]);
});
test('customer keeps Publish, chat, builder modes, and the restricted sandbox',async({page})=>{
 const f=await setup(page);await expect(page.locator('.projectbuilder')).not.toHaveClass(/pb-bare/);
 await expect(page.getByRole('button',{name:'Publish',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Fine-tune',exact:true})).toBeVisible();
 await expect(page.locator('.pb-chat')).toBeVisible();
 await expect(page.locator('.pb-canvas iframe')).toHaveAttribute('sandbox','allow-scripts allow-forms');expect(f.errors).toEqual([]);
});
test('owner tool marker opens the live authenticated page',async({page})=>{
 const f=await setup(page,{operator:true,embed:true});
 await expect(page.locator('.pb-canvas iframe')).toHaveAttribute('src','/tiktok-planner.html');
 const frame=page.frameLocator('.pb-canvas iframe');await expect(frame.getByRole('heading',{name:'Live planner'})).toBeVisible();
 await frame.getByRole('button',{name:'Planner action'}).click();await expect(frame.getByRole('button',{name:'Working'})).toBeVisible();
 await expect(page.locator('.pb-chat')).toBeHidden();expect(f.errors).toEqual([]);
});
test('customer tool marker never grants a live same-origin embed',async({page})=>{
 await setup(page,{embed:true});const frame=page.locator('.pb-canvas iframe');
 expect(await frame.getAttribute('src')).toBeNull();await expect(frame).toHaveAttribute('sandbox','allow-scripts allow-forms');
 await expect(page.locator('.pb-dock')).toBeVisible();
});
