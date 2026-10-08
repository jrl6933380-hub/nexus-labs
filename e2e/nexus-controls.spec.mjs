import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
test('mobile controls save preferences, restore color, refresh usage and retain last data on error',async({page})=>{
  let preferences={accent:'gold',responseStyle:'balanced'},turns=3,unavailable=false;const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/_vercel/insights/script.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data={items:[]};
    if(path==='/api/nexus-auth')data={authenticated:true,owner:{id:'justin'}};
    if(path==='/api/chat')data={threads:[],messages:[]};
    if(path==='/api/nexus-messages')data={specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:[]};
    if(path==='/api/nexus-controls'){
      if(unavailable)return route.fulfill({status:503,json:{error:'Controls unavailable'}});
      if(route.request().method()==='POST')preferences={...preferences,...route.request().postDataJSON()};
      data={account:{id:'justin',plan:'Owner',exempt:true},preferences,usage:{updatedAt:Date.now(),scope:'Completed Nex and specialist turns since usage tracking was enabled',days:[{turns,input:100,output:20,elapsedMs:5000}]}};
    }
    await route.fulfill({json:data});
  });
  const open=async()=>{await page.getByRole('button',{name:/More Customize Messages/u}).click();await page.getByRole('button',{name:/Account & Controls Settings and live usage/u}).click();await expect(page.getByText('Signed in as justin')).toBeVisible();};
  await page.goto('/workspace.html');await open();
  await page.getByRole('button',{name:/Reply preferences Reply length/u}).click();
  await page.getByLabel('Reply length',{exact:true}).selectOption('concise');await page.getByLabel('Accent color',{exact:true}).selectOption('blue');
  await page.getByRole('button',{name:'Save preferences'}).click();await expect(page.getByText(/Saved. Your next replies/u)).toBeVisible();
  await page.reload();await open();expect(preferences.responseStyle).toBe('concise');
  expect(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--nexus-control-accent'))).toBe('#74a7ff');
  await page.getByRole('button',{name:/Usage & limits Live activity/u}).click();await expect(page.getByText(/3 completed turns today/u)).toBeVisible();
  turns=4;await page.getByRole('button',{name:'Refresh now'}).click();await expect(page.getByText(/4 completed turns today/u)).toBeVisible();
  unavailable=true;await page.getByRole('button',{name:'Refresh now'}).click();await expect(page.getByText(/Showing the last loaded usage/u)).toBeVisible();await expect(page.getByText(/4 completed turns today/u)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const accessibility=await new AxeBuilder({page}).include('.nexusmessages').withTags(['wcag2a','wcag2aa']).analyze();expect(accessibility.violations.filter(item=>['serious','critical'].includes(item.impact))).toEqual([]);
  await page.screenshot({path:'test-results/nexus-controls-mobile.png',fullPage:true});expect(errors).toEqual([]);
});
