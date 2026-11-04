import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function setup(page){
 const created=[],jobs=[];
 await page.route('**/api/ally-ad-review?action=list',route=>route.fulfill({json:{reviews:[]}}));
 await page.route('**/api/ally',route=>route.fulfill({json:{paired:true,active:true,label:'ROG Ally'}}));
 await page.route('**/api/macro-jobs',async route=>{
  const req=route.request();
  if(req.method()==='GET')return route.fulfill({json:{jobs}});
  const data=req.postDataJSON();
  if(data.action==='create'){
   created.push(data.input);
   const job={id:'a'.repeat(32),title:data.input.title,brief:data.input.brief,status:'queued',
     stage:'waiting_for_ally',cancel_requested:false};
   jobs.unshift(job);return route.fulfill({json:{job}});
  }
  if(data.action==='cancel'){
   const job=jobs.find(x=>x.id===data.input.id);
   job.status='canceled';job.stage='canceled';
   return route.fulfill({json:{job}});
  }
  return route.fulfill({status:400,json:{error:'Not a supported action'}});
 });
 return {created,jobs};
}
for(const [name,size] of [['phone',{width:393,height:852}],['narrow-phone',{width:320,height:680}],['desktop',{width:1440,height:900}]]){
 test('owner can submit an explicitly approved private ad job on '+name,async({page})=>{
  await page.setViewportSize(size);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {created}=await setup(page);
  await page.goto('/nexus-macro-controller.html');
  await expect(page.getByRole('heading',{name:'Send Qwen an ad job'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Make the ad and send it for review'})).toBeVisible();
  await page.getByRole('textbox',{name:'What are you advertising?'}).fill('Lopez Barber Shop');
  await page.getByRole('textbox',{name:'What should the ad say?'}).fill('Show fresh cuts and invite people to book an appointment.');
  await page.getByRole('checkbox',{name:/I approve Qwen using my Ally/}).check();
  await page.getByRole('button',{name:'Make the ad and send it for review'}).click();
  await expect(page.getByRole('heading',{name:'Lopez Barber Shop'})).toBeVisible();
  await expect(page.locator('#jobs')).toContainText('Waiting for your Ally');
  expect(created).toHaveLength(1);
  expect(created[0].render_approved).toBe(true);
  expect(created[0].request_id).toMatch(/^[a-zA-Z0-9_-]{8,80}$/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;
  expect(violations).toEqual([]);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Cancel job'}).click();
  await expect(page.locator('#jobs')).toContainText('Canceled');
  expect(errors).toEqual([]);
 });
}
test('ad submit cannot proceed without explicit private render consent',async({page})=>{
 const {created}=await setup(page);
 await page.goto('/nexus-macro-controller.html');
 await page.getByRole('textbox',{name:'What are you advertising?'}).fill('Barbershop');
 await page.getByRole('textbox',{name:'What should the ad say?'}).fill('Friendly barbers who welcome walk-ins and appointments.');
 await page.getByRole('button',{name:'Make the ad and send it for review'}).click();
 expect(created).toHaveLength(0);
 await expect(page.getByRole('checkbox',{name:/I approve Qwen using my Ally/})).not.toBeChecked();
});
