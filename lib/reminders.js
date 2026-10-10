// Private reminders are independent of time blocks; one stable Schedule link
// can reserve time for a reminder without creating a second task to complete.
import { createPlannerItem, updatePlannerItem, deletePlannerItem, listPlannerItems, previewPlannerItem } from './planner.js';
import { randomUUID } from 'node:crypto';
async function redis(command) {
  const url=process.env.KV_REST_API_URL, token=process.env.KV_REST_API_TOKEN;
  if(!url || !token)throw new Error('Reminder storage is unavailable');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command)});
  const data=await response.json();if(!response.ok || data.error)throw new Error('Reminder storage request failed');return data.result;
}
export function createReminderStore({command=redis,planner={createPlannerItem,updatePlannerItem,deletePlannerItem,listPlannerItems,previewPlannerItem},now=Date.now,idFactory=randomUUID}={}) {
  const key=(user)=>{if(!user)throw new Error('Reminder account is required');return `nexus:reminders:v1:${encodeURIComponent(user)}`;};
  async function get(id,user){if(!id)throw new Error('Reminder id is required');const raw=await command(['HGET',key(user),id]);if(!raw)throw new Error('Reminder not found');return JSON.parse(raw);}
  async function save(item,user){await command(['HSET',key(user),item.id,JSON.stringify(item)]);return item;}
  function normalize(input,current={}) {
    const value={...current,...input}, title=String(value.title || '').trim();if(!title)throw new Error('Title is required');
    const due_date=value.due_date || null;
    if(due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(due_date) || new Date(`${due_date}T12:00:00Z`).toISOString().slice(0,10)!==due_date))throw new Error('Choose a valid reminder date');
    const due_at=value.due_at ? new Date(value.due_at).toISOString() : null;
    if(due_at && !due_date)throw new Error('A timed reminder needs a date');
    const repeat=value.repeat || 'none';if(!['none','daily','weekly'].includes(repeat))throw new Error('Choose daily or weekly repeat');if(repeat!=='none' && !due_date)throw new Error('Choose a date for a recurring reminder.');
    const timezone=value.timezone || 'UTC';try{new Intl.DateTimeFormat('en-US',{timeZone:timezone});}catch{throw new Error('Choose a valid reminder time zone.');}
    const status=value.status || 'planned';if(!['planned','done'].includes(status))throw new Error('Invalid reminder status');
    return {id:current.id || idFactory(),title:title.slice(0,160),notes:String(value.notes || '').slice(0,4000),due_date,due_at,repeat,timezone,status,schedule_id:current.schedule_id || null,created_at:current.created_at || now(),updated_at:now()};
  }
  function repeatedTime(item,days){
    if(!item.due_at)return null;
    const format=new Intl.DateTimeFormat('en-US',{timeZone:item.timezone || 'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const local=time=>Object.fromEntries(format.formatToParts(new Date(time)).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
    const utc=parts=>Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
    const target=utc(local(item.due_at))+days*86400000;let result=target;
    for(let i=0;i<3;i++)result+=target-utc(local(result));
    return new Date(result).toISOString();
  }
  async function nextOccurrence(item,user){
    if(item.repeat && item.repeat!=='none'){
      const days=item.repeat==='weekly'?7:1,day=new Date(`${item.due_date}T12:00:00Z`);day.setUTCDate(day.getUTCDate()+days);
      const nextDate=day.toISOString().slice(0,10),nextId=`routine-${item.id.replace(/^routine-/u,'').split(':')[0]}:${nextDate}`;
      const existing=await command(['HGET',key(user),nextId]);
      if(!existing)return save({...item,id:nextId,due_date:nextDate,due_at:repeatedTime(item,days),status:'planned',schedule_id:null,created_at:now(),updated_at:now()},user);
    }
    return null;
  }
  async function list(user){
    const raw=await command(['HGETALL',key(user)]),items=[];
    for(let i=0;i<(raw || []).length;i+=2){try{items.push(JSON.parse(raw[i+1]));}catch{}}
    if(items.some(item=>item.schedule_id)){
      const blocks=await planner.listPlannerItems({},user),byId=new Map(blocks.map(item=>[item.id,item]));
      for(const item of items){const block=byId.get(item.schedule_id);if(block?.status==='done' && item.status!=='done'){item.status='done';await save(item,user);const next=await nextOccurrence(item,user);if(next)items.push(next);}item.scheduled_at=block?.starts_at || null;}
    }
    return items.sort((a,b)=>(a.due_date || '9999').localeCompare(b.due_date || '9999') || a.created_at-b.created_at);
  }
  async function create(input,user){return save(normalize(input),user);}
  async function update(input,user){
    const current=await get(input.id,user),item=normalize(input,current);
    if(item.schedule_id){
      const blocks=await planner.listPlannerItems({},user);
      const block=blocks.find(block=>block.id===item.schedule_id);
      if(block){if(input.status===undefined && block.status==='done')item.status='done';await planner.updatePlannerItem({id:item.schedule_id,title:item.title,notes:item.notes,...(input.status!==undefined ? {status:item.status==='done' ? 'done' : 'planned'} : {})},user);}
    }
    await save(item,user);
    if(input.status==='done' || item.status==='done' && current.status!=='done')await nextOccurrence(item,user);
    return item;
  }
  async function remove(id,user){
    const item=await get(id,user);
    if(item.schedule_id && (await planner.listPlannerItems({},user)).some(block=>block.id===item.schedule_id))await planner.deletePlannerItem(item.schedule_id,user);
    await command(['HDEL',key(user),id]);return item;
  }
  async function schedule(input,user){
    const item=await get(input.id,user);if(item.status==='done')throw new Error('Reopen this reminder before scheduling it');
    const start=Date.parse(input.starts_at),end=Date.parse(input.ends_at);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>16*3600000)throw new Error('Choose a start and duration up to 16 hours');
    const id=item.schedule_id || `reminder-${item.id}`;
    const params={id,title:item.title,notes:item.notes,starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString(),kind:'task',category:'other',flexibility:'flexible',source_id:item.id,status:'planned'};
    const preview=await planner.previewPlannerItem(params,user);preview.conflicts=preview.conflicts.filter(block=>block.id!==id);
    if(!input.apply)return preview;
    if(preview.conflicts.length)throw new Error('That time is taken. Choose an open time or ask Nex to help.');
    const existing=(await planner.listPlannerItems({},user)).find(block=>block.id===id);
    if(existing?.status==='done')throw new Error('Reopen this reminder before scheduling it');
    if(existing){delete params.category;delete params.flexibility;}
    const block=await planner[existing ? 'updatePlannerItem' : 'createPlannerItem'](params,user);
    await save({...item,schedule_id:id,updated_at:now()},user);return {item:{...item,schedule_id:id},block};
  }
  // Internal stable import for Life; never exposed as a client-selected link.
  async function syncLife(item,user){
    const id=`life-${item.id}`,raw=await command(['HGET',key(user),id]);
    const old=raw ? JSON.parse(raw) : {id};
    const input={title:item.title,notes:item.notes,due_date:item.due_date,due_at:item.due_at,status:item.status};
    if(raw)return update({id,...input},user);
    return save(normalize(input,old),user);
  }
  return {list,create,update,remove,schedule,syncLife};
}
export const reminderStore=createReminderStore();
