import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {publicCatalog} from '../lib/actorCatalog.js';
import fs from 'node:fs/promises';
const actors=publicCatalog(),wallet='fixture_wallet_1234567890';
async function setup(page,{failCatalog=false,hasWallet=false}={}){
 const calls=[];let catalogFails=failCatalog;
 if(hasWallet)await page.addInitScript(key=>localStorage.setItem('wallet','/research.html?k='+key),wallet);
 await page.route('**/api/actor-credits',async route=>{const b=route.request().postDataJSON();calls.push(b);
  if(b.action==='catalog')return route.fulfill(catalogFails?{status:503,json:{error:'Fixture offline'}}:{json:{data:{actors}}});
  if(b.action==='balance')return route.fulfill({json:{data:{credits:16}}});
  if(b.action==='checkout')return route.fulfill({status:503,json:{error:'Checkout is unavailable in this test.'}});
  throw Error('Unexpected request '+b.action);
 });
 return {calls,recover(){catalogFails=false;}};
}
for(const [name,viewport,colorScheme] of [['desktop',{width:1440,height:1000},'light'],['phone',{width:393,height:852},'light'],['narrow-dark',{width:320,height:852},'dark'],['desktop-dark',{width:1280,height:900},'dark']]){
 test(`storefront discovery, filters, search and reflow: ${name}`,async({page})=>{
  await page.setViewportSize(viewport);await page.emulateMedia({colorScheme,reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));const {calls}=await setup(page);
  await page.goto('/marketplace.html');await expect(page.locator('#grid .card')).toHaveCount(actors.length);
  await expect(page.getByRole('heading',{name:'Small tools. Useful work.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations).toEqual([]);
  await fs.mkdir('test-results/marketplace',{recursive:true});await page.screenshot({path:`test-results/marketplace/${name}.png`,fullPage:true});
  await page.getByRole('button',{name:'Marketing',exact:true}).click();await expect(page.locator('#grid .card')).toHaveCount(2);await expect(page.getByRole('button',{name:'Marketing',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'All actors',exact:true}).click();await page.getByRole('searchbox',{name:'Search actors'}).fill('spreadsheet');await expect(page.locator('#grid .card')).toHaveCount(1);await expect(page.locator('#grid')).toContainText('Documents to Spreadsheet');
  await page.getByRole('searchbox',{name:'Search actors'}).fill('no-such-task-fixture');await expect(page.getByRole('heading',{name:'No actors match that search.'})).toBeVisible();await page.getByRole('button',{name:'Show all actors'}).click();await expect(page.locator('#grid .card')).toHaveCount(actors.length);
  await expect(page.getByRole('link',{name:'See a sample report'})).toHaveAttribute('href','/research.html?sample=1');
  expect((await page.locator('#wallet').boundingBox()).y).toBeGreaterThan((await page.locator('#catalog').boundingBox()).y+(await page.locator('#catalog').boundingBox()).height-1);
  expect(await page.locator('#grid .card').first().evaluate(el=>el.getBoundingClientRect().top+scrollY)).toBeLessThan(viewport.width<760?680:650);
  expect((await page.locator('#examples').boundingBox()).y).toBeGreaterThan((await page.locator('#how-it-works').boundingBox()).y);
  await expect(page.locator('#wallet-details')).not.toHaveAttribute('open','');
  await page.getByRole('link',{name:'View examples',exact:true}).click();await expect(page.locator('#examples-title')).toBeInViewport();
  await expect(page.getByRole('link',{name:'Buy credits',exact:true})).toBeInViewport();
  await page.getByRole('link',{name:'Buy credits'}).click();await expect(page.locator('#wallet-title')).toBeInViewport();
  expect(calls.every(c=>c.action==='catalog')).toBe(true);expect(errors).toEqual([]);
 });
}
test('wallet keys survive discovery, sample navigation and checkout errors',async({page})=>{
 const {calls}=await setup(page,{hasWallet:true});await page.goto('/marketplace.html');await expect(page.locator('#bal')).toHaveText('16 credits');
 await page.locator('#wallet-details summary').click();await expect(page.getByRole('textbox',{name:'Your private wallet link'})).toBeVisible();
 for(const a of actors){const card=page.locator('.card').filter({has:page.getByRole('heading',{name:a.name,exact:true})});await expect(card.getByRole('link',{name:'Open',exact:true})).toHaveAttribute('href',new RegExp('[?&]k='+wallet));}
 await expect(page.getByRole('link',{name:'See a sample report'})).toHaveAttribute('href','/research.html?sample=1&k='+wallet);
 await page.locator('[data-pack="p5"]').click();await expect(page.locator('#msg')).toHaveText('Checkout is unavailable in this test.');await expect(page.locator('[data-pack="p5"]')).toBeEnabled();expect(calls.find(c=>c.action==='checkout')).toEqual({action:'checkout',pack:'p5',from:'market',key:wallet});
});
test('catalog errors show retry without inventing live tools',async({page})=>{
 const state=await setup(page,{failCatalog:true,hasWallet:true});await page.goto('/marketplace.html');await expect(page.getByRole('heading',{name:'We couldn’t load the actors.'})).toBeVisible();await expect(page.locator('#grid .card')).toHaveCount(0);await expect(page.locator('#bal')).toHaveText('16 credits');await expect(page.locator('#empty-state')).toBeHidden();state.recover();await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.locator('#grid .card')).toHaveCount(actors.length);await expect(page.locator('#catalog-error')).toBeHidden();
});

// The bio hub reads the same public catalog without touching wallets or launching jobs.
test('bio hub discovers new catalog tools, pauses motion and opens the marketplace',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});
 const requests=[];const names=[...actors,{id:'new-fixture-tool',name:'A newly published tool'}];
 await page.route('**/api/actor-credits',async route=>{const body=route.request().postDataJSON();requests.push(body);await route.fulfill({json:{data:{actors:names}}});});
 await page.goto('/start.html');await expect(page.locator('#tool-names li')).toHaveCount(names.length);
 await expect(page.locator('#tool-names')).toContainText('A newly published tool');
 await expect(page.getByRole('heading',{name:'Explore AI tools',exact:true})).toBeVisible();
 await expect(page.locator('.tools')).toContainText('Find the tool you saw in our videos');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('.tools .action')).toBeInViewport();
 const pause=page.getByRole('button',{name:'Pause scrolling',exact:true});await pause.click();
 await expect(page.getByRole('button',{name:'Resume scrolling',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await page.locator('#tool-track').evaluate(e=>getComputedStyle(e).animationPlayState)).toBe('paused');
 await page.getByRole('button',{name:'Resume scrolling',exact:true}).click();await expect(pause).toHaveAttribute('aria-pressed','false');
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(audit.violations).toEqual([]);
 expect(requests).toEqual([{action:'catalog'}]);
 await page.getByRole('link',{name:'Find your tool',exact:true}).click();await expect(page).toHaveURL(/\/marketplace\.html$/);
 await expect(page.getByRole('searchbox',{name:'Search actors'})).toBeVisible();
});
test('bio hub reduced motion keeps a stationary list and responds to preference changes',async({page})=>{
 await page.setViewportSize({width:320,height:700});await page.emulateMedia({reducedMotion:'reduce'});await setup(page);
 await page.goto('/start.html');await expect(page.locator('#tool-names li')).toHaveCount(actors.length);
 await expect(page.locator('#motion-toggle')).toBeHidden();
 expect(await page.locator('#tool-track').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.emulateMedia({reducedMotion:'no-preference'});await expect(page.getByRole('button',{name:'Pause scrolling'})).toBeVisible();
});
test('bio hub keeps working if discovery fails and renders catalog names as text',async({page})=>{
 await page.route('**/api/actor-credits',route=>route.fulfill({status:503,json:{error:'Offline fixture'}}));
 await page.goto('/start.html');await expect(page.locator('#tool-names')).toContainText('Competitor Research');
 await expect(page.getByRole('link',{name:'Find your tool',exact:true})).toHaveAttribute('href','/marketplace.html');
 await page.unroute('**/api/actor-credits');
 await page.route('**/api/actor-credits',route=>route.fulfill({json:{data:{actors:[{name:'<img src=x onerror=alert(1)>'},{name:'<img src=x onerror=alert(1)>'},{name:null}]}}}));
 await page.reload();await expect(page.locator('#tool-names li')).toHaveCount(1);
 await expect(page.locator('#tool-names')).toHaveText('<img src=x onerror=alert(1)>');await expect(page.locator('#tool-track img')).toHaveCount(0);
 await expect(page.locator('#motion-toggle')).toBeHidden();
});
