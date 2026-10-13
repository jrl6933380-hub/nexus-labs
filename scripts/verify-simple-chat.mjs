import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const publicRoot=new URL('../public/',import.meta.url);
let reads=0,fail=false;
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');try{
 if(url.pathname.startsWith('/api/')){
  let data={};
  if(url.pathname==='/api/nexus-auth')data={ok:true};
  if(url.pathname==='/api/room-auth')data={username:'pilot'};
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
 const context=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,timezoneId:'America/Chicago'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=`http://127.0.0.1:${server.address().port}/${shell}`;
 await page.goto(base);await page.getByRole('button',{name:'Simple chat',exact:true}).waitFor();
 await page.getByRole('button',{name:'Simple chat',exact:true}).tap();await page.getByText('Your saved reply',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Agenda',exact:true}).tap();await page.getByRole('button',{name:/Saved workout/}).waitFor();assert.equal(await page.getByText('Your saved reply',{exact:true}).count(),1);
 if(width===393&&shell==='workspace.html')await page.screenshot({path:'/workspace/scratch/9f0ce6cc8c12/simple-chat-check.png',fullPage:true});
 await page.getByRole('button',{name:'Reminders',exact:true}).first().tap();await page.getByRole('button',{name:/Bring water/}).waitFor();
 await page.getByRole('button',{name:'Projects',exact:true}).first().tap();await page.getByRole('button',{name:/Saved studio/}).waitFor();
 fail=true;await page.getByRole('button',{name:'Agenda',exact:true}).tap();await page.getByText('Schedule unavailable',{exact:true}).waitFor();fail=false;await page.getByRole('button',{name:'Try again',exact:true}).tap();await page.getByRole('button',{name:/Saved workout/}).waitFor();
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(overflow.scroll<=overflow.width,JSON.stringify({shell,...overflow}));
 await page.reload();await page.getByRole('button',{name:'Current view',exact:true}).waitFor();await page.getByText('Your saved reply',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Current view',exact:true}).tap();await page.getByRole('button',{name:'Simple chat',exact:true}).waitFor();assert.equal(await page.locator('.simple-chat-tools>button:not(.simple-view-toggle):visible').count(),0);
 await page.reload();await page.getByRole('button',{name:'Simple chat',exact:true}).waitFor();assert.deepEqual(errors,[]);await context.close();
 }assert.ok(reads>0);console.log('Owner and customer shells: saved conversation, real read cards, error/retry, preference reload, Workspace switch, and mobile overflow verified at 320/393px. Fixtures only; no model calls.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
