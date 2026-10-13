import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createPlannerStore} from '../lib/planner.js';
import {createReminderStore} from '../lib/reminders.js';
import {duePushNotifications} from '../lib/pushNotifications.js';
const publicRoot=new URL('../public/',import.meta.url),source=await readFile(new URL('workspace.html',publicRoot),'utf8');
function sourceFunction(name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,name);const tail=source.slice(start),end=tail.slice(1).search(/\n(?:async )?function |\nconst /);return end<0?tail:tail.slice(0,end+1);}
const functions=['localDateTime','optionField','durationLabel','clockOptions','scheduleDateTime','wizardShell','choiceButtons','openScheduleStudio'].map(sourceFunction).join('\n');
const styles=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[0]).join('');
const hashes=new Map();let seq=0;
const command=async([verb,key,...args])=>{const hash=hashes.get(key)||new Map();hashes.set(key,hash);if(verb==='HGET')return hash.get(args[0])||null;if(verb==='HGETALL')return [...hash].flat();if(verb==='HSET'){hash.set(args[0],args[1]);return 1;}if(verb==='HDEL')return hash.delete(args[0])?1:0;throw Error(verb);};
const planner=createPlannerStore({command,idFactory:()=>`ui-${++seq}`}),reminders=createReminderStore({command,planner}),user='owner:justin';
const fixture=`<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="/schedule-calendar.css"></head><body data-view="planner"><div class="screen"><div class="top">Nexus</div><div class="thread" id="thread"></div><div class="foot">Composer</div></div><script type="module">
import {updateStartOptions,plannedEndLabel} from '/schedule-availability.js';
const thread=document.getElementById('thread'),esc=value=>String(value),scheduleDurations=Array.from({length:64},(_,i)=>(i+1)*15);
const friendlyError=error=>error.message,showView=()=>{},askFromView=()=>{},scheduleAdded=()=>window.saved=true;
async function readTakenSchedule(){return (await (await fetch('/api/planner')).json()).items;}
async function postPlanner(action,input){const response=await fetch('/api/planner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
${functions}
openScheduleStudio('block','2026-10-20',540,45);
</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
 if(req.url==='/api/planner'){let data;if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const {action,...input}=JSON.parse(raw);data=action==='preview'?await planner.previewPlannerItem(input,user):{item:await planner.createPlannerItem(input,user)};}else data={items:await planner.listPlannerItems({},user)};res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));}
 if(req.url==='/api/reminders'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items:await reminders.list(user)}));}
 const name=new URL(req.url,'http://localhost').pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL(name,publicRoot)));
 }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.NEXUS_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:393,height:850},isMobile:true,hasTouch:true,timezoneId:'America/Chicago'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>!document.querySelector('[aria-label="Start time"]') && ![...document.querySelectorAll('select')].find(el=>el.parentElement.textContent.startsWith('Start time')).disabled);
 assert.equal(await page.getByLabel('Activity',{exact:true}).count(),0);assert.equal(await page.getByText('When the block time is up',{exact:true}).count(),0);assert.equal(await page.locator('.foot').isVisible(),false);
 await page.getByRole('button',{name:'Save event',exact:true}).tap();await page.getByText('Give your event a name.',{exact:true}).waitFor();
 await page.getByLabel('Activity name',{exact:true}).fill('Morning workout');await page.getByRole('button',{name:'Save event',exact:true}).tap();await page.waitForFunction(()=>window.saved===true);
 const [event]=await planner.listPlannerItems({},user),[reminder]=await reminders.list(user);assert.equal(event.reminder_minutes,30);assert.equal(reminder.title,'Morning workout');assert.equal(reminder.due_at,new Date(Date.parse(event.starts_at)-1800000).toISOString());assert.equal(Date.parse(event.ends_at)-Date.parse(event.starts_at),45*60000);
 assert.equal(duePushNotifications({schedule:[event],reminders:[reminder],now:Date.parse(reminder.due_at)}).length,1);
 const response=await page.request.get(new URL('/api/reminders',page.url()).href);assert.equal((await response.json()).items[0].source_calendar_id,event.id);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('Actual Calendar editor → isolated Planner store → Reminders read → one push candidate verified; Chicago time, 45-minute selected range, automatic 30-minute alert, no category/end-reminder pickers, composer hidden.');
 await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
