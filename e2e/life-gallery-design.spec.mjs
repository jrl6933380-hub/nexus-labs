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

test('gallery photos save from a check-in, survive reload and appear inside calendar cards',async({page})=>{
  const {life,user,errors}=await setup(page);
  const day=new Date(await page.evaluate(()=>{const day=new Date();day.setHours(9,0,0,0);return day.toISOString();}));
  const proposed=await life.preview({title:'A morning worth keeping',kind:'activity',pillar:'health',starts_at:day.toISOString(),ends_at:new Date(+day+3600000).toISOString()},user);
  const item=await life.save({...proposed.item,baseline:proposed.baseline,destination:'life'},user);
  for(const [title,pillar,hour,duration] of [['Rest & recharge','sleep',0,7],['Focused project work','work',10,2],['Lunch with family','social',12,1],['Time for myself','personal',13,1],['Afternoon walk','health',15,1]]){
    const start=new Date(+day+(hour-9)*3600000);const plan=await life.preview({title,kind:'activity',pillar,starts_at:start.toISOString(),ends_at:new Date(+start+duration*3600000).toISOString()},user);await life.save({...plan.item,baseline:plan.baseline,destination:'life'},user);
  }

  await page.reload();await expect(page.locator('.lifecalendar')).toBeVisible();
  await page.locator('.lc-viewport').evaluate(el=>{el.scrollTop=8*80;});
  await page.locator(`[data-item-id="${item.id}"]`).click();
  await page.getByRole('button',{name:'Energy & reflection',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add from Photos',exact:true})).toBeVisible();
  await expect(page.getByLabel('Memory link',{exact:true})).not.toBeVisible();
  const gallery=page.locator('.lifecheckinphotos input[type=file]');
  expect(await gallery.getAttribute('capture')).toBeNull();
  const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');const g=ctx.createLinearGradient(0,0,640,480);g.addColorStop(0,'#b2c883');g.addColorStop(1,'#315c4c');ctx.fillStyle=g;ctx.fillRect(0,0,640,480);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  await gallery.setInputFiles(Array.from({length:4},(_,index)=>({name:`gallery-${index}.png`,mimeType:'image/png',buffer:png})));
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Keep up to three photos');
  await expect(page.locator('.lifecheckinphotos img')).toHaveCount(0);
  await gallery.setInputFiles({name:'my-gallery-photo.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('.lifecheckinphotos img')).toHaveCount(1);
  await page.getByRole('combobox',{name:'What happened?',exact:true}).selectOption('happened');
  await page.getByRole('combobox',{name:'How did it feel?',exact:true}).selectOption('4');
  await page.getByRole('button',{name:'Save my check-in',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await life.photos(item.id,user)).photos.length).toBe(1);
  await expect(page.locator('.lc-photo')).toHaveCount(1);
  await page.screenshot({path:'test-results/life-designed-calendar-mobile.png',fullPage:true});
  await page.reload();await expect(page.locator('.lc-photo')).toHaveCount(1);
  await page.getByRole('button',{name:'Your week',exact:true}).click();
  await expect(page.locator('.lifeorb strong')).toHaveText('1');
  await page.screenshot({path:'test-results/life-designed-insights-mobile.png',fullPage:true});
  const a11y=await new AxeBuilder({page}).include('.nexuslife').withTags(['wcag2a','wcag2aa']).analyze();expect(a11y.violations.filter(v=>['critical','serious'].includes(v.impact))).toEqual([]);
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'test-results/life-designed-insights-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Life calendar',exact:true}).click();await page.locator('.lc-viewport').evaluate(el=>{el.scrollTop=8*80;});const calendarA11y=await new AxeBuilder({page}).include('.nexuslife').withTags(['wcag2a','wcag2aa']).analyze();expect(calendarA11y.violations.filter(v=>['critical','serious'].includes(v.impact))).toEqual([]);
  expect(errors).toEqual([]);
});
