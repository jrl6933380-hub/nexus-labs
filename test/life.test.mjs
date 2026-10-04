import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifeStore,summarizeLife} from '../lib/life.js';
import {createPlannerStore} from '../lib/planner.js';
import {createReminderStore} from '../lib/reminders.js';
import {createLifeHandler} from '../api/board.js';
import {renderLife,lifeWeekItems,copyLifeTimes} from '../public/life.js';
function fixture(){const hashes=new Map();let id=0,time=1000;const command=async([verb,key,...args])=>{const hash=hashes.get(key) || new Map();hashes.set(key,hash);if(verb==='HSET'){for(let i=0;i<args.length;i+=2)hash.set(args[i],args[i+1]);return 1;}if(verb==='HGET')return hash.get(args[0]) || null;if(verb==='HGETALL')return [...hash].flat();if(verb==='HDEL')return hash.delete(args[0]) ? 1 : 0;throw Error(verb);};const now=()=>++time;const planner=createPlannerStore({command,now,idFactory:()=>`block-${++id}`}),reminders=createReminderStore({command,planner,now,idFactory:()=>`reminder-${++id}`});return {planner,reminders,life:createLifeStore({command,planner,reminders,now,idFactory:()=>`life-${++id}`})};}
const activity={title:'Walk',pillar:'health',kind:'activity',starts_at:'2026-10-05T15:00:00Z',ends_at:'2026-10-05T16:00:00Z'};
async function save(life,input,user='room:a',destination='life'){const preview=await life.preview(input,user);return life.save({...preview.item,baseline:preview.baseline,destination},user);}
test('Life owns private records and profiles without automatically importing or linking Nex',async()=>{
  const {life,planner}=fixture();await planner.createPlannerItem({title:'Nex only',starts_at:'2026-10-05T09:00:00Z'},'room:a');
  const item=await save(life,activity);assert.equal(item.link,null);assert.equal((await planner.listPlannerItems({},'room:a')).length,1);
  await life.profile('room:a',{focus:['health','social'],goals:'More outdoors'});assert.equal((await life.overview('room:a')).items.length,1);assert.equal((await life.overview('room:b')).items.length,0);
  assert.deepEqual((await life.profile('room:b')).focus,[]);await assert.rejects(life.profile('room:a',{focus:['invalid']}),/valid priorities/);
});
test('previewed links reject conflicts and stale approvals; repeated edits reuse one block',async()=>{
  const {life,planner}=fixture();const block=await planner.createPlannerItem({title:'Work',starts_at:activity.starts_at,ends_at:activity.ends_at,protected:true},'room:a');
  const preview=await life.preview(activity,'room:a');assert.equal(preview.conflicts[0].title,'Work');await assert.rejects(life.save({...preview.item,baseline:preview.baseline,destination:'linked'},'room:a'),/conflicts/);
  await planner.deletePlannerItem(block.id,'room:a');await assert.rejects(life.save({...preview.item,baseline:preview.baseline,destination:'linked'},'room:a'),/changed/);
  let item=await save(life,activity,'room:a','linked');assert.equal((await planner.listPlannerItems({},'room:a')).length,1);
  item=await save(life,{...item,title:'Long walk',ends_at:'2026-10-05T16:30:00Z'},'room:a','linked');assert.equal((await planner.listPlannerItems({},'room:a')).length,1);
  assert.equal((await planner.listPlannerItems({},'room:a'))[0].title,'Long walk');
  await save(life,item,'room:a','life');assert.equal((await planner.listPlannerItems({},'room:a')).length,0);
});
test('Life reminders stay separate unless linked, reuse their Nex record and share completion',async()=>{
  const {life,reminders}=fixture();let item=await save(life,{title:'Call family',kind:'reminder',pillar:'social'});assert.equal((await reminders.list('room:a')).length,0);
  item=await save(life,item,'room:a','linked');await save(life,{...item,notes:'Ask about their week'},'room:a','linked');assert.equal((await reminders.list('room:a')).length,1);
  await life.checkIn({id:item.id,status:'done'},'room:a');assert.equal((await reminders.list('room:a'))[0].status,'done');
  await reminders.update({id:item.link.id,status:'planned'},'room:a');assert.equal((await life.overview('room:a')).items[0].status,'planned');
  await assert.rejects(life.remove(item.id,'room:b'),/not found/);await life.remove(item.id,'room:a');assert.equal((await reminders.list('room:a')).length,0);
});
test('planned time never becomes lived experience without a user confirmation',async()=>{
  const {life}=fixture();const item=await save(life,activity);let data=await life.overview('room:a');assert.equal(data.summary.accounted,0);assert.equal(data.summary.pillars.health.actual_minutes,0);
  await life.checkIn({id:item.id,use_planned_times:true,energy:4,reflection:'Felt good'},'room:a');data=await life.overview('room:a');assert.equal(data.summary.accounted,1);assert.equal(data.summary.pillars.health.actual_minutes,60);assert.equal(data.summary.pillars.health.energy_count,1);
  await assert.rejects(life.checkIn({id:item.id,energy:7},'room:a'),/energy rating/);
  await life.checkIn({id:item.id,outcome:'unknown',energy:null},'room:a');data=await life.overview('room:a');assert.equal(data.summary.pillars.health.actual_minutes,0);assert.equal(data.summary.pillars.health.energy_count,0);
});
test('Life HTTP authentication derives account scope and refuses unknown actions',async()=>{
  const calls=[],res=()=>({setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}}),store={overview:async user=>{calls.push(user);return {items:[]};}};
  const handler=createLifeHandler({getOwner:async()=>null,getUser:async()=> 'a',store});const response=res();await handler({method:'GET',query:{user:'owner:admin'}},response);assert.equal(calls[0],'room:a');
  const denied=createLifeHandler({getOwner:async()=>null,getUser:async()=>null,store});const reject=res();await denied({method:'GET'},reject);assert.equal(reject.code,401);
  const bad=res();await handler({method:'POST',body:{action:'invent'}},bad);assert.equal(bad.code,400);
});
function element(tag){return {tagName:tag,children:[],attrs:{},className:'',value:'',style:{setProperty(){}},classList:{toggle(){},add(){}},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},get childNodes(){return this.children;},focus(){},querySelector(){return null;}};}
const all=root=>[root,...root.children.flatMap(all)];
test('Life has its own calendar/reminders navigation and skippable onboarding',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch;const requests=[];
  globalThis.document={createElement:element};globalThis.fetch=async(url,options)=>{if(options?.method==='POST')requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({items:[],profile:{focus:[],goals:'',onboarded:false}})};};
  try{const root=await renderLife({ask(){}});assert.ok(all(root).find(el=>el.textContent==='Life calendar'));assert.ok(all(root).find(el=>el.textContent==='Life reminders'));await all(root).find(el=>el.textContent==='Skip for now').onclick();assert.deepEqual(requests[0],{action:'profile',focus:[]});}finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('Life reminders can reserve their own calendar time and link without duplicating blocks',async()=>{
  const {life,planner,reminders}=fixture();let item=await save(life,{title:'Call family',kind:'reminder',pillar:'social',due_date:'2026-10-05',due_at:'2026-10-05T14:00:00Z'});
  item=await save(life,{...item,starts_at:'2026-10-05T15:00:00Z',ends_at:'2026-10-05T15:30:00Z'});assert.equal((await planner.listPlannerItems({},'room:a')).length,0);
  assert.equal((await life.alerts('room:a')).length,1);
  item=await save(life,item,'room:a','linked');item=await save(life,{...item,ends_at:'2026-10-05T16:00:00Z'},'room:a','linked');
  assert.equal((await planner.listPlannerItems({},'room:a')).length,1);assert.equal((await reminders.list('room:a')).length,1);assert.equal((await life.alerts('room:a')).length,0);
  await life.checkIn({id:item.id,status:'done'},'room:a');assert.equal((await planner.listPlannerItems({},'room:a'))[0].status,'done');
  await save(life,{...item,notes:'Keep this note'},'room:a','linked');assert.equal((await reminders.list('room:a'))[0].status,'done');
});
test('week history includes sleep crossing into Monday and excludes the following week',()=>{
  const before=new Date(2026,9,4,23),after=new Date(2026,9,5,7),sleep={...activity,starts_at:before.toISOString(),ends_at:after.toISOString()};
  assert.equal(lifeWeekItems([sleep],new Date(2026,9,5)).length,1);
  assert.equal(lifeWeekItems([sleep],new Date(2026,9,12)).length,0);
});

