import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMessages} from '../public/nexus-messages.js';
import {enableNotifications,pushSupport} from '../public/push-notifications.js';

const all=root=>[root,...root.children.flatMap(all)];
function element(tag){return {tagName:tag,children:[],attrs:{},className:'',setAttribute(k,v){this.attrs[k]=v;},append(...nodes){this.children.push(...nodes);},prepend(...nodes){this.children.unshift(...nodes);},replaceChildren(...nodes){this.children=nodes;},querySelector(selector){return all(this).find(el=>el.className.split(' ').includes(selector.slice(1)));}};}

test('opening More with a tap event shows no banner; pinning still shows its confirmation',async()=>{
 const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
 globalThis.document={createElement:element,body:{classList:{add(){},remove(){}}}};
 const state={specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:['planner']};
 globalThis.fetch=async(url,options)=>({ok:true,json:async()=>options?.method==='POST'?{pinned_system_ids:JSON.parse(options.body).pinned_system_ids}:state});
 try{
  const root=await renderMessages({recentThreads:()=>[]});
  const more=all(root).find(el=>el.tagName==='button'&&all(el).some(child=>child.textContent==='More'));
  more.onclick({type:'click',toString:()=> '[object PointerEvent]'});
  assert.equal(all(root).some(el=>el.className==='uxfeedback'),false);
  await all(root).find(el=>el.attrs['aria-label']==='Unpin Life & Schedule').onclick({type:'click'});
  assert.equal(all(root).find(el=>el.className==='uxfeedback').textContent,'Life & Schedule removed from Messages.');
  all(root).find(el=>el.textContent==='‹').onclick({type:'click'});
  all(root).find(el=>el.tagName==='button'&&all(el).some(child=>child.textContent==='More')).onclick({type:'click'});
  assert.equal(all(root).some(el=>el.className==='uxfeedback'),false);
 }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('the living home keeps agents inside Nex and surfaces real project and attention signals',async()=>{
 const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
 globalThis.document={createElement:element,body:{classList:{add(){},remove(){}}}};
 const state={specialists:[{id:'agent-mason',name:'Mason',role:'build',job:'Build approved projects.'}],groups:[],roles:{build:{label:'Builder'}},scopes:[],pinned_system_ids:[],specialist_status:{'agent-mason':'Needs attention'}};
 globalThis.fetch=async(url)=>({ok:true,json:async()=>String(url).includes('room-history')?{projects:[{projectId:'garden',label:'Garden site'}]}:state});
 try{
  const root=await renderMessages({recentThreads:()=>[]});
  assert.equal(all(root).some(el=>el.className==='messageagents'),false);
  assert.equal(all(root).some(el=>el.textContent==='Garden site'),true);
  assert.equal(all(root).some(el=>el.textContent==='1 needs you'),true);
  const nex=all(root).find(el=>el.tagName==='button'&&all(el).some(child=>child.textContent==='Nex'));
  nex.onclick();
  assert.equal(all(root).some(el=>el.textContent==='Your agents'),true);
  assert.equal(all(root).some(el=>el.textContent==='Mason'),true);
 }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('live spaces show every real project and team without turning an individual Atlas result into a team',async()=>{
 const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
 globalThis.document={createElement:element,body:{classList:{add(){},remove(){}}}};
 const state={specialists:[{id:'agent-atlas',name:'Atlas',role:'research',job:'Research'}],groups:[{id:'group-launch',title:'Launch team',member_ids:['agent-atlas'],include_nex:true}],roles:{research:{label:'Research'}},scopes:[],pinned_system_ids:[],specialist_status:{'agent-atlas':'Result ready'},team_status:{'group-launch':'Active'}};
 globalThis.fetch=async(url)=>({ok:true,json:async()=>String(url).includes('room-history')?{projects:[{projectId:'garden',label:'Garden site',versionCount:3,stackItems:[{id:'services'}],liveUrl:'https://garden.example',updatedAt:Date.now()},{projectId:'studio',label:'Story studio',versionCount:1,stackItems:[],updatedAt:Date.now()}],workbench:{count:2,limit:10,planName:'Plus',canCreate:true}}:String(url).includes('/api/life')?{items:[{id:'walk',title:'Evening walk',status:'planned',starts_at:`${new Date().toISOString().slice(0,10)}T18:00:00.000Z`,ends_at:`${new Date().toISOString().slice(0,10)}T19:00:00.000Z`,pillar:'health'}],pulses:[],summary:{unconfirmed:1}}:String(url).includes('/api/planner')||String(url).includes('/api/reminders')?{items:[]}:state});
 try{
  const root=await renderMessages({recentThreads:()=>[],go(){}}),text=all(root).map(el=>el.textContent).filter(Boolean);
  assert.ok(text.includes('Live spaces'));assert.ok(text.includes('Garden site'));assert.ok(text.includes('Story studio'));
  assert.ok(text.includes('3 versions · 2 pieces'));assert.ok(text.includes('Launch team'));assert.ok(text.includes('Atlas · Nex'));
  assert.ok(text.includes('Create a team'));assert.ok(text.includes('Now & next'));
  assert.equal(text.includes('Team result'),false);
  assert.equal(all(root).find(el=>el.className.includes('homecards')).attrs['data-project-usage'],'2/10');
 }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('iPhone Safari explains installation while the installed app can request push',()=>{
 const windowObject={isSecureContext:true,Notification:{},PushManager:{},matchMedia:()=>({matches:false})};
 const navigatorObject={userAgent:'iPhone',serviceWorker:{}};
 assert.equal(pushSupport({windowObject,navigatorObject}),'install-required');
 assert.equal(pushSupport({windowObject,navigatorObject:{...navigatorObject,standalone:true}}),'supported');
});

test('notification permission is requested before the first network await',async()=>{
 const names=['window','navigator','Notification','fetch'],saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]),calls=[];
 const subscription={toJSON:()=>({endpoint:'https://web.push.apple.com/device'})};
 const registration={pushManager:{getSubscription:async()=>subscription}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:true,Notification:{},PushManager:{}}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'iPhone',standalone:true,serviceWorker:{getRegistration:async()=>({...registration,active:{}}),ready:Promise.resolve(registration)}}});
 Object.defineProperty(globalThis,'Notification',{configurable:true,value:{requestPermission:()=>{calls.push('permission');return Promise.resolve('granted');}}});
 globalThis.fetch=async()=>{calls.push('network');return {ok:true,json:async()=>({configured:true,publicKey:'public'})};};
 try{await enableNotifications();assert.equal(calls[0],'permission');assert.equal(calls.filter(x=>x==='network').length,3);}
 finally{for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
