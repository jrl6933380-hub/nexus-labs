import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const publicRoot=new URL('../public/',import.meta.url);
let reads=0,fail=false,teamMode='working',answer=null;
function team(){const steps=[{id:'a',member_id:'atlas',name:'Atlas',role:'research',state:'returned',result:'Research ready',instruction:'Research workouts'},{id:'m',member_id:'mason',name:'Mason',role:'build',state:'working',instruction:'Build the page',updates:['Adding the timer and set tracking.']},{id:'v',member_id:'vera',name:'Vera',role:'review',state:'queued',instruction:'Review the result'}];let state='running';
 if(teamMode==='question'){state='waiting_input';Object.assign(steps[1],{state:'waiting_input',question:{id:'question-one',question:'Which timer length do you want?',options:['30 seconds','45 seconds']}});}
 if(['completed','preview'].includes(teamMode)){state='completed';Object.assign(steps[1],{state:'returned',result:'```html\n<!doctype html><html><body><h1>Bodyweight Studio</h1></body></html>\n```',saved_project:{build_id:'project-one'}});if(teamMode==='preview')delete steps[1].saved_project;steps[2].state='returned';steps[2].result='Review completed';}
 return {group:{id:'nex-main',kind:'nex',name:'Nex',available_members:[],member_ids:[],include_nex:true},runs:[{id:'run-one',goal:'Bodyweight Studio',message:'Build a workout page',state,steps,events:[]}]};}
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');try{
 if(url.pathname.startsWith('/api/')){
  let data={};
  if(url.pathname==='/api/nexus-auth')data={ok:true};
  if(url.pathname==='/api/room-auth')data={username:'pilot'};
  if(url.pathname==='/api/nexus-controls')data={account:{id:'owner:justin',exempt:true,plan:'plus'},preferences:{responseStyle:'balanced',accent:'gold'}};
  if(url.pathname==='/api/nexus-messages'){
   if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);if(input.action==='team_answer'){answer=input;teamMode='working';}data={ok:true};}
   else data=url.searchParams.has('group_id')?team():{specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:[]};
  }
  if(url.pathname==='/api/chat')data={threads:[],messages:[{role:'user',content:'Keep my conversation'},{role:'assistant',content:'Your saved reply'}]};
  if(url.pathname==='/api/room-assistant')data={turns:[{role:'user',text:'Keep my conversation'},{role:'assistant',text:'Your saved reply'}],message:'Your saved reply'};
  if(url.pathname==='/api/planner'){reads++;if(fail){res.statusCode=503;data={error:'Schedule unavailable'};}else data={items:[{id:'event-one',title:'Saved workout',starts_at:'2099-10-14T23:00:00Z',ends_at:'2099-10-14T23:45:00Z',status:'planned'}]};}
  if(url.pathname==='/api/reminders')data={items:[{id:'rem-one',title:'Bring water',due_date:'2099-10-14',due_at:'2099-10-14T22:30:00Z',status:'planned'}]};
  if(url.pathname==='/api/room-history')data={projects:[{id:'project-one',title:'Saved studio',status:'draft'}]};
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));
 }
 if(url.pathname.startsWith('/_vercel/'))return res.end('');
 const path=url.pathname==='/'?'workspace.html':url.pathname.slice(1);
 res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'text/javascript');res.end(await readFile(new URL(path,publicRoot)));
 }catch{res.statusCode=404;res.end('');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.NEXUS_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{for(const shell of ['workspace.html','nexus.html'])for(const width of [320,393]){
 teamMode='working';answer=null;
 const context=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,timezoneId:'America/Chicago'});const page=await context.newPage();await page.addInitScript(()=>{document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.setProperty('--nexus-safe-area-top','59px');const status=document.createElement('div');status.id='iphone-status-area';status.style.cssText='position:fixed;top:0;left:0;right:0;height:59px;z-index:99999;background:#0b1410;pointer-events:auto';document.body.append(status);});});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=`http://127.0.0.1:${server.address().port}/${shell}`;
 await page.goto(base);assert.equal(await page.locator('.simple-chat-tools').count(),0);
 await page.getByRole('button',{name:/^More/}).tap();await page.getByRole('button',{name:shell==='workspace.html'?/^Account & Controls/:/^Settings/}).tap();
 await page.getByLabel('Choose your view on this device',{exact:true}).selectOption('simple');await page.getByRole('button',{name:'Save view',exact:true}).tap();await page.getByText('Your saved reply',{exact:true}).waitFor();
 const menuBounds=await page.getByRole('button',{name:'Open workspace menu',exact:true}).boundingBox();assert.ok(menuBounds.y>=75,JSON.stringify(menuBounds));
 assert.equal(await page.getByRole('button',{name:'Current view',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Simple chat',exact:true}).count(),0);
 if(shell==='workspace.html'){
  await page.getByText('Your team is working',{exact:true}).waitFor();assert.equal(await page.locator('.simple-team-details').getAttribute('open'),null);
  await page.getByRole('button',{name:'See Mason’s work',exact:true}).tap();await page.getByText('Build the page',{exact:true}).waitFor();await page.locator('.simple-team-details>summary').tap();
 }
 const menu=async name=>{await page.getByRole('button',{name:'Open workspace menu',exact:true}).tap();await page.getByRole('dialog',{name:'Your Nexus workspace'}).getByRole('button',{name,exact:true}).tap();};
 await menu('Calendar');await page.getByRole('button',{name:/Saved workout/}).waitFor();assert.equal(await page.getByText('Your saved reply',{exact:true}).count(),1);
 if(width===393&&shell==='workspace.html')await page.screenshot({path:'/workspace/scratch/9f0ce6cc8c12/simple-chat-polish.png',fullPage:true});
 await page.locator('.simple-workspace-card').getByRole('button',{name:'Open',exact:true}).tap();await page.getByRole('button',{name:'Open workspace menu',exact:true}).tap();await page.getByRole('dialog').getByRole('button',{name:'Conversation',exact:true}).tap();await page.getByText('Your saved reply',{exact:true}).waitFor();
 await menu('Reminders');await page.getByRole('button',{name:/Bring water/}).waitFor();await menu('Projects');await page.getByRole('button',{name:/Saved studio/}).waitFor();
 fail=true;await menu('Calendar');await page.getByText('Schedule unavailable',{exact:true}).waitFor();fail=false;await page.getByRole('button',{name:'Try again',exact:true}).tap();await page.getByRole('button',{name:/Saved workout/}).waitFor();
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(overflow.scroll<=overflow.width,JSON.stringify({shell,...overflow}));
 await page.goto(base+'?view=messages');await page.getByText('Your saved reply',{exact:true}).waitFor();assert.equal(await page.locator('body[data-view=chat].simple-chat').count(),1);assert.equal(await page.locator('.homespacegrid').count(),0);
 if(shell==='workspace.html'){await page.locator('#newTop').tap();await page.getByRole('button',{name:'Back to Messages',exact:true}).tap();await page.getByText('Your saved reply',{exact:true}).waitFor();assert.equal(await page.locator('body[data-view=chat].simple-chat').count(),1);}
 await page.goBack();await page.getByRole('button',{name:'Open workspace menu',exact:true}).waitFor();await page.getByText('Your saved reply',{exact:true}).waitFor();assert.equal(await page.locator('body[data-view=chat].simple-chat').count(),1);
 await page.reload();await page.getByRole('button',{name:'Open workspace menu',exact:true}).waitFor();await page.getByText('Your saved reply',{exact:true}).waitFor();
 if(shell==='workspace.html'){
  teamMode='question';await page.reload();await page.getByLabel('Which timer length do you want?',{exact:true}).waitFor();await page.getByRole('button',{name:'45 seconds',exact:true}).tap();await page.waitForFunction(()=>!document.querySelector('.teamquestion'));assert.equal(answer.answer,'45 seconds');assert.equal(answer.run_id,'run-one');
  teamMode='preview';await page.reload();await page.getByRole('button',{name:'Preview build',exact:true}).tap();await page.locator('.teamvisual').waitFor({state:'visible'});assert.equal(await page.locator('.teamvisual').getAttribute('sandbox'),'');
  teamMode='completed';await page.reload();await page.getByRole('link',{name:'Open saved build',exact:true}).waitFor();assert.match(await page.getByRole('link',{name:'Open saved build',exact:true}).getAttribute('href'),/build=project-one/);
 }
 await menu('Settings');await page.getByLabel('Choose your view on this device',{exact:true}).selectOption('workspace');await page.getByRole('button',{name:'Save view',exact:true}).tap();await page.getByRole('button',{name:/^More/}).waitFor();assert.equal(await page.getByRole('button',{name:'Open workspace menu',exact:true}).isVisible(),false);
 await page.reload();assert.equal(await page.locator('body.simple-chat').count(),0);assert.deepEqual(errors,[]);await context.close();
 }assert.ok(reads>0);console.log('Owner/customer 320/393px: iPhone status-area taps, Back/deep-link mode retention, Settings-only preference, clean chat, menu/cards, retry, reload, compact real team progress, answer/resume, saved preview, and overflow passed. Local fixtures; no model/pod calls.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