test('a linked Nex reschedule updates Life and releases the old time in conflict previews',async()=>{
  const {life,planner}=fixture();const item=await save(life,activity,'room:a','linked');
  await planner.updatePlannerItem({id:item.link.id,starts_at:'2026-10-05T17:00:00Z',ends_at:'2026-10-05T18:00:00Z'},'room:a');
  assert.equal((await life.overview('room:a')).items[0].starts_at,'2026-10-05T17:00:00.000Z');
  const preview=await life.preview({...activity,title:'Another activity'},'room:a');assert.equal(preview.conflicts.length,0);
  await planner.deletePlannerItem(item.link.id,'room:a');assert.equal((await life.overview('room:a')).items[0].link_missing,true);
});

test('Life calendar reads its own endpoint and an activity is reviewed before the user saves it',async()=>{
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch,oldFrame=globalThis.requestAnimationFrame;const requests=[],{life,planner}=fixture();
  globalThis.document={createElement:element};globalThis.requestAnimationFrame=callback=>callback();
  globalThis.fetch=async(url,options)=>{
    requests.push({url,body:options?.body && JSON.parse(options.body)});let result;
    if(!options?.method)result=await life.overview('room:a');else{const {action,...input}=JSON.parse(options.body);result=await life[action](input,'room:a');}
    return {ok:true,json:async()=>result};
  };
  try{
    const root=await renderLife({ask(){}});await all(root).find(el=>el.textContent==='Life calendar').onclick();
    assert.ok(requests.some(request=>request.url.startsWith('/api/life?from=')));assert.equal(requests.some(request=>request.url.startsWith('/api/planner')),false);
    all(root).find(el=>el.textContent==='+ Plan an activity').onclick();
    all(root).find(el=>el.tagName==='label' && el.textContent==='What is it?').children[0].value='Walk';
    await all(root).find(el=>el.tagName==='form').onsubmit({preventDefault(){}});
    assert.ok(all(root).find(el=>el.textContent==='Does this look right?'));assert.equal((await life.overview('room:a')).items.length,0);
    await all(root).find(el=>el.textContent==='Keep in Life only').onclick();assert.equal((await life.overview('room:a')).items.length,1);assert.equal((await planner.listPlannerItems({},'room:a')).length,0);
  }finally{globalThis.document=oldDocument;globalThis.fetch=oldFetch;globalThis.requestAnimationFrame=oldFrame;}
});

