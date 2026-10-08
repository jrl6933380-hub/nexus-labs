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

test('composer plus menu opens one Settings entry and More bundles related spaces',async({page})=>{
  const chatWrites=[];
  await page.route('**/_vercel/insights/script.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data={items:[]};
    if(path==='/api/nexus-auth')data={authenticated:true,owner:{id:'justin'}};
    if(path==='/api/chat'){data={threads:[],messages:[]};if(route.request().method()==='POST')chatWrites.push(route.request().postDataJSON());}
    if(path==='/api/nexus-messages')data={specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:['planner','reminders','life','workbench','story','deck','approvals','memory','pod','skills','agents']};
    if(path==='/api/nexus-controls')data={account:{id:'justin',plan:'Owner'},preferences:{accent:'gold',responseStyle:'balanced'},usage:{updatedAt:Date.now(),scope:'Completed turns',days:[{turns:0,input:0,output:0,elapsedMs:0}]}};
    if(path==='/api/owner-capabilities')data={tools:[],skills:[],commands:[]};
    await route.fulfill({json:data});
  });
  await page.goto('/workspace.html');
  await expect(page.locator('.messagelist').getByRole('button',{name:/Life & Schedule/})).toHaveCount(1);
  await expect(page.locator('.messagelist').getByRole('button',{name:/Memory|Pod Room|Capabilities|AI Team/})).toHaveCount(0);
  await page.locator('#composerPlus').click();
  const menu=page.getByRole('menu',{name:'Nexus shortcuts'});await expect(menu).toBeVisible();await expect(menu.getByRole('menuitem')).toHaveCount(4);
  await expect(menu.getByRole('menuitem',{name:'Settings',exact:true})).toHaveCount(1);
  const bounds=await menu.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(393);
  await menu.getByRole('menuitem',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{name:'Account & Controls'})).toBeVisible();await expect(menu).toBeHidden();
  await page.getByRole('button',{name:/Capabilities Tools, skills, and commands/}).click();await expect(page.getByRole('heading',{name:'Capabilities'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Tools Owner controls/})).toBeVisible();
  await page.locator('#composerPlus').click();await menu.getByRole('menuitem',{name:'Operations',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Operations'})).toBeVisible();
  for(const name of ['Command Deck','Approvals','Forge'])await expect(page.locator('.nexusmessages').getByRole('button',{name:new RegExp(`${name} Operations`)})).toBeVisible();
  await page.locator('.messageback').click();await expect(page.locator('.pinmanagerrow')).toHaveCount(3);
  expect(chatWrites).toEqual([]);
  await page.locator('#composerPlus').focus();await page.keyboard.press('ArrowDown');await expect(menu).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(page.locator('#composerPlus')).toBeFocused();
  await page.screenshot({path:'test-results/nexus-bundles-mobile.png',fullPage:true});
});
