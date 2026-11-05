import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const candidate={candidate_id:'a'.repeat(32),name:'TEST Example Barber',location:'Des Moines, Iowa',status:'needs_checking',notes:'Verify this fictional test business.',
 checked_at:'2026-11-05T10:00:00Z',source_urls:['https://example.com/contact'],map_url:'https://www.google.com/maps/search/?api=1&query=TEST',phone_suggestion:'5155550199',phone_source_url:'https://example.com/contact'};
const batch={batch_id:'research-'+'b'.repeat(32),business:'barbers',city:'Des Moines, Iowa',created_at:'2026-11-05T10:00:00Z',candidates:[candidate]};
const url=value=>'/forge-research-review.html#batch='+Buffer.from(JSON.stringify(value)).toString('base64url');
for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
 test('review requires verification, preserves retry identity, shows saved receipt '+viewport.width,async({page})=>{
  await page.setViewportSize(viewport);const requests=[];let failOnce=true;
  await page.route('**/api/forge-research',async route=>{
   if(route.request().method()==='GET')return route.fulfill({json:{ready:true}});
   requests.push(route.request().postDataJSON());
   if(failOnce){failOnce=false;return route.fulfill({status:503,json:{error:'Temporary failure. Retry the same request.'}});}
   return route.fulfill({json:{created_count:1,duplicate_count:0,results:[{candidate_id:candidate.candidate_id,status:'created',lead_id:'test-lead'}]}});
  });
  await page.goto(url(batch));await expect(page.getByLabel('Select TEST Example Barber')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');await expect(page.getByRole('button',{name:'Approve and add to Forge'})).toBeDisabled();
  expect(requests.length).toBe(0);await page.getByLabel('Select TEST Example Barber').check();
  await page.getByRole('button',{name:'Approve and add to Forge'}).click();await expect(page.locator('#message')).toContainText('Verify business identity');expect(requests.length).toBe(0);
  await page.getByLabel('Website check',{exact:true}).selectOption('social_booking_only');
  await page.getByLabel('I checked that the sources refer to this business and location.').check();
  await page.getByLabel('I verified this phone number at the linked source.').check();
  await page.getByLabel('I reviewed the website search and selected the correct status.').check();
  await page.getByRole('button',{name:'Approve and add to Forge'}).click();await expect(page.locator('#message')).toContainText('Temporary failure');
  await page.getByRole('button',{name:'Approve and add to Forge'}).click();await expect(page.getByRole('heading',{name:'Import saved'})).toBeVisible();
  expect(requests[0]).toEqual(requests[1]);expect(requests[0].candidates[0].phone_confirmed).toBe(true);
  await expect(page.getByRole('link',{name:'Open caller queue'})).toBeVisible();
  await page.screenshot({path:'test-results/forge-research-'+viewport.width+'.png',fullPage:true});
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right}))}));
  expect(overflow.scroll,JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact));expect(violations).toEqual([]);
  await page.screenshot({path:'test-results/forge-research-'+viewport.width+'.png',fullPage:true});
 });
}
test('unauthorized view is gated; untrusted text cannot inject markup; duplicates are disabled',async({page})=>{
 await page.route('**/api/forge-research',route=>route.fulfill({status:403,json:{error:'Owner only'}}));
 await page.goto(url(batch));await expect(page.locator('#review')).toBeHidden();await expect(page.getByRole('link',{name:'Open owner sign-in'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Open owner sign-in'})).toHaveAttribute('href','/nexus-login.html?next=%2Fforge-research-review.html');
 await page.unroute('**/api/forge-research');await page.route('**/api/forge-research',route=>route.fulfill({json:{ready:true}}));
 await page.goto(url({...batch,candidates:[{...candidate,name:'<img src=x onerror=alert(1)>',duplicate:true}]}));
 await expect(page.getByText('<img src=x onerror=alert(1)>',{exact:false})).toBeVisible();await expect(page.locator('#candidates img')).toHaveCount(0);
 await expect(page.locator('#candidates input[type=checkbox]')).toBeDisabled();
});