test('saved check-ins are visible on Life cards and calendar blocks; quick choices preserve reflections and actual time',async()=>{
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch,oldFrame=globalThis.requestAnimationFrame;
  const {life}=fixture(),requests=[];const start=new Date();start.setHours(9,0,0,0);
  const item=await save(life,{...activity,starts_at:start.toISOString(),ends_at:new Date(+start+3600000).toISOString()});
  globalThis.document={createElement:element};globalThis.requestAnimationFrame=callback=>callback();
  globalThis.fetch=async(url,options)=>{
    let result;if(!options?.method)result=await life.overview('room:a');else{const {action,...input}=JSON.parse(options.body);requests.push({action,...input});result=await life[action==='check_in' ? 'checkIn' : action](input,'room:a');}
    return {ok:true,json:async()=>result};
  };
  try{
    const root=await renderLife({ask(){}});await all(root).find(el=>el.textContent==='Today').onclick();
    all(root).find(el=>el.textContent==='How was it?').onclick();
    const input=label=>all(root).find(el=>el.tagName==='label' && el.textContent===label).children[0];
    input('What happened?').value='happened';input('How did it feel?').value='5';
    all(root).find(el=>el.tagName==='label' && el.textContent.startsWith('Use the planned times')).children[0].checked=true;
    input('Reflection (optional)').value='A beautiful walk';
    await all(root).find(el=>el.tagName==='form').onsubmit({preventDefault(){}});
    assert.ok(all(root).find(el=>el.textContent==='It happened · 5/5 · Very energizing'));
    assert.ok(all(root).find(el=>el.textContent?.startsWith('Actual time:')));
    let card=all(root).find(el=>el.className==='lifeactivity');
    assert.equal(all(card).find(el=>el.tagName==='button' && el.textContent==='It happened').attrs['aria-pressed'],'true');
    await all(card).find(el=>el.textContent==='4 · Energizing').onclick();
    let saved=(await life.overview('room:a')).items[0];assert.equal(saved.energy,4);assert.equal(saved.reflection,'A beautiful walk');assert.equal(saved.actual_starts_at,start.toISOString());
    assert.deepEqual(requests.at(-1),{action:'check_in',id:item.id,energy:4});
    await all(root).find(el=>el.textContent==='Life calendar').onclick();await all(root).find(el=>el.textContent==='Day').onclick();await all(all(root).find(el=>el.className==='nexcalendar')).find(el=>el.textContent==='Today').onclick();
    let block=all(root).find(el=>el.className==='caltimed');assert.ok(block);
    assert.ok(all(block).find(el=>el.textContent==='It happened · 4/5 · Energizing'));
    assert.match(block.children[0].attrs['aria-label'],/It happened/);
    await all(block).find(el=>el.tagName==='button' && el.textContent==='Did not happen').onclick();
    block=all(root).find(el=>el.className==='caltimed');assert.ok(all(block).find(el=>el.textContent==='Did not happen · 4/5 · Energizing'));
    saved=(await life.overview('room:a')).items[0];assert.equal(saved.actual_starts_at,null);assert.equal(saved.reflection,'A beautiful walk');
    await all(block).find(el=>el.tagName==='button' && el.textContent==='It happened').onclick();
    saved=(await life.overview('room:a')).items[0];assert.equal(saved.outcome,'happened');assert.equal(saved.actual_starts_at,null);
    for(const control of all(root).filter(el=>el.tagName==='button'))assert.equal(all(control).slice(1).some(el=>el.tagName==='button'),false);
  }finally{globalThis.document=oldDocument;globalThis.fetch=oldFetch;globalThis.requestAnimationFrame=oldFrame;}
});

