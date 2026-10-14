import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {workspaceFixture} from '../test/helpers/workspaceFixture.mjs';
const fixture=workspaceFixture({formHtml:'<!doctype html><html><body><h1>Saved Bodyweight Studio</h1><button id=timer>Start set</button><p id=state>Ready</p><script>document.getElementById("timer").onclick=()=>document.getElementById("state").textContent="Set running"</script></body></html>'}),account={id:'justin',owner:true,workbenchUserId:'Mrlopez',scheduleUserId:'owner:justin'};
await fixture.execute('import_form',{},account);
const now=Date.now(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
const {item:event}=await fixture.execute('create_event',{title:'Saved workout',starts_at:new Date(now+3600000).toISOString(),ends_at:new Date(now+6300000).toISOString()},account);
const {item:reminder}=await fixture.execute('create_reminder',{title:'Bring water',due_date:date,due_at:new Date(now+1800000).toISOString(),timezone:'America/Chicago'},account);
const publicRoot=new URL('../public/',import.meta.url);
let reads=0,fail=false,teamMode='working',answer=null;
function team(){const steps=[{id:'a',member_id:'atlas',name:'Atlas',role:'research',state:'returned',result:'Research ready',instruction:'Research workouts'},{id:'m',member_id:'mason',name:'Mason',role:'build',state:'working',instruction:'Build the page',updates:['Adding the timer and set tracking.']},{id:'v',member_id:'vera',name:'Vera',role:'review',state:'queued',instruction:'Review the result'}];let state='running';
 if(teamMode==='question'){state='waiting_input';Object.assign(steps[1],{state:'waiting_input',question:{id:'question-one',question:'Which timer length do you want?',options:['30 seconds','45 seconds']}});}
 if(['completed','preview'].includes(teamMode)){state='completed';Object.assign(steps[1],{state:'returned',result:'```html\n<!doctype html><html><body><h1>Bodyweight Studio</h1></body></html>\n```',saved_project:{build_id:'project-one'}});if(teamMode==='preview')delete steps[1].saved_project;steps[2].state='returned';steps[2].result='Review completed';}
 return {group:{id:'nex-main',kind:'group',title:'Test team',name:'Nex',available_members:[],member_ids:[],include_nex:true},runs:[{id:'run-one',goal:'Bodyweight Studio',message:'Build a workout page',state,steps,events:[]}]};}
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');try{
 if(url.pathname.startsWith('/api/')){
  let data={};
  if(url.pathname==='/api/nexus-auth')data={ok:true};
  if(url.pathname==='/api/room-auth')data={username:'pilot'};
  if(url.pathname==='/api/nexus-controls')data={account:{id:'owner:justin',exempt:true,plan:'plus'},preferences:{responseStyle:'balanced',accent:'gold'}};
  if(url.pathname==='/api/nexus-messages'){
   if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);if(input.action==='team_answer'){answer=input;teamMode='working';}data={ok:true};}
   else data=url.searchParams.has('group_id')?(url.searchParams.get('group_id')==='nex-main'?team():{group:{id:url.searchParams.get('group_id'),kind:'nex',available_members:[]},runs:[]}):{specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:[]};
  }
  if(url.pathname==='/api/chat')data={threads:[{id:'nex-main',title:'Workout planning',message_count:2}],messages:[{role:'user',content:'Keep my conversation'},{role:'assistant',content:'Your saved reply'}]};
  if(url.pathname==='/api/room-assistant')data=url.searchParams.has('threads')?{threads:[{id:'nex-main',title:'Workout planning',message_count:2}]}:{turns:url.searchParams.get('threadId')==='nex-main'?[{role:'user',text:'Keep my conversation'},{role:'assistant',text:'Your saved reply'}]:[],message:'Your saved reply'};
  if(url.pathname==='/api/planner'){reads++;if(fail){res.statusCode=503;data={error:'Schedule unavailable'};}else if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const {action,...input}=JSON.parse(raw);data=action==='preview'?await fixture.schedule.previewPlannerItem(input,account.scheduleUserId):await fixture.execute(action==='update'?'update_event':action==='delete'?'delete_event':'create_event',input,account);}else data=await fixture.execute('schedule',Object.fromEntries(url.searchParams),account);}
  if(url.pathname==='/api/reminders'){if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const {action,...input}=JSON.parse(raw);data=await fixture.execute(action==='update'?'update_reminder':action==='delete'?'delete_reminder':'create_reminder',input,account);}else data=await fixture.execute('reminders',{},account);}
  if(url.pathname==='/api/life')data={items:[],profile:{onboarded:true,focus:[]},pulses:[],summary:{}};
  if(url.pathname==='/api/room-history'){const projects=await fixture.execute('projects',{},account);if(url.searchParams.has('id')){const project=await fixture.execute('project',{project_id:'form-bodyweight-showcase'},account);data={build:{id:project.baseline,html:project.html,label:project.label}};}else data={projects:projects.projects.map(item=>({...item,id:item.project_id,latestBuildId:item.baseline}))};}
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));
 }
 if(url.pathname.startsWith('/_vercel/'))return res.end('');
 const path=url.pathname==='/'?'workspace.html':url.pathname.slice(1);
 res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'text/javascript');res.end(await readFile(new URL(path,publicRoot)));
 }catch{res.statusCode=404;res.end('');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.NEXUS_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{for(const shell of ['workspace.html','nexus.html'])for(const width of [320,393]){
 teamMode='working';answer=null;await fixture.execute('update_event',{id:event.id,starts_at:event.starts_at,ends_at:event.ends_at},account);await fixture.execute('update_reminder',{id:reminder.id,status:'planned'},account);
 const context=await browser.newContext({viewport:{width,height:900},isMobile:true,hasTouch:true,timezoneId:'America/Chicago'});const page=await context.newPage();await page.addInitScript(()=>{document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.setProperty('--nexus-safe-area-top','59px');});});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=`http://127.0.0.1:${server.address().port}/${shell}`;
 await page.goto(base);await page.getByRole('button',{name:/^More/}).tap();await page.getByRole('button',{name:shell==='workspace.html'?/^Account & Controls/:/^Settings/}).tap();
 await page.getByLabel('Choose your view on this device',{exact:true}).selectOption('simple');await page.getByRole('button',{name:'Save view',exact:true}).tap();
 await page.getByRole('button',{name:'Open workspace menu',exact:true}).waitFor();assert.equal(await page.getByText('Your saved reply',{exact:true}).count(),0);
 const bounds=await page.getByRole('button',{name:'Open workspace menu',exact:true}).boundingBox();assert.ok(bounds.y>=75);
 const menu=async name=>{await page.getByRole('button',{name:'Open workspace menu',exact:true}).tap();await page.getByRole('dialog',{name:'Your Nexus workspace'}).getByRole('button',{name,exact:true}).tap();};
 await menu('Workout planning');await page.getByText('Your saved reply',{exact:true}).waitFor();
 if(shell==='workspace.html'){await page.getByText('Your team is working',{exact:true}).waitFor();await page.getByRole('button',{name:'See Mason’s work',exact:true}).tap();await page.getByText('Build the page',{exact:true}).waitFor();}
 await page.locator(shell==='workspace.html'?'#newTop':'#new').tap();assert.equal(await page.getByText('Your saved reply',{exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'New conversation',exact:true}).count(),0);const starters=page.getByRole('navigation',{name:'Start with your Nexus',exact:true});await starters.waitFor();assert.equal(await starters.getByRole('button').count(),4);
 await starters.getByRole('button',{name:'Calendar',exact:true}).tap();const card=page.locator('.simple-workspace-card');await card.getByRole('button',{name:'Month',exact:true}).tap();await card.getByRole('button',{name:'Day',exact:true}).tap();await card.locator('.lc-block').first().waitFor();const moved=page.waitForResponse(response=>response.url().includes('/api/planner')&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='update');await card.locator('.lc-block').first().press('ArrowDown');await card.locator('.lc-block').first().press('Enter');await moved;const savedEvents=await fixture.schedule.listPlannerItems({},account.scheduleUserId);assert.ok(Date.parse(savedEvents.find(item=>item.id===event.id).starts_at)>Date.parse(event.starts_at));
 if(width===393&&shell==='workspace.html')await page.screenshot({path:'/workspace/scratch/9f0ce6cc8c12/simple-interactive-calendar.png',fullPage:true});
 await starters.getByRole('button',{name:'Reminders',exact:true}).tap();await card.getByRole('button',{name:'Complete Bring water',exact:true}).tap();await card.getByRole('button',{name:'Complete Bring water',exact:true}).waitFor({state:'hidden'});assert.equal((await fixture.reminders.list(account.scheduleUserId)).find(item=>item.id===reminder.id).status,'done');
 await starters.getByRole('button',{name:'Projects',exact:true}).tap();const frame=card.frameLocator('iframe');await frame.getByRole('heading',{name:'Saved Bodyweight Studio',exact:true}).waitFor();await frame.getByRole('button',{name:'Start set',exact:true}).tap();await frame.getByText('Set running',{exact:true}).waitFor();assert.equal(await card.locator('iframe').getAttribute('sandbox'),'allow-scripts allow-forms');
 assert.equal(await page.getByText('Your saved reply',{exact:true}).count(),0);await starters.getByRole('button',{name:'Life',exact:true}).tap();await card.locator('.nexuslife').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await menu('New conversation');assert.equal(await page.getByText('Your saved reply',{exact:true}).count(),0);
 await menu('Workout planning');await page.getByText('Your saved reply',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Open workspace menu',exact:true}).waitFor();assert.equal(await page.getByText('Your saved reply',{exact:true}).count(),0);
 await menu('Workout planning');await page.getByText('Your saved reply',{exact:true}).waitFor();
 await menu('Settings');await page.getByLabel('Choose your view on this device',{exact:true}).selectOption('workspace');await page.getByRole('button',{name:'Save view',exact:true}).tap();await page.getByRole('button',{name:/^More/}).waitFor();assert.deepEqual(errors,[]);await context.close();
 }assert.ok(reads>0);console.log('Owner/customer 320/393px: fresh entry/new chat, sidebar recents, live Calendar views, actual Reminder completion persistence, actual saved-project script interaction, safe-area taps, reload, Settings and overflow passed. Isolated stores; no pods/model calls.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
