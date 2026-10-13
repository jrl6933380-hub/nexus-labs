import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const origin=new URL('../public/',import.meta.url);
const item={id:'workout',title:'Light full body workout',starts_at:'2026-10-11T10:00:00Z',ends_at:'2026-10-11T10:45:00Z',category:'health',status:'planned'};
const shell=await readFile(new URL('workspace.html',origin),'utf8');
const styles=[...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[0]).join('');
const links=[...shell.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('');
const fixture=`<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}${links}</head><body data-view="planner"><div class="screen"><div class="top">Nexus</div><div class="thread" id="root"></div><div class="foot">Composer</div></div><script type="module">
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
  assert.equal(await page.locator('.calempty').isVisible(),true);await page.getByRole('button',{name:'Open day',exact:true}).tap();await page.locator('.lc-viewport').waitFor();
  const cdp=await context.newCDPSession(page);
  async function touch(type,x,y){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}],modifiers:0});}
  const lane=page.locator('.lc-lane').first();const laneBox=await lane.boundingBox();const gridBox=await page.locator('.lc-grid').boundingBox();const x=laneBox.x+laneBox.width/2,y=gridBox.y+9.5*80;
  // A quick swipe scrolls without creating a selection.
  await touch('touchStart',x,y);await touch('touchMove',x,y-30);await touch('touchEnd',x,y-30);assert.equal(await page.locator('.lc-draft').count(),0);
  await page.locator('.lc-viewport').evaluate(el=>el.scrollTop=640);
  const freshGrid=await page.locator('.lc-grid').boundingBox(),holdY=freshGrid.y+9.5*80;
  await touch('touchStart',x,holdY);await new Promise(resolve=>setTimeout(resolve,480));await touch('touchEnd',x,holdY);await page.locator('.lc-draft').waitFor({timeout:3000});assert.equal(await page.evaluate(()=>window.created.length),0);
  // Pull the bottom edge by 30 minutes, then drag the whole draft by one hour.
  const edge=await page.locator('.lc-draft>.lc-resize:not(.lc-resize-top)').boundingBox();const edgeY=edge.y+edge.height/2;
  await touch('touchStart',x,edgeY);await touch('touchMove',x,edgeY+40);await touch('touchEnd',x,edgeY+40);
  const draft=await page.locator('.lc-draft').boundingBox(),draftY=draft.y+draft.height/2;
  await touch('touchStart',x,draftY);await touch('touchMove',x,draftY+80);await touch('touchEnd',x,draftY+80);
  await page.screenshot({path:'/tmp/nexus-calendar-touch-selection.png'});await page.getByRole('button',{name:'Add details',exact:true}).tap();const created=await page.evaluate(()=>window.created);assert.deepEqual(created[0],['block','2026-10-12',630,45]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>{window.events[0].starts_at='2026-10-12T10:00:00Z';window.events[0].ends_at='2026-10-12T10:45:00Z';});await page.getByRole('button',{name:'Day',exact:true}).tap();
  await page.locator('.lc-lane').evaluate(el=>el.selectRange(540,615));assert.equal(await page.getByRole('button',{name:'Add details',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Cancel',exact:true}).tap();assert.equal(await page.locator('.lc-draft').count(),0);assert.equal(await page.evaluate(()=>window.created.length),1);
  const existing=await page.locator('.lc-block').boundingBox(),moveX=existing.x+existing.width/2,moveY=existing.y+existing.height/2;await touch('touchStart',moveX,moveY);await touch('touchMove',moveX,moveY+80);await touch('touchEnd',moveX,moveY+80);await page.waitForFunction(()=>window.changes.length===1);assert.equal((await page.evaluate(()=>window.changes[0])).starts_at,'2026-10-12T11:00:00.000Z');
  await page.locator('.nexcalendar:not([aria-busy])').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const savedEdge=await page.locator('.lc-block>.lc-resize').boundingBox(),savedY=savedEdge.y+savedEdge.height/2;await touch('touchStart',moveX,savedY);await touch('touchMove',moveX,savedY+20);await touch('touchEnd',moveX,savedY+20);await page.waitForFunction(()=>window.changes.length===2,{},{timeout:5000});assert.equal((await page.evaluate(()=>window.changes[1])).ends_at,'2026-10-12T12:00:00.000Z');
  if(width===393)await page.screenshot({path:'/tmp/nexus-calendar-shared-day.png'});
  await page.getByRole('button',{name:'Week',exact:true}).tap();assert.equal(await page.locator('.lc-lane').count(),7);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Mobile calendar verified at 320px and 393px: List default, Month selection, native touch hold, edge resize and draft drag, exact editor duration, Week lanes, no overflow or console errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
