import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {chromium} from '@playwright/test';
import {workspaceFixture} from '../test/helpers/workspaceFixture.mjs';
const fixture=workspaceFixture(),account={id:'justin',owner:true,workbenchUserId:'Mrlopez',scheduleUserId:'owner:justin'};
const {item}=await fixture.execute('create_reminder',{title:'Take medicine',due_date:'2026-10-20',due_at:'2026-10-20T14:00:00Z',timezone:'America/Chicago'},account);
const publicRoot=new URL('../public/',import.meta.url),source=await readFile(new URL('workspace.html',publicRoot),'utf8');
const styles=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[0]).join(''),links=[...source.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('');
const html=`<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}${links}</head><body data-view="planner"><div class="screen"><div class="top">Nexus</div><div class="thread" id="root"></div><div class="foot">Composer</div></div><script type="module">
import {renderScheduleCalendar} from '/schedule-calendar.js';import {renderReminders} from '/reminders.js';
const root=document.getElementById('root');const ctx={calendarState:{date:new Date(2026,9,20),mode:'day'},go:async view=>{document.body.dataset.view=view;root.replaceChildren(await (view==='planner'?renderScheduleCalendar(ctx):renderReminders(ctx)));},openScheduleStudio(){},setScheduleItems(){},changeCalendarTimes(){},ask(){},planWithNex(){}};window.ctx=ctx;await ctx.go('planner');
</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
 if(url.pathname==='/api/planner'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(await fixture.execute('schedule',Object.fromEntries(url.searchParams),account)));}
 if(url.pathname==='/api/reminders'){let result;if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const {action,...input}=JSON.parse(raw);result=await fixture.execute(action==='update'?'update_reminder':action==='delete'?'delete_reminder':'create_reminder',input,account);}else result=await fixture.execute('reminders',{},account);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));}
 res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL(url.pathname.slice(1),publicRoot)));
 }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.NEXUS_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 for(const width of [320,393]){
  await fixture.execute('update_reminder',{id:item.id,status:'planned',due_at:'2026-10-20T14:00:00Z',due_date:'2026-10-20',timezone:'America/Chicago'},account);
  const context=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,timezoneId:'America/Chicago'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.lc-remindermarker').waitFor();assert.match(await page.locator('.lc-remindermarker').textContent(),/Reminder.*9:00 AM.*Take medicine/);
  await page.getByRole('button',{name:'Open reminder Take medicine at 9:00 AM',exact:true}).tap();await page.getByLabel('Reminder title',{exact:true}).waitFor();assert.equal(await page.getByLabel('Reminder title',{exact:true}).inputValue(),'Take medicine');
  await page.getByLabel('Reminder time',{exact:true}).selectOption('600');await page.getByRole('button',{name:'Save changes',exact:true}).tap();await page.getByRole('button',{name:/^Upcoming/}).waitFor();await page.getByRole('button',{name:/^Upcoming/}).tap();await page.getByRole('button',{name:'View in Calendar',exact:true}).tap();
  await page.locator('.lc-remindermarker').waitFor();assert.match(await page.locator('.lc-remindermarker').textContent(),/10:00 AM/);assert.equal((await fixture.schedule.listPlannerItems({},account.scheduleUserId)).length,0);
  await page.getByRole('button',{name:'Month',exact:true}).tap();await page.locator('.calremindermarker').waitFor();assert.match(await page.locator('.calremindermarker').textContent(),/Take medicine/);
  await page.getByRole('button',{name:'Open reminder Take medicine',exact:true}).tap();await page.getByRole('button',{name:'Back',exact:true}).tap();await page.getByRole('button',{name:/^Upcoming/}).tap();await page.getByRole('button',{name:'Complete Take medicine',exact:true}).tap();await page.evaluate(()=>window.ctx.go('planner'));assert.equal(await page.locator('.calremindermarker').count(),0);
  if(width===393){await fixture.execute('create_event',{title:'Meeting',starts_at:'2026-10-20T14:00:00Z',ends_at:'2026-10-20T15:00:00Z'},account);for(const title of ['Call mom','Water plants'])await fixture.execute('create_reminder',{title,due_date:'2026-10-20',due_at:'2026-10-20T14:00:00Z',timezone:'America/Chicago'},account);await page.evaluate(()=>window.ctx.go('planner'));await page.getByRole('button',{name:'Day',exact:true}).tap();await page.locator('.lc-remindergroup').waitFor();await page.locator('.lc-remindergroup summary').tap();await page.getByRole('button',{name:'Open reminder Water plants at 9:00 AM',exact:true}).tap();await page.getByLabel('Reminder title',{exact:true}).waitFor();assert.equal(await page.getByLabel('Reminder title',{exact:true}).inputValue(),'Water plants');}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Calendar ↔ exact Reminder editing verified at 320px and 393px: marker, time edit, View in Calendar, Month marker, completion removal, no time reservation, no console errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
