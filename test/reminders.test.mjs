import test from 'node:test';
import assert from 'node:assert/strict';
import {createReminderStore} from '../lib/reminders.js';
import {createPlannerStore} from '../lib/planner.js';
import {createRemindersHandler} from '../api/board.js';
import {reminderMatches,dueReminderAlerts,renderReminders} from '../public/reminders.js';
function fixture(){
  const hashes=new Map();let sequence=0;
  const command=async([verb,key,...args])=>{
    const hash=hashes.get(key) || new Map();hashes.set(key,hash);
    if(verb==='HSET'){for(let i=0;i<args.length;i+=2)hash.set(args[i],args[i+1]);return 1;}
    if(verb==='HGET')return hash.get(args[0]) || null;
    if(verb==='HGETALL')return [...hash].flat();
    if(verb==='HDEL')return hash.delete(args[0]) ? 1 : 0;
    throw new Error(`Unexpected command ${verb}`);
  };
  const planner=createPlannerStore({command,idFactory:()=>`block-${++sequence}`});
  return {planner,store:createReminderStore({command,planner,idFactory:()=>`reminder-${++sequence}`})};
}
test('reminders support undated capture and partial notes edits without accepting a client supplied link',async()=>{
  const {store}=fixture();const item=await store.create({title:' Groceries ',schedule_id:'someone-else'},'room:a');
  assert.equal(item.title,'Groceries');assert.equal(item.due_date,null);assert.equal(item.schedule_id,null);
  const updated=await store.update({id:item.id,notes:'Milk'},'room:a');assert.equal(updated.title,'Groceries');assert.equal(updated.notes,'Milk');
  await assert.rejects(store.update({id:item.id,title:'Hijacked'},'room:b'),/not found/);
  assert.deepEqual(await store.list('room:b'),[]);
  await assert.rejects(store.create({title:'x',due_date:'2026-02-30'},'room:a'),/valid reminder date/);
});
test('reserving a reminder reuses its block, rejects overlaps, and completion syncs in both directions',async()=>{
  const {store,planner}=fixture(),user='room:a';const item=await store.create({title:'Call family'},user);
  const input={id:item.id,starts_at:'2026-10-05T09:00:00Z',ends_at:'2026-10-05T09:30:00Z'};
  const preview=await store.schedule(input,user);assert.equal(preview.conflicts.length,0);assert.equal((await planner.listPlannerItems({},user)).length,0);
  await store.schedule({...input,apply:true},user);await store.schedule({...input,starts_at:'2026-10-05T10:00:00Z',ends_at:'2026-10-05T10:30:00Z',apply:true},user);
  let blocks=await planner.listPlannerItems({},user);assert.equal(blocks.length,1);assert.equal(blocks[0].starts_at,'2026-10-05T10:00:00.000Z');
  await planner.createPlannerItem({title:'Protected work',starts_at:'2026-10-05T09:00:00Z',ends_at:'2026-10-05T10:00:00Z',protected:true},user);
  await assert.rejects(store.schedule({...input,apply:true},user),/taken/);
  const reserved=blocks[0];await planner.updatePlannerItem({id:reserved.id,protected:true,flexibility:'fixed',category:'family'},user);
  await store.schedule({...input,starts_at:'2026-10-05T10:00:00Z',ends_at:'2026-10-05T10:30:00Z',apply:true},user);
  assert.equal((await planner.listPlannerItems({},user)).find(block=>block.id===reserved.id).protected,true);
  assert.equal((await planner.listPlannerItems({},user)).find(block=>block.id===reserved.id).flexibility,'fixed');
  await store.update({id:item.id,status:'done'},user);blocks=await planner.listPlannerItems({},user);assert.equal(blocks.find(block=>block.source_id===item.id).status,'done');
  await store.update({id:item.id,status:'planned'},user);const linked=blocks.find(block=>block.source_id===item.id);
  await planner.updatePlannerItem({id:linked.id,status:'done'},user);assert.equal((await store.list(user))[0].status,'done');
  await store.update({id:item.id,notes:'New notes'},user);assert.equal((await store.list(user))[0].status,'done');
  await assert.rejects(store.remove(item.id,'room:b'),/not found/);
  await store.remove(item.id,user);assert.equal((await planner.listPlannerItems({},user)).length,1);
});
test('Today includes overdue reminders; undated and completed records keep distinct views and alerts',()=>{
  const undated={id:'a',status:'planned'},overdue={id:'b',status:'planned',due_date:'2026-10-02'},future={id:'c',status:'planned',due_date:'2026-10-04'};
  assert.equal(reminderMatches(undated,'today','2026-10-03'),false);assert.equal(reminderMatches(undated,'all','2026-10-03'),true);
  assert.equal(reminderMatches(overdue,'today','2026-10-03'),true);assert.equal(reminderMatches(future,'upcoming','2026-10-03'),true);
  assert.equal(reminderMatches({...overdue,status:'done'},'all','2026-10-03'),false);
  const timed={...overdue,due_at:'2026-10-03T14:00:00Z'},now=Date.parse('2026-10-03T14:05:00Z');
  assert.deepEqual(dueReminderAlerts([timed,{...timed,id:'done',status:'done'}],now,new Set()),[timed]);
  assert.deepEqual(dueReminderAlerts([timed],now,new Set([`${timed.id}:${timed.due_at}`])),[]);
});
test('Reminders HTTP routes enforce authentication and derive account scope on the server',async()=>{
  const calls=[],response=()=>({setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
  const store={list:async user=>{calls.push(user);return [];},create:async(input,user)=>{calls.push(user);return input;}};
  const denied=createRemindersHandler({getOwner:async()=>null,getUser:async()=>null,store}),res=response();await denied({method:'GET'},res);assert.equal(res.code,401);assert.equal(calls.length,0);
  const customer=createRemindersHandler({getOwner:async()=>null,getUser:async()=> 'customer',store});await customer({method:'POST',body:{action:'create',title:'x',userId:'owner:admin'}},response());assert.equal(calls[0],'room:customer');
  const owner=createRemindersHandler({getOwner:async()=>({id:'justin'}),getUser:async()=>{throw Error('must not run');},store});await owner({method:'GET'},response());assert.equal(calls[1],'owner:justin');
});
function element(tag){return {tagName:tag,children:[],attrs:{},className:'',value:'',setAttribute(k,v){this.attrs[k]=v;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},focus(){}};}
const all=root=>[root,...root.children.flatMap(all)];
test('quick capture saves without forcing a date; completion targets the exact reminder',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch;const requests=[];let items=[];
  globalThis.document={createElement:element};globalThis.fetch=async(url,options)=>{if(options?.method==='POST'){const body=JSON.parse(options.body);requests.push(body);if(body.action==='create')items=[{id:'saved',title:body.title,status:'planned'}];else items[0].status=body.status;}return {ok:true,json:async()=>({items})};};
  try{
    const root=await renderReminders({ask(){}});const form=all(root).find(node=>node.className==='reminderquick');form.children[0].value='Buy milk';await form.onsubmit({preventDefault(){}});
    assert.deepEqual(requests[0],{action:'create',title:'Buy milk'});
    const complete=all(root).find(node=>node.attrs['aria-label']==='Complete Buy milk');await complete.onclick();assert.deepEqual(requests[1],{action:'update',id:'saved',status:'done'});
  }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('Find time disables overlapping starts and reserves an adjacent open interval',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch;const requests=[];
  const day=new Date(),today=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
  const start=new Date(day);start.setHours(9,0,0,0);
  const block={id:'work',title:'Work',starts_at:start.toISOString(),ends_at:new Date(+start+3600000).toISOString(),status:'planned'};
  const item={id:'call',title:'Call family',status:'planned',due_date:today};
  globalThis.document={createElement:tag=>{const el=element(tag);Object.defineProperties(el,{options:{get(){return this.children;}},selectedOptions:{get(){return this.children.filter(child=>child.value===this.value);}}});return el;}};
  globalThis.fetch=async(url,options)=>{if(options?.method==='POST')requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({items:url==='/api/planner' ? [block] : [item]})};};
  try{
    const root=await renderReminders({ask(){}});await all(root).find(node=>node.textContent==='Find time for this').onclick();
    const select=all(root).find(node=>node.attrs['aria-label']==='Start time');
    assert.equal(select.options.find(option=>option.value==='540').disabled,true);
    assert.equal(select.options.find(option=>option.value==='570').disabled,true);
    assert.equal(select.options.find(option=>option.value==='600').disabled,false);
    select.value='600';select.onchange();const form=all(root).find(node=>node.className==='reminderform');await form.onsubmit({preventDefault(){}});
    assert.equal(requests[0].id,'call');assert.equal(requests[0].apply,true);assert.equal(Date.parse(requests[0].ends_at)-Date.parse(requests[0].starts_at),30*60000);
  }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});