test('daily pulses are private, optional, editable by date, and never count as activity experience',async()=>{
  const {life}=fixture();await life.pulse({date:'2026-10-03',energy:2,note:'A slower day'},'room:a');
  await life.pulse({date:'2026-10-03',energy:4,note:'Feeling better'},'room:a');
  await life.pulse({date:'2026-10-04',energy:null,note:'Just a note'},'room:a');
  const data=await life.overview('room:a');assert.equal(data.pulses.length,2);assert.equal(data.pulses[1].energy,4);assert.equal(data.items.length,0);assert.equal(data.summary.accounted,0);
  assert.equal((await life.overview('room:b')).pulses.length,0);
  await assert.rejects(life.pulse({date:'2026-02-30',energy:3},'room:a'),/date/);await assert.rejects(life.pulse({date:'2026-10-03',energy:9},'room:a'),/energy/);
});
test('weekly reset previews before atomic save, copies clean experience, and prevents duplicate carry-forward',async()=>{
  const {life,planner}=fixture();const source=await save(life,activity,'room:a','linked');await life.checkIn({id:source.id,use_planned_times:true,energy:5,reflection:'Wonderful',memory_url:'https://example.com/photo'},'room:a');
  const entries=[{source_id:source.id,title:'Next week walk',starts_at:'2026-10-12T15:00:00Z',ends_at:'2026-10-12T16:00:00Z'}];
  const preview=await life.previewWeek({entries},'room:a');assert.equal((await life.overview('room:a')).items.length,1);assert.equal(preview.conflicts.length,0);
  await life.saveWeek({entries:preview.entries,baseline:preview.baseline},'room:a');const copied=(await life.overview('room:a')).items.find(item=>item.id!==source.id);
  assert.equal(copied.title,'Next week walk');assert.equal(copied.outcome,'unknown');assert.equal(copied.energy,null);assert.equal(copied.actual_starts_at,null);assert.equal(copied.reflection,'');assert.equal(copied.memory_url,'');assert.equal(copied.link,null);
  assert.equal((await planner.listPlannerItems({},'room:a')).length,1);
  const repeat=await life.previewWeek({entries},'room:a');assert.equal(repeat.items.length,0);assert.equal(repeat.already.length,1);await life.saveWeek({entries:repeat.entries,baseline:repeat.baseline},'room:a');assert.equal((await life.overview('room:a')).items.length,2);
  await assert.rejects(life.previewWeek({entries},'room:b'),/original/);
});
test('weekly reset rejects conflicts within draft, Life, and Nex, plus stale or edited approvals without partial writes',async()=>{
  const {life,planner}=fixture();const source=await save(life,activity),second=await save(life,{...activity,title:'Sleep',starts_at:'2026-10-05T20:00:00Z',ends_at:'2026-10-06T04:00:00Z'});
  const next={source_id:source.id,starts_at:'2026-10-12T15:00:00Z',ends_at:'2026-10-12T16:00:00Z'};
  let preview=await life.previewWeek({entries:[next,{...next,source_id:second.id}]},'room:a');assert.ok(preview.conflicts.length);await assert.rejects(life.saveWeek({entries:preview.entries,baseline:preview.baseline},'room:a'),/overlapping/);assert.equal((await life.overview('room:a')).items.length,2);
  preview=await life.previewWeek({entries:[next]},'room:a');await planner.createPlannerItem({title:'Protected work',starts_at:next.starts_at,ends_at:next.ends_at,protected:true},'room:a');
  await assert.rejects(life.saveWeek({entries:preview.entries,baseline:preview.baseline},'room:a'),/changed/);
  const conflict=await life.previewWeek({entries:[next]},'room:a');assert.ok(conflict.conflicts.some(item=>item.where==='Nex Schedule'));await assert.rejects(life.saveWeek({entries:conflict.entries,baseline:conflict.baseline},'room:a'),/overlapping/);
  const clear={...next,starts_at:'2026-10-12T17:00:00Z',ends_at:'2026-10-12T18:00:00Z'};preview=await life.previewWeek({entries:[clear]},'room:a');await assert.rejects(life.saveWeek({entries:[{...preview.entries[0],title:'Changed after review'}],baseline:preview.baseline},'room:a'),/changed/);
  await save(life,{...activity,title:'Life commitment',starts_at:clear.starts_at,ends_at:clear.ends_at});preview=await life.previewWeek({entries:[clear]},'room:a');assert.ok(preview.conflicts.some(item=>item.where==='Life'));
});
test('daily pulse, history, guided day changes, and relevant suggestions work without an activity planner',async()=>{
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch,oldFrame=globalThis.requestAnimationFrame,{life}=fixture(),prompts=[];
  const date=new Date(),day=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  globalThis.document={createElement:element};globalThis.requestAnimationFrame=callback=>callback();
  globalThis.fetch=async(url,options)=>{let result;if(!options?.method)result=await life.overview('room:a');else{const {action,...input}=JSON.parse(options.body);result=await life[action==='check_in' ? 'checkIn' : action](input,'room:a');}return {ok:true,json:async()=>result};};
  try{
    const root=await renderLife({ask:prompt=>prompts.push(prompt)});await all(root).find(el=>el.textContent==='Today').onclick();await all(root).find(el=>el.textContent==='2 · Low').onclick();
    assert.ok(all(root).find(el=>el.textContent==='Today: 2/5 · Low'));assert.ok(all(root).find(el=>el.textContent==='Plan a short pause'));
    const pulse=all(root).find(el=>el.className==='lifepulse');all(pulse).find(el=>el.tagName==='textarea').value='Need a quiet afternoon';await all(pulse).find(el=>el.textContent==='Save note').onclick();
    await all(root).find(el=>el.textContent==='Life history').onclick();assert.ok(all(root).find(el=>el.textContent?.includes('Need a quiet afternoon')));
    assert.equal((await life.overview('room:a')).pulses[0].date,day);
    all(root).find(el=>el.textContent==='My day changed').onclick();all(root).find(el=>el.textContent==='I am running late').onclick();assert.match(prompts[0],/Ask how late/);assert.match(prompts[0],/Protect fixed commitments/);assert.equal((await life.overview('room:a')).items.length,0);
  }finally{globalThis.document=oldDocument;globalThis.fetch=oldFetch;globalThis.requestAnimationFrame=oldFrame;}
});
test('weekly reset UI edits each activity, reviews conflicts, and only copies after confirmation',async()=>{
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch,oldFrame=globalThis.requestAnimationFrame,{life}=fixture(),requests=[];
  const start=new Date();start.setHours(9,0,0,0);const source=await save(life,{...activity,starts_at:start.toISOString(),ends_at:new Date(+start+3600000).toISOString()});
  globalThis.document={createElement:element};globalThis.requestAnimationFrame=callback=>callback();
  globalThis.fetch=async(url,options)=>{let result;if(!options?.method)result=await life.overview('room:a');else{const {action,...input}=JSON.parse(options.body);requests.push(action);result=await life[{preview_week:'previewWeek',save_week:'saveWeek',check_in:'checkIn'}[action] || action](input,'room:a');}return {ok:true,json:async()=>result};};
  try{
    const root=await renderLife({ask(){}});await all(root).find(el=>el.textContent==='Your rhythm').onclick();await all(root).find(el=>el.textContent==='This week').onclick();await all(root).find(el=>el.textContent==='Weekly reset').onclick();
    const reset=all(root).find(el=>el.className==='liferesetitem');assert.ok(reset);
    const label=name=>all(reset).find(el=>el.tagName==='label' && el.textContent===name).children[0];
    label('Carry this activity forward').checked=true;label('Name').value='Next week movement';
    await all(root).find(el=>el.textContent==='Review next week').onclick();assert.ok(all(root).find(el=>el.textContent==='Review your next week'));assert.equal((await life.overview('room:a')).items.length,1);
    await all(root).find(el=>el.textContent==='Confirm and save in Life').onclick();const records=(await life.overview('room:a')).items;assert.equal(records.length,2);assert.equal(records.find(item=>item.id!==source.id).title,'Next week movement');assert.ok(requests.indexOf('preview_week')<requests.indexOf('save_week'));
  }finally{globalThis.document=oldDocument;globalThis.fetch=oldFetch;globalThis.requestAnimationFrame=oldFrame;}
});

