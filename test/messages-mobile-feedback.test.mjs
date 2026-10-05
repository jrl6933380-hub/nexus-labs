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
  await all(root).find(el=>el.attrs['aria-label']==='Unpin Schedule').onclick({type:'click'});
  assert.equal(all(root).find(el=>el.className==='uxfeedback').textContent,'Schedule removed from Messages.');
  all(root).find(el=>el.textContent==='‹').onclick({type:'click'});
  all(root).find(el=>el.tagName==='button'&&all(el).some(child=>child.textContent==='More')).onclick({type:'click'});
  assert.equal(all(root).some(el=>el.className==='uxfeedback'),false);
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
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'iPhone',standalone:true,serviceWorker:{ready:Promise.resolve(registration)}}});
 Object.defineProperty(globalThis,'Notification',{configurable:true,value:{requestPermission:()=>{calls.push('permission');return Promise.resolve('granted');}}});
 globalThis.fetch=async()=>{calls.push('network');return {ok:true,json:async()=>({configured:true,publicKey:'public'})};};
 try{await enableNotifications();assert.equal(calls[0],'permission');assert.equal(calls.filter(x=>x==='network').length,3);}
 finally{for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
