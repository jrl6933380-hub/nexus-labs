import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function routes(page,{authenticated=true,offline=false}={}){
 const calls=[];
 await page.route('**/api/ally-ad-review?action=list',async route=>{
  calls.push('reviews');
  if(!authenticated)return route.fulfill({status:403,json:{error:'Owner only.'}});
  return route.fulfill(offline?{status:503,json:{error:'Offline'}}:{json:{reviews:[
   {id:'a'.repeat(32),status:'pending_review'},
   {id:'b'.repeat(32),status:'approved',board_status:'saved'},
   {id:'c'.repeat(32),status:'approved',board_status:'queued'},
   {id:'d'.repeat(32),status:'rejected',revision_status:'processing'}
  ]}});
 });
 await page.route('**/api/ally',async route=>{
  calls.push('ally:'+route.request().postDataJSON()?.action);
  return route.fulfill({json:{paired:true,active:true,label:'ROG Ally'}});
 });
 return calls;
}
for(const [label,size] of [['phone',{width:393,height:852}],['narrow-phone',{width:320,height:680}],['desktop',{width:1440,height:900}]]){
 test('owner macro dashboard works for '+label,async({page})=>{
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.setViewportSize(size);const calls=await routes(page);
  await page.goto('/nexus-macro-controller.html');
  await expect(page.getByRole('heading',{name:'Macros, explained like a friend.'})).toBeVisible();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#macros .macro')).toHaveCount(9);
  await expect(page.locator('#progress')).toContainText('Waiting for your review');
  await expect(page.locator('#ally-state')).toContainText('Ally connected');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(calls).toContain('ally:status');
  const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;
  expect(violations).toEqual([]);
  await page.getByRole('button',{name:/Save to boards/}).click();
  await expect(page.locator('#macros .macro')).toHaveCount(2);
  await expect(page.getByRole('heading',{name:'Put any video on my board'})).toBeVisible();
  const card=page.locator('#macro-video-to-board');
  await card.getByRole('button',{name:'Explain this to me'}).click();
  await expect(card.locator('details.instructions')).toHaveAttribute('open','');
  await expect(card.getByText('Pick a video from Downloads and choose the Nexus board.')).toBeVisible();
  await expect(card.getByRole('link',{name:'Open Nexus Board'})).toHaveAttribute('href','/board.html');
  await page.getByRole('button',{name:'Show all'}).click();
  await page.getByRole('searchbox',{name:'Search macros'}).fill('fix an ad');
  await expect(page.locator('#macros .macro')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Fix an ad I don’t like'})).toBeVisible();
  expect(errs).toEqual([]);
 });
}
test('unauthorized visitors never see owner cards or job information',async({page})=>{
 const calls=await routes(page,{authenticated:false});
 await page.goto('/nexus-macro-controller.html');
 await expect(page.locator('#gate')).toContainText('for the signed-in Nexus owner');
 await expect(page.locator('#app')).toBeHidden();
 await expect(page.locator('#macros .macro')).toHaveCount(0);
 expect(calls).not.toContain('ally:status');
});
test('queue read errors show retry instead of false zero counts',async({page})=>{
 await routes(page,{offline:true});
 await page.goto('/nexus-macro-controller.html');
 await expect(page.locator('#app')).toBeHidden();
 await expect(page.locator('#gate')).toContainText('No status information was loaded.');
 await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
});