test('weekly carry-forward preserves local start times and overnight duration across a clock-change week',()=>{
  const source=new Date(2026,9,26),target=new Date(2026,10,2),start=new Date(2026,9,28,9,15),end=new Date(+start+8*3600000);
  const times=copyLifeTimes({starts_at:start.toISOString(),ends_at:end.toISOString()},target,source),copied=new Date(times.starts_at);
  assert.equal(copied.getDate(),4);assert.equal(copied.getHours(),9);assert.equal(copied.getMinutes(),15);assert.equal(Date.parse(times.ends_at)-Date.parse(times.starts_at),8*3600000);
  const sleep=new Date(2026,9,31,23);const overnight=copyLifeTimes({starts_at:sleep.toISOString(),ends_at:new Date(+sleep+8*3600000).toISOString()},target,source);
  assert.equal(new Date(overnight.starts_at).getHours(),23);assert.equal(new Date(overnight.starts_at).getDate(),7);assert.equal(Date.parse(overnight.ends_at)-Date.parse(overnight.starts_at),8*3600000);
});
test('weekly carry-forward uses the chosen local day for duplicate protection when edits cross UTC midnight',async()=>{
  const {life}=fixture(),source=await save(life,activity);
  let proposed=await life.previewWeek({entries:[{source_id:source.id,copy_date:'2026-10-12',starts_at:'2026-10-12T23:00:00Z',ends_at:'2026-10-13T00:00:00Z'}]},'room:a');await life.saveWeek({entries:proposed.entries,baseline:proposed.baseline},'room:a');
  proposed=await life.previewWeek({entries:[{source_id:source.id,copy_date:'2026-10-12',starts_at:'2026-10-13T01:00:00Z',ends_at:'2026-10-13T02:00:00Z'}]},'room:a');assert.equal(proposed.items.length,0);assert.equal(proposed.already.length,1);
});

