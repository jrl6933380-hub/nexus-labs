import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const html=await readFile(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const bridge of ['openai','mcp']){
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 let failure=false,running=true,reads=0;
 const shot=(await page.screenshot({type:'jpeg'})).toString('base64');
 const workspace={account:{id:'justin',owner:true},projects:[],schedule:[],reminders:[],boards:[],ads:[],images:[],tracks:[],usage:{exempt:true},updated_at:new Date().toISOString()};
 const call=async(name,args)=>{
 calls.push({name,args});
 if(name==='read_nexus_workspace')return {structuredContent:workspace};
 if(name==='read_nexus_browser_frame'){reads++;return failure?{isError:true,structuredContent:{error:'Viewer temporarily unavailable'}}:{structuredContent:{running,shot:running?shot:null,title:'Example page',url:'https://example.com',pending_login:{platform:'tiktok'}}};}
 return {structuredContent:{ok:true}};
 };
 await page.exposeFunction('boardTool',call);
 await page.addInitScript(({bridge})=>{
 if(bridge==='openai')window.openai={callTool:(n,a)=>window.boardTool(n,a),setWidgetState(){}};
 else window.addEventListener('message',async e=>{const m=e.data;if(!m?.id||!m.method)return;let result;if(m.method==='ui/initialize')result={hostContext:{}};else if(m.method==='tools/call')result=await window.boardTool(m.params.name,m.params.arguments);else return;window.postMessage({jsonrpc:'2.0',id:m.id,result},'*');});
 },{bridge});
 await page.route('https://board.test/**',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.goto('https://board.test');
 await page.getByRole('tab',{name:'Browser',exact:true}).click();
 await page.locator('#browser-image').waitFor({state:'visible'});
 assert.equal(await page.locator('#browser iframe').count(),0);
 for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.waitForFunction(()=>document.querySelector('#browser-image').naturalWidth>0);
 const img=page.locator('#browser-image'),box=await img.boundingBox();
 await img.click({position:{x:box.width/2,y:box.height/2}});
 await page.waitForFunction(()=>document.querySelector('#browser-status').textContent==='');
 const click=calls.find(c=>c.name==='click_nexus_browser');assert.ok(Math.abs(click.args.x-640)<=1);assert.ok(Math.abs(click.args.y-360)<=1);
 await page.locator('#browser-text').fill('hello');await page.locator('#browser-type button').click();
 await page.waitForFunction(()=>document.querySelector('#browser-status').textContent==='');
 assert.ok(calls.some(c=>c.name==='type_nexus_browser'&&c.args.text==='hello'));
 await page.locator('[data-browser-scroll="500"]').click();await page.waitForFunction(()=>document.querySelector('#browser-status').textContent==='');
 assert.ok(calls.some(c=>c.name==='scroll_nexus_browser'&&c.args.dy===500));
 await page.locator('#browser-approve').click();await page.waitForFunction(()=>document.querySelector('#browser-status').textContent==='');
 assert.ok(calls.some(c=>c.name==='approve_nexus_browser_login'&&c.args.platform==='tiktok'));
 failure=true;await page.locator('#browser-recheck').click();await page.getByText('Viewer temporarily unavailable',{exact:true}).waitFor();assert.equal(await img.isVisible(),true);
 failure=false;running=false;await page.locator('#browser-recheck').click();await page.getByText('Browser is off',{exact:true}).waitFor();assert.equal(await img.getAttribute('src'),null);
 await page.getByRole('tab',{name:'Projects',exact:true}).click();const before=reads;await page.waitForTimeout(2300);assert.equal(reads,before);
 assert.deepEqual(errors,[]);await page.close();console.log(bridge+': inline viewer, coordinates, typing, scroll, owner approval, retry, stopped state, mobile reflow and hidden-tab polling passed');
}
}finally{await browser.close();}
