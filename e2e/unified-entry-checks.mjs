import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export function registerUnifiedEntryChecks(){
test.describe('unified entry',()=>{
test.use({viewport:{width:393,height:852}});
async function entry(page, {owner=false,customer=false,error=false}={}) {
  const posts=[];
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='POST')posts.push({path,...request.postDataJSON()});
    if(path==='/api/social-auth')return route.fulfill({json:{google:true,apple:true}});
    if(path==='/api/nexus-auth'||path==='/api/room-auth') {
      const signedIn=path==='/api/nexus-auth'?owner:customer;
      if(request.method()==='GET')return route.fulfill({status:signedIn?200:401,json:{authenticated:signedIn,username:signedIn?'tester':null}});
      return route.fulfill({status:error?401:200,json:error?{error:'Wrong password.'}:{authenticated:true,username:'tester',operator:true}});
    }
    return route.fulfill({json:{}});
  });
  for(const destination of ['forge.html','workspace.html'])await page.route(`**/${destination}*`,route=>route.fulfill({contentType:'text/html',body:'<h1>Workspace opened</h1>'}));
  return posts;
}

test('one public page remains stable and offers customer and owner access',async({page})=>{
  await entry(page); const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.locator('h1')).toContainText('Your everyday life.');
  await expect(page).toHaveURL(/\/$/);await page.locator('#open-signin').click();
  await expect(page.locator('#login-form')).toBeVisible();await page.locator('#owner-access').click();
  await expect(page.locator('#owner-form')).toBeVisible();await expect(page.locator('#login-form')).toBeHidden();
  await expect(page.getByText('Four-digit Nexus code')).toHaveCount(0);
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'/tmp/nexus-entry-mobile.png',fullPage:true});
});

test('customer password login goes directly to the existing customer workspace',async({page})=>{
  const posts=await entry(page);await page.goto('/index.html?next=%2Fworkspace.html');
  await page.locator('#open-signin').click();await page.locator('#login-username').fill('customer@example.com');
  await page.locator('#login-password').fill('customer-password');await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/forge.html\?view=chat$/);
  expect(posts).toEqual([{path:'/api/room-auth',action:'login',username:'customer@example.com',password:'customer-password'}]);
});

test('new customers can create an account without a PIN or provider setup',async({page})=>{
  const posts=await entry(page);await page.goto('/');await page.locator('#open-signin').click();await page.locator('#tab-signup').click();
  await page.locator('#signup-name').fill('New customer');await page.locator('#signup-email').fill('new@example.com');await page.locator('#signup-password').fill('customer-password');
  await page.locator('#signup-submit').click();await expect(page).toHaveURL(/\/forge.html\?view=chat$/);
  expect(posts).toEqual([{path:'/api/room-auth',action:'simple-signup',name:'New customer',email:'new@example.com',password:'customer-password'}]);
});

test('old owner PIN links now use the owner password and preserve the destination',async({page})=>{
  const posts=await entry(page);await page.goto('/nexus-login.html?pin-setup=1&next=%2Fworkspace.html%3Fview%3Dcalendar');
  await expect(page).toHaveURL(/\/index.html\?.*mode=owner/);await page.locator('#owner-password').fill('existing-owner-password');
  await page.locator('#owner-submit').click();await expect(page).toHaveURL(/\/workspace.html\?view=calendar$/);
  expect(posts).toEqual([{path:'/api/nexus-auth',action:'login',password:'existing-owner-password'}]);
});

for(const owner of [true,false])test(`saved ${owner?'owner':'customer'} session requires one Continue click`,async({page})=>{
  await entry(page,{owner,customer:!owner});await page.goto('/index.html');
  await expect(page.locator('#open-signin')).toHaveText('Continue to Nexus →');await expect(page).toHaveURL(/\/index.html$/);
  await page.locator('#open-signin').click();await expect(page).toHaveURL(owner?/\/workspace.html\?view=messages$/:/\/forge.html\?view=chat$/);
});

test('owner sign-in failure stays on the page and allows retry',async({page})=>{
  await entry(page,{error:true});await page.goto('/index.html?mode=owner');await page.locator('#owner-password').fill('wrong-owner-password');await page.locator('#owner-submit').click();
  await expect(page.locator('#owner-error')).toHaveText('Wrong password.');await expect(page.locator('#owner-submit')).toBeEnabled();await expect(page).toHaveURL(/mode=owner/);
});

test('setup links still work and remove the ticket from browser history',async({page})=>{
  const posts=await entry(page);await page.goto('/nexus-login.html?setup=one-time-ticket&next=https%3A%2F%2Foutside.test');
  await expect(page).toHaveURL(/\/index.html\?mode=owner$/);await expect(page.locator('#owner-confirm')).toBeVisible();
  await page.locator('#owner-password').fill('new-owner-password');await page.locator('#owner-confirm').fill('new-owner-password');await page.locator('#owner-submit').click();
  await expect(page).toHaveURL(/\/workspace.html\?view=messages$/);expect(posts[0]).toEqual({path:'/api/nexus-auth',action:'setup',password:'new-owner-password',ticket:'one-time-ticket'});
});

test('old customer links and social callbacks return to the same entry',async({page})=>{
  await entry(page);await page.goto('/room-login.html?next=%2Fusage.html');await expect(page).toHaveURL(/\/index.html\?next=%2Fusage.html$/);
  await page.goto('/index.html?social=complete&next=https%3A%2F%2Foutside.test');await expect(page).toHaveURL(/\/forge.html\?view=chat$/);
});

test('mobile entry and both sign-in forms have no serious accessibility violations',async({page})=>{
  await entry(page);await page.goto('/index.html');
  for(const state of ['landing','customer','owner']){
    if(state==='customer')await page.locator('#open-signin').click();if(state==='owner')await page.locator('#owner-access').click();
    const result=await new AxeBuilder({page}).analyze();expect(result.violations.filter(v=>['serious','critical'].includes(v.impact)),state).toEqual([]);
  }
});

test('switching accounts signs out both sessions before reopening entry',async({page})=>{
  const posts=await entry(page,{owner:true,customer:true});await page.goto('/index.html');await expect(page.locator('#choose-signin')).toHaveText('Use another account');
  await page.locator('#choose-signin').click();await expect.poll(()=>posts.length).toBe(2);
  expect(posts.map(p=>p.path).sort()).toEqual(['/api/nexus-auth','/api/room-auth']);expect(posts.every(p=>p.action==='logout')).toBeTruthy();
});

test('failed account switch displays an error instead of pretending sign-out worked',async({page})=>{
  await entry(page,{owner:true,error:true});await page.goto('/index.html');await expect(page.locator('#choose-signin')).toHaveText('Use another account');await page.locator('#choose-signin').click();
  await expect(page.locator('#login-error')).toHaveText('Could not sign out. Please try again.');await expect(page).toHaveURL(/\/index.html$/);
});

test('API outages leave sign-in accessible and network failure allows retry',async({page})=>{
  await entry(page);await page.route('**/api/*auth',route=>route.abort('failed'));await page.goto('/index.html');await page.locator('#open-signin').click();
  await page.locator('#login-username').fill('tester');await page.locator('#login-password').fill('password');await page.locator('#login-submit').click();
  await expect(page.locator('#login-error')).toHaveText('Could not reach the server.');await expect(page.locator('#login-submit')).toBeEnabled();
});

test('desktop landing keeps forms on the same page without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await entry(page);await page.goto('/index.html');await expect(page.locator('#login-form')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'/tmp/nexus-entry-desktop.png',fullPage:true});
});

});
}