test('Life home keeps extra views collapsed and returns from Explore Life without losing the daily pulse',async()=>{
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch;const prompts=[];
  globalThis.document={createElement:element};globalThis.fetch=async()=>({ok:true,json:async()=>({items:[],pulses:[],profile:{onboarded:true,focus:[]}})});
  try{
    const root=await renderLife({ask:prompt=>prompts.push(prompt)});await all(root).find(el=>el.textContent==='Today').onclick();
    let explore=all(root).find(el=>el.className==='lifeexplore');assert.equal(explore.open,false);assert.equal(explore.children[0].textContent,'Explore Life');
    assert.equal(all(explore).filter(el=>el.tagName==='button').length,5);
    assert.ok(all(root).find(el=>el.className==='lifepulse'));assert.ok(all(root).find(el=>el.className==='lifeideas' && !el.open));
    const primary=all(root).find(el=>el.className==='lifeactions lifeprimary');assert.deepEqual(primary.children.map(el=>el.textContent),['✦ Plan with Nex','+ Plan an activity']);
    primary.children[0].onclick();assert.match(prompts[0],/Read Life and Nex Schedule/);
    explore.open=true;await all(explore).find(el=>el.textContent==='Life history').onclick();
    explore=all(root).find(el=>el.className==='lifeexplore');assert.equal(explore.open,true);assert.ok(all(root).find(el=>el.textContent==='Your Life history'));
    await all(root).find(el=>el.textContent==='Today').onclick();assert.equal(all(root).find(el=>el.className==='lifeexplore').open,false);assert.ok(all(root).find(el=>el.className==='lifepulse'));
  }finally{globalThis.document=oldDocument;globalThis.fetch=oldFetch;}
});
