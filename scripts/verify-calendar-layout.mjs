import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const origin=new URL('../public/',import.meta.url);
const item={id:'workout',title:'Light full body workout',starts_at:'2026-10-11T10:00:00Z',ends_at:'2026-10-11T10:45:00Z',category:'health',status:'planned'};
const shell=await readFile(new URL('workspace.html',origin),'utf8');
const styles=[...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[0]).join('');
const fixture=`<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="/schedule-calendar.css"></head><body data-view="planner"><div class="top">Nexus</div><div class="thread" id="root"></div><div class="foot">Composer</div><script type="module">
import {renderScheduleCalendar} from '/schedule-calendar.js';window.created=[];window.changes=[];
const ctx={calendarState:{date:new Date(2026,9,11),mode:'list'},openScheduleStudio:(...args)=>window.created.push(args),planWithNex:()=>{},setScheduleItems(){},changeCalendarTimes:async(record,times)=>{window.changes.push(times);Object.assign(window.events[0],times);}};
window.events=${JSON.stringify([item])};window.fetch=async()=>({ok:true,json:async()=>({items:window.events})});
document.getElementById('root').append(await renderScheduleCalendar(ctx));
</script></body></html>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(fixture);}const name=new URL(req.url,'http://localhost').pathname.slice(1);if(name.includes('..'))throw Error('bad path');res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL(name,origin)));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.NEXUS_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 for(const width of [320,393]){
  const context=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,timezoneId:'UTC'});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.caleventrow').waitFor();
  assert.equal(await page.locator('.nexcalendar').getAttribute('data-mode'),'list');assert.equal(await page.locator('.foot').isVisible(),false);if(width===393)await page.screenshot({path:'/tmp/nexus-calendar-list.png'});
  await page.getByRole('button',{name:'Month',exact:true}).tap();await page.locator('.calmonth').waitFor();assert.equal(await page.locator('.caldate').count(),42);if(width===393)await page.screenshot({path:'/tmp/nexus-calendar-month.png'});
  await page.getByRole('button',{name:'Monday, October 12, 2026, 0 activities',exact:true}).count().then(async count=>{if(count)await page.getByRole('button',{name:'Monday, October 12, 2026, 0 activities',exact:true}).tap();else await page.locator('.caldate').filter({hasText:/^12$/}).first().tap();});
  assert.equal(await page.locator('.calempty').isVisible(),true);await page.getByRole('button',{name:'Open day',exact:true}).tap();await page.locator('.calhours').waitFor();
  const slot=page.locator('.calslot').nth(9);await slot.tap();assert.equal(await page.evaluate(()=>window.created.length),0);
  const duration=page.getByRole('button',{name:'Duration selected time. Drag or use up and down arrows.',exact:true});await duration.focus();await page.keyboard.press('ArrowDown');const bounds=await duration.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2+14,{steps:4});await page.mouse.up();
  await page.getByRole('button',{name:'Add details',exact:true}).tap();const created=await page.evaluate(()=>window.created);assert.deepEqual(created[0],['block','2026-10-12',540,90]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>{window.events[0].starts_at='2026-10-12T10:00:00Z';window.events[0].ends_at='2026-10-12T10:45:00Z';});await page.getByRole('button',{name:'Day',exact:true}).tap();await page.locator('.calslot').nth(9).tap();await page.getByRole('button',{name:'Duration selected time. Drag or use up and down arrows.',exact:true}).focus();await page.keyboard.press('ArrowDown');assert.equal(await page.getByRole('button',{name:'Add details',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Cancel',exact:true}).tap();assert.equal(await page.locator('.calselection').count(),0);assert.equal(await page.evaluate(()=>window.created.length),1);
  await page.getByRole('button',{name:'Week',exact:true}).tap();assert.equal(await page.locator('.calhourcolumn').count(),7);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Mobile calendar verified at 320px and 393px: List default, Month selection, Day range adjustments, exact editor duration, Week lanes, no overflow or console errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
