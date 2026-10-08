import {test,expect} from '@playwright/test';
import {createLifeStore} from '../lib/life.js';
import {createPlannerStore} from '../lib/planner.js';
import {createReminderStore} from '../lib/reminders.js';
import {createLifeHandler} from '../api/board.js';
import AxeBuilder from '@axe-core/playwright';
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,timezoneId:'America/Chicago',serviceWorkers:'block'});
async function setup(page){
  const hashes=new Map(),calls=[],errors=[];let sequence=0,failSave=false;
  const command=async([verb,key,...args])=>{const hash=hashes.get(key) || new Map();hashes.set(key,hash);if(verb==='HGET')return hash.get(args[0]) || null;if(verb==='HGETALL')return [...hash].flat();if(verb==='HSET'){for(let i=0;i<args.length;i+=2)hash.set(args[i],args[i+1]);return 1;}if(verb==='HDEL')return hash.delete(args[0]);throw Error(verb);};
  const planner=createPlannerStore({command,idFactory:()=>`p-${++sequence}`}),reminders=createReminderStore({command,planner}),life=createLifeStore({command,planner,reminders,idFactory:()=>`life-${++sequence}`}),user='owner:justin';
  const handler=createLifeHandler({getOwner:async()=>({id:'justin'}),getUser:async()=>null,store:life});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/_vercel/insights/script.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path==='/api/life'){
      const body=route.request().method()==='POST' ? route.request().postDataJSON() : undefined;calls.push(body || {get:true});if(failSave && body?.action==='save')return route.fulfill({status:503,json:{error:'Life storage is unavailable'}});
      const response={code:200,setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
      await handler({method:route.request().method(),query:Object.fromEntries(url.searchParams),body},response);return route.fulfill({status:response.code,json:response.data});
    }
    let data={items:[]};if(path==='/api/nexus-auth')data={authenticated:true,owner:{id:'justin'}};
    if(path==='/api/chat')data={threads:[],messages:[]};
    if(path==='/api/nexus-messages')data={specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:['life']};
    return route.fulfill({json:data});
  });
  await page.goto('/workspace.html');
  await page.locator('.messagelist').getByRole('button',{name:/Life & Schedule/}).click();
  await page.getByRole('button',{name:/Nexus Life Life & Schedule/}).click();await expect(page.locator('.lifecalendar')).toBeVisible();
  return {life,user,calls,errors,setFailure:value=>{failSave=value;}};
}
async function rangeAt(page,minutes,dayOffset=0){
  return page.evaluate(({minutes,dayOffset})=>{const viewport=document.querySelector('.lc-viewport'),lanes=[...document.querySelectorAll('.lc-lane')];viewport.scrollTop=8*80;const rect=viewport.getBoundingClientRect(),visible=lanes.filter(l=>{const r=l.getBoundingClientRect();return r.left>=rect.left+35 && r.left<rect.right-60;});const lane=visible[dayOffset] || visible[0];const r=lane.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+minutes/60*80,day:lane.dataset.day};},{minutes,dayOffset});
}
async function saveActivity(page,title){await page.getByLabel('What is it?',{exact:true}).fill(title);await page.getByRole('button',{name:'Review my plan',exact:true}).click();await page.getByRole('button',{name:'Keep in Life only',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}

test('draw a time range, fill sheet, move the block directly, resize, and retain saved times on reopen',async({page})=>{
  const {life,user,calls,errors}=await setup(page);
  await expect(page.getByRole('button',{name:'Month',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Multi-day',exact:true})).toHaveCount(0);
  const point=await rangeAt(page,9*60);await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y+100,{steps:10});await page.mouse.up();
  await expect(page.getByRole('dialog',{name:'Add Time Block'})).toBeVisible();expect(await page.locator('.lifeadjusttime select').last().inputValue()).toBe('75');await page.screenshot({path:'test-results/life-block-editor-mobile.png',fullPage:true});
  await saveActivity(page,'Morning walk');let item=(await life.overview(user)).items[0];expect(Date.parse(item.ends_at)-Date.parse(item.starts_at)).toBe(75*60000);
  const original=Date.parse(item.starts_at),block=page.locator(`[data-item-id="${item.id}"]`);await expect(block).toBeVisible();
  let rect=await block.boundingBox();await page.mouse.move(rect.x+40,rect.y+20);await page.mouse.down();await page.mouse.move(rect.x+40,rect.y+60,{steps:8});await page.mouse.up();
  await expect.poll(async()=>Date.parse((await life.overview(user)).items[0].starts_at)).toBe(original+30*60000);
  item=(await life.overview(user)).items[0];rect=await block.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height-4);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height+16,{steps:8});await page.mouse.up();
  await expect.poll(async()=>Date.parse((await life.overview(user)).items[0].ends_at)).toBe(Date.parse(item.ends_at)+15*60000);
  const beforeDay=(await life.overview(user)).items[0],other=await rangeAt(page,9*60,1);rect=await block.boundingBox();await page.mouse.move(rect.x+40,rect.y+20);await page.mouse.down();await page.mouse.move(other.x,rect.y+20,{steps:8});await page.mouse.up();await expect.poll(async()=>Date.parse((await life.overview(user)).items[0].starts_at)).toBe(Date.parse(beforeDay.starts_at)+24*3600000);
  await page.reload();await expect(page.locator('.lifecalendar')).toBeVisible();
  await expect(page.locator(`[data-item-id="${item.id}"]`)).toContainText('Morning walk');
  expect(calls.filter(c=>c.action==='save').length).toBe(4);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/life-calendar-mobile.png',fullPage:true});
  const a11y=await new AxeBuilder({page}).include('.nexuslife').withTags(['wcag2a','wcag2aa']).analyze();expect(a11y.violations.filter(v=>['critical','serious'].includes(v.impact))).toEqual([]);
});

test('real touch holds and selects a range, touch drags a block, and swipe scrolls without creating',async({page})=>{
  const {life,user,errors}=await setup(page),cdp=await page.context().newCDPSession(page),point=await rangeAt(page,9*60);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd' ? [] : [{x,y,id:1,radiusX:2,radiusY:2,force:1}]});
  await touch('touchStart',point.x,point.y);await page.waitForTimeout(280);await touch('touchMove',point.x,point.y+80);await touch('touchEnd',0,0);
  await expect(page.getByRole('dialog')).toBeVisible();expect(await page.locator('.lifeadjusttime select').last().inputValue()).toBe('60');await saveActivity(page,'Touch walk');
  const item=(await life.overview(user)).items[0],rect=await page.locator(`[data-item-id="${item.id}"]`).boundingBox();
  await touch('touchStart',rect.x+50,rect.y+16);await touch('touchMove',rect.x+50,rect.y+56);await touch('touchEnd',0,0);
  await expect.poll(async()=>Date.parse((await life.overview(user)).items[0].starts_at)).toBe(Date.parse(item.starts_at)+30*60000);
  const empty=await rangeAt(page,11*60);const before=await page.locator('.lc-viewport').evaluate(el=>el.scrollTop);
  await touch('touchStart',empty.x,empty.y);await touch('touchMove',empty.x,empty.y-70);await touch('touchEnd',0,0);
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.locator('.lc-viewport').evaluate(el=>el.scrollTop)).toBeGreaterThan(before);expect(errors).toEqual([]);
});

test('dragging onto occupied time opens conflict review without changing the original; cancelling an empty selection creates nothing',async({page})=>{
  const {life,user,calls,errors}=await setup(page);let point=await rangeAt(page,9*60);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y+80,{steps:5});await page.mouse.up();await saveActivity(page,'Fixed work');
  point=await rangeAt(page,11*60);await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y+80,{steps:5});await page.mouse.up();await saveActivity(page,'Lunch');
  const original=(await life.overview(user)).items.find(item=>item.title==='Fixed work'),block=page.locator(`[data-item-id="${original.id}"]`),rect=await block.boundingBox();
  await page.mouse.move(rect.x+40,rect.y+20);await page.mouse.down();await page.mouse.move(rect.x+40,rect.y+180,{steps:10});await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByText('These times overlap.',{exact:false})).toBeVisible();expect((await life.overview(user)).items.find(item=>item.id===original.id).starts_at).toBe(original.starts_at);expect(calls.filter(c=>c.action==='save').length).toBe(2);
  await page.getByRole('button',{name:'Close activity editor'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  point=await rangeAt(page,13*60);await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y+40);await page.keyboard.press('Escape');await page.mouse.up();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await life.overview(user)).items.length).toBe(2);expect(errors).toEqual([]);
});


test('a failed drag save retains the original block and reports the storage error',async({page})=>{
  const {life,user,setFailure,errors}=await setup(page),point=await rangeAt(page,9*60);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y+80,{steps:5});await page.mouse.up();await saveActivity(page,'Keep this time');
  const item=(await life.overview(user)).items[0],block=page.locator(`[data-item-id="${item.id}"]`),rect=await block.boundingBox();setFailure(true);
  await page.mouse.move(rect.x+40,rect.y+20);await page.mouse.down();await page.mouse.move(rect.x+40,rect.y+60,{steps:5});await page.mouse.up();
  await expect(page.locator('.lc-status')).toContainText('Life storage is unavailable');expect((await life.overview(user)).items[0].starts_at).toBe(item.starts_at);await expect(block).toBeVisible();expect(errors).toEqual([]);
});
