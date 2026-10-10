import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createPlannerStore} from '../lib/planner.js';
import {createReminderStore} from '../lib/reminders.js';
import {createRemindersHandler} from '../api/board.js';
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,timezoneId:'UTC',serviceWorkers:'block'});
async function setup(page){
  const hashes=new Map(),errors=[];let id=0;
  const command=async([verb,key,...args])=>{const hash=hashes.get(key)||new Map();hashes.set(key,hash);if(verb==='HGET')return hash.get(args[0])||null;if(verb==='HGETALL')return [...hash].flat();if(verb==='HSET'){for(let i=0;i<args.length;i+=2)hash.set(args[i],args[i+1]);return 1;}if(verb==='HDEL')return hash.delete(args[0]);throw Error(verb);};
  const user='owner:polish',planner=createPlannerStore({command,idFactory:()=>`event-${++id}`}),store=createReminderStore({command,planner,idFactory:()=>`reminder-${++id}`});
  await page.clock.setFixedTime(new Date('2026-10-10T09:45:00Z'));
  for(const [title,start,end,category] of [['Focus block',9,10.5,'work'],['Workout',11,12,'gym'],['Lunch with Sam',12.5,13.5,'social']])await planner.createPlannerItem({title,starts_at:new Date(Date.UTC(2026,9,10,start, start%1*60)).toISOString(),ends_at:new Date(Date.UTC(2026,9,10,end,end%1*60)).toISOString(),category},user);
  await store.create({title:'Send invoice',notes:'Creekside Lawn project',due_date:'2026-10-09'},user);
  const call=await store.create({title:'Call Mom',due_date:'2026-10-10',due_at:'2026-10-10T15:00:00Z'},user);
  await store.schedule({id:call.id,starts_at:'2026-10-10T15:00:00Z',ends_at:'2026-10-10T15:30:00Z',apply:true},user);
  await store.create({title:'Water plants',due_date:'2026-10-10',repeat:'daily'},user);
  const handler=createRemindersHandler({getOwner:async()=>({id:'polish'}),getUser:async()=>null,store});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/_vercel/insights/script.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname,body=route.request().method()==='POST'?route.request().postDataJSON():undefined;
    if(path==='/api/reminders'){const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await handler({method:route.request().method(),body},res);return route.fulfill({status:res.code,json:res.data});}
    if(path==='/api/planner'){if(body?.action==='preview')return route.fulfill({json:await planner.previewPlannerItem(body,user)});if(body?.action==='update')return route.fulfill({json:{item:await planner.updatePlannerItem(body,user)}});return route.fulfill({json:{items:await planner.listPlannerItems({},user)}});}
    let data={items:[]};if(path==='/api/nexus-auth')data={authenticated:true,owner:{id:'polish'}};if(path==='/api/chat')data={threads:[],messages:[]};if(path==='/api/nexus-messages')data={specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:['planner','reminders']};return route.fulfill({json:data});
  });await page.goto('/workspace.html');return {store,planner,user,errors};
}
async function open(page,name){await page.locator('#input').fill(name);await page.locator('#input').press('Enter');}
test('calendar matches the mobile design and saves keyboard moves while protecting occupied time',async({page})=>{
  const {planner,user,errors}=await setup(page);await open(page,'calendar');await expect(page.locator('.nexcalendar')).toBeVisible();
  await expect(page.getByRole('button',{name:'Day',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.caldatestrip button')).toHaveCount(9);
  await expect(page.locator('.calnex > summary')).toBeVisible();await page.screenshot({path:'test-results/nexus-calendar-polished.png',fullPage:true});
  await page.getByRole('button',{name:'Focus block, activity actions',exact:true}).click();const move=page.getByRole('button',{name:/Move Focus block/});await move.focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await planner.listPlannerItems({},user)).find(i=>i.title==='Focus block').starts_at).toBe('2026-10-10T08:45:00.000Z');
  await page.getByRole('button',{name:'Focus block, activity actions',exact:true}).click();await page.getByRole('button',{name:/Move Focus block/}).focus();for(let i=0;i<9;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(page.getByRole('alert')).toContainText('overlaps');expect((await planner.listPlannerItems({},user)).find(i=>i.title==='Focus block').starts_at).toBe('2026-10-10T08:45:00.000Z');
  await page.getByRole('button',{name:'Week',exact:true}).click();await expect(page.locator('.calhourcolumn')).toHaveCount(7);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const axe=await new AxeBuilder({page}).include('.nexcalendar').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations.filter(v=>['critical','serious'].includes(v.impact))).toEqual([]);expect(errors).toEqual([]);
});
test('reminders display live records, snooze, repeat completion, and retain changes after reload',async({page})=>{
  const {store,user,errors}=await setup(page);await open(page,'reminders');await expect(page.locator('.nexreminders')).toBeVisible();
  await expect(page.locator('.reminderrow.overdue')).toContainText('Send invoice');await expect(page.locator('.reminderlinked')).toHaveText('▣ Calendar');
  await page.screenshot({path:'test-results/nexus-reminders-polished.png',fullPage:true});
  await page.locator('.reminderrow').filter({hasText:'Send invoice'}).getByRole('button',{name:'◷ Snooze',exact:true}).click();await page.getByRole('button',{name:'1 hour',exact:true}).click();await expect.poll(async()=>(await store.list(user)).find(i=>i.title==='Send invoice').due_at).toBe('2026-10-10T10:45:00.000Z');
  await page.getByRole('button',{name:/Routines ·/}).click();await page.getByRole('button',{name:'Complete Water plants',exact:true}).click();await expect(page.locator('.reminderrow')).toContainText('2026-10-11');
  await page.reload();await expect(page.locator('.nexreminders')).toBeVisible();await page.getByRole('button',{name:/Routines ·/}).click();await expect(page.locator('.reminderrow')).toContainText('2026-10-11');
  const axe=await new AxeBuilder({page}).include('.nexreminders').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations.filter(v=>['critical','serious'].includes(v.impact))).toEqual([]);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
