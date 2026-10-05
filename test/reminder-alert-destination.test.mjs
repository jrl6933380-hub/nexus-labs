import test from 'node:test';
import assert from 'node:assert/strict';
import {startReminderAlerts} from '../public/reminders.js';
function element(tag){return {tagName:tag,children:[],setAttribute(){},append(...nodes){this.children.push(...nodes);},get lastChild(){return this.children.at(-1);},remove(){}};}
test('due reminders do not prompt navigation at their destination but still alert elsewhere',async()=>{
 const saved={document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 let poll,active=true,opened=0;const toasts=[];
 globalThis.document={visibilityState:'visible',querySelector:()=>null,createElement:element,body:{append:el=>toasts.push(el)}};
 globalThis.setInterval=fn=>{poll=fn;return 1;};globalThis.clearInterval=()=>{};
 let items=[{id:'one',due_at:new Date(Date.now()-1000).toISOString(),title:'First',status:'planned'}];
 globalThis.fetch=async()=>({ok:true,json:async()=>({items})});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  const stop=startReminderAlerts(()=>opened++,{isDestinationActive:()=>active});await flush();assert.equal(toasts.length,0);
  active=false;await poll();assert.equal(toasts.length,0,'already-seen due items stay acknowledged');
  items.push({id:'two',due_at:new Date(Date.now()-500).toISOString(),title:'Second',status:'planned'});
  await poll();assert.equal(toasts.length,1);assert.equal(toasts[0].children[0].textContent,'Second');
  toasts[0].lastChild.onclick();assert.equal(opened,1);stop();
 }finally{Object.assign(globalThis,saved);}
});
