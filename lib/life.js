// Life owns its records. Links to Nex are explicit, previewed, and account scoped.
import {randomUUID,createHash} from 'node:crypto';
import {createPlannerItem,updatePlannerItem,deletePlannerItem,listPlannerItems} from './planner.js';
import {reminderStore} from './reminders.js';
import {LIFE_FEELINGS,PHOTO_LIMIT,PHOTO_BYTES} from '../public/life-journal.js';
export const LIFE_PILLARS=['work','sleep','social','health','personal'];
const categories={work:'work',sleep:'rest',social:'social',health:'health',personal:'creative'};
async function redis(command){
  const url=process.env.KV_REST_API_URL,token=process.env.KV_REST_API_TOKEN;
  if(!url || !token)throw new Error('Life storage is unavailable');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command)});
  const data=await response.json();if(!response.ok || data.error)throw new Error('Life storage request failed');return data.result;
}
const text=(value,limit)=>String(value || '').trim().slice(0,limit);
function iso(value){if(!value)return null;const time=Date.parse(value);if(!Number.isFinite(time))throw new Error('Choose a valid date and time');return new Date(time).toISOString();}
function dateOnly(value){if(!value)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || iso(`${value}T12:00:00Z`).slice(0,10)!==value)throw new Error('Choose a valid date');return value;}
export function summarizeLife(items){
  const pillars=Object.fromEntries(LIFE_PILLARS.map(pillar=>[pillar,{planned_minutes:0,actual_minutes:0,energy_total:0,energy_count:0}]));
  let accounted=0,unconfirmed=0;
  for(const item of items.filter(item=>item.starts_at && item.ends_at)){
    const bucket=pillars[item.pillar];bucket.planned_minutes+=Math.max(0,(Date.parse(item.ends_at)-Date.parse(item.starts_at))/60000);
    if(item.outcome==='happened' && item.actual_starts_at && item.actual_ends_at){bucket.actual_minutes+=(Date.parse(item.actual_ends_at)-Date.parse(item.actual_starts_at))/60000;accounted++;}
    else if(item.kind==='activity' && item.outcome==='unknown')unconfirmed++;
    if(item.energy!=null){bucket.energy_total+=item.energy;bucket.energy_count++;}
  }
  return {pillars,accounted,unconfirmed};
}
export function createLifeStore({command=redis,planner={createPlannerItem,updatePlannerItem,deletePlannerItem,listPlannerItems},reminders=reminderStore,now=Date.now,idFactory=randomUUID}={}){
  const key=user=>{if(!user)throw new Error('Life account is required');return `nexus:life:v1:${encodeURIComponent(user)}`;};
  async function rawItems(user){const raw=await command(['HGETALL',key(user)]),items=[];for(let i=0;i<(raw || []).length;i+=2){try{const value=JSON.parse(raw[i+1]);if(raw[i]!=='profile')items.push(value);}catch{}}return items;}
  async function current(id,user){if(!id)return null;const raw=await command(['HGET',key(user),id]);return raw ? JSON.parse(raw) : null;}
  async function persist(item,user){await command(['HSET',key(user),item.id,JSON.stringify(item)]);return item;}
  function normalize(input,old=null){
    const value={...(old || {}),...input},title=text(value.title,160);if(!title)throw new Error('Give this a name');
    const pillar=value.pillar || 'personal';if(!LIFE_PILLARS.includes(pillar))throw new Error('Choose a Life pillar');
    const kind=old?.kind || value.kind || 'activity';if(!['activity','reminder'].includes(kind))throw new Error('Choose activity or reminder');
    const starts_at=iso(value.starts_at),ends_at=iso(value.ends_at);
    if((kind==='activity' || starts_at || ends_at) && (!starts_at || !ends_at || Date.parse(ends_at)<=Date.parse(starts_at) || Date.parse(ends_at)-Date.parse(starts_at)>48*3600000))throw new Error('Choose a start and duration up to 48 hours');
    const id=old?.id || input.id || idFactory();if(!/^[a-zA-Z0-9-]{1,100}$/.test(id) || id==='profile')throw new Error('Invalid Life item');
    const due_date=kind==='reminder' ? dateOnly(value.due_date) : null,due_at=kind==='reminder' ? iso(value.due_at) : null;if(due_at && !due_date)throw new Error('A timed reminder needs a date');
    return {id,kind,title,pillar,starts_at,ends_at,due_date,due_at,notes:text(value.notes,4000),person:text(value.person,160),place:text(value.place,160),protected:Boolean(value.protected),
      status:old?.status || 'planned',outcome:old?.outcome || 'unknown',actual_starts_at:old?.actual_starts_at || null,actual_ends_at:old?.actual_ends_at || null,energy:old?.energy ?? null,feelings:old?.feelings || [],reflection:old?.reflection || '',memory_url:old?.memory_url || '',
      link:old?.link || null,created_at:old?.created_at || input.created_at || now(),updated_at:old?.updated_at || input.updated_at || now()};
  }
  async function profile(user,input){
    const saved=await current('profile',user) || {focus:[],goals:'',onboarded:false};
    if(!input)return saved;
    const focus=input.focus===undefined ? saved.focus : input.focus;if(!Array.isArray(focus) || focus.some(pillar=>!LIFE_PILLARS.includes(pillar)))throw new Error('Choose valid priorities');
    const result={focus:[...new Set(focus)],goals:text(input.goals===undefined ? saved.goals : input.goals,2000),onboarded:true};await command(['HSET',key(user),'profile',JSON.stringify(result)]);return result;
  }
  async function external(user){return {blocks:await planner.listPlannerItems({},user),reminders:await reminders.list(user)};}
  function linkedParams(item){return {id:`life-${item.id}`,title:item.title,notes:[item.notes,item.person && `With: ${item.person}`,item.place && `Place: ${item.place}`].filter(Boolean).join('\n'),starts_at:item.starts_at,ends_at:item.ends_at,category:categories[item.pillar],source:'life',source_id:item.id,kind:'time_block',flexibility:item.protected ? 'fixed' : 'flexible',protected:item.protected,status:'planned'};}
  function hydrate(items,ext){
    for(const item of items){
      if(item.link?.kind==='activity'){
        const block=ext.blocks.find(block=>block.id===item.link.id);item.link_missing=!block;
        if(block){item.starts_at=block.starts_at;item.ends_at=block.ends_at;item.protected=block.protected;}
      }
      if(item.link?.kind==='reminder'){
        const record=ext.reminders.find(record=>record.id===item.link.id);item.link_missing=!record;
        if(record){item.status=record.status;if(record.schedule_id){const block=ext.blocks.find(block=>block.id===record.schedule_id);if(block){item.starts_at=block.starts_at;item.ends_at=block.ends_at;}}}
      }
    }
    return items;
  }
  async function overview(user){
    const [items,settings,ext,daily,photoIndex]=await Promise.all([rawItems(user),profile(user),external(user),pulses(user),command(['HGETALL',`${key(user)}:photo-counts`])]);hydrate(items,ext);
    const photoCounts={};for(let i=0;i<(photoIndex || []).length;i+=2)photoCounts[photoIndex[i]]=Number(photoIndex[i+1]);
    return {items:items.map(item=>({...item,photo_count:photoCounts[item.id] || 0,category:item.pillar})),profile:settings,pulses:daily,summary:summarizeLife(items)};
  }
  async function preview(input,user){
    const [old,own,ext]=await Promise.all([current(input.id,user),rawItems(user),external(user)]);
    hydrate(own,ext);if(old)hydrate([old],ext);const item=normalize(input,old),conflicts=[];
    if(item.starts_at && item.status!=='done'){
      const matches=candidate=>Date.parse(item.starts_at)<Date.parse(candidate.ends_at || new Date(Date.parse(candidate.starts_at)+3600000).toISOString()) && Date.parse(item.ends_at)>Date.parse(candidate.starts_at);
      for(const other of own.filter(other=>other.id!==item.id && other.starts_at && other.status!=='done'))if(matches(other))conflicts.push({where:'Life',id:other.id,title:other.title,starts_at:other.starts_at,ends_at:other.ends_at});
      for(const other of ext.blocks.filter(other=>['planned','draft'].includes(other.status) && other.id!==`life-${item.id}` && other.id!==`reminder-life-${item.id}`))if(matches(other) && !conflicts.some(conflict=>conflict.id===other.source_id || `life-${conflict.id}`===other.source_id))conflicts.push({where:'Nex Schedule',id:other.id,title:other.title,starts_at:other.starts_at,ends_at:other.ends_at});
    }
    const baseline=createHash('sha256').update(JSON.stringify({item,old,own,ext})).digest('hex');return {item,conflicts,baseline};
  }
  async function unlink(item,user){
    if(item.link?.kind==='activity' && (await planner.listPlannerItems({},user)).some(block=>block.id===item.link.id))await planner.deletePlannerItem(item.link.id,user);
    if(item.link?.kind==='reminder' && (await reminders.list(user)).some(record=>record.id===item.link.id))await reminders.remove(item.link.id,user);
  }
  async function save(input,user){
    const proposed=await preview(input,user);if(!input.baseline || proposed.baseline!==input.baseline)throw new Error('Your plan changed. Review it again before saving.');
    if(!['life','linked'].includes(input.destination))throw new Error('Choose where to save');
    const item=proposed.item;
    if(input.destination==='linked'){
      if(proposed.conflicts.length)throw new Error('Resolve the conflicts before linking to Nex. You can keep this in Life only.');
      if(item.kind==='activity'){
        const params=linkedParams(item),exists=(await planner.listPlannerItems({},user)).some(block=>block.id===params.id);
        await planner[exists ? 'updatePlannerItem' : 'createPlannerItem'](params,user);item.link={kind:'activity',id:params.id};
      }else{await reminders.syncLife(item,user);if(item.starts_at && item.status!=='done'){const reserved=await reminders.schedule({id:`life-${item.id}`,starts_at:item.starts_at,ends_at:item.ends_at,apply:true},user);await planner.updatePlannerItem({id:reserved.block.id,category:categories[item.pillar],protected:item.protected,flexibility:item.protected ? 'fixed' : 'flexible',source:'life',source_id:item.id},user);}item.link={kind:'reminder',id:`life-${item.id}`};}
    }else{await unlink(item,user);item.link=null;}
    item.updated_at=now();return persist(item,user);
  }
  async function checkIn(input,user){
    const item=await current(input.id,user);if(!item || input.id==='profile')throw new Error('Life item not found');
    if(item.link?.kind==='activity'){const block=(await planner.listPlannerItems({},user)).find(block=>block.id===item.link.id);if(block){item.starts_at=block.starts_at;item.ends_at=block.ends_at;}}
    if(item.kind==='reminder'){
      if(!['planned','done'].includes(input.status))throw new Error('Choose a reminder status');item.status=input.status;
      if(item.link)await reminders.update({id:item.link.id,status:item.status},user);
    }else{
      if(input.outcome!==undefined){if(!['unknown','happened','missed'].includes(input.outcome))throw new Error('Choose what happened');item.outcome=input.outcome;}
      if(input.energy!==undefined){if(input.energy!==null && ![1,2,3,4,5].includes(input.energy))throw new Error('Choose an energy rating');item.energy=input.energy;}
      if(input.use_planned_times===true){item.actual_starts_at=item.starts_at;item.actual_ends_at=item.ends_at;item.outcome='happened';}
      if(input.actual_starts_at!==undefined)item.actual_starts_at=iso(input.actual_starts_at);
      if(input.actual_ends_at!==undefined)item.actual_ends_at=iso(input.actual_ends_at);
      if(item.actual_starts_at && item.actual_ends_at && Date.parse(item.actual_ends_at)<=Date.parse(item.actual_starts_at))throw new Error('Actual finish must follow actual start');
      if(item.outcome!=='happened'){item.actual_starts_at=null;item.actual_ends_at=null;}
    }
    if(input.feelings!==undefined){if(!Array.isArray(input.feelings) || input.feelings.length>5 || input.feelings.some(feeling=>!LIFE_FEELINGS.includes(feeling)))throw new Error('Choose up to five feelings');item.feelings=[...new Set(input.feelings)];}
    if(input.reflection!==undefined)item.reflection=text(input.reflection,4000);
    if(input.memory_url!==undefined){const url=text(input.memory_url,1000);if(url){let parsed;try{parsed=new URL(url);}catch{throw new Error('Choose a valid memory link');}if(parsed.protocol!=='https:' || !parsed.hostname)throw new Error('Memory links must start with https://');}item.memory_url=url;}
    item.updated_at=now();return persist(item,user);
  }
  async function remove(id,user){const item=await current(id,user);if(!item || id==='profile')throw new Error('Life item not found');await unlink(item,user);await command(['HDEL',key(user),id]);await command(['HDEL',`${key(user)}:photos`,id]);await command(['HDEL',`${key(user)}:photo-counts`,id]);return item;}
  async function photos(id,user,input){
    const item=await current(id,user);if(!item || id==='profile')throw new Error('Life item not found');
    if(input===undefined){const raw=await command(['HGET',`${key(user)}:photos`,id]);return {photos:raw ? JSON.parse(raw) : []};}
    if(!Array.isArray(input) || input.length>PHOTO_LIMIT)throw new Error('Save up to three photos per activity');
    const saved=input.map(photo=>{
      if(typeof photo?.source!=='string' || photo.source.length>PHOTO_BYTES || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo.source))throw new Error('Choose a supported photo under 200 KB');
      const bytes=Buffer.from(photo.source.split(',')[1],'base64');if(bytes.length<4 || bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217)throw new Error('Choose a valid JPEG photo');
      return {source:photo.source,caption:text(photo.caption,240)};
    });
    await command(['HSET',`${key(user)}:photos`,id,JSON.stringify(saved)]);await command(['HSET',`${key(user)}:photo-counts`,id,String(saved.length)]);return {photos:saved};
  }
  async function alerts(user){return (await rawItems(user)).filter(item=>item.kind==='reminder' && !item.link);}
  async function pulses(user){const raw=await command(['HGETALL',`${key(user)}:pulses`]),result=[];for(let i=0;i<(raw || []).length;i+=2){try{result.push(JSON.parse(raw[i+1]));}catch{}}return result.sort((a,b)=>b.date.localeCompare(a.date));}
  async function pulse(input,user){
    const date=dateOnly(input.date);if(!date)throw new Error('Choose a day for your check-in');
    if(input.energy!==null && ![1,2,3,4,5].includes(input.energy))throw new Error('Choose an energy rating');
    const result={date,energy:input.energy,note:text(input.note,2000),updated_at:now()};
    await command(['HSET',`${key(user)}:pulses`,date,JSON.stringify(result)]);return result;
  }
  async function previewWeek(input,user){
    if(!Array.isArray(input.entries) || !input.entries.length || input.entries.length>100)throw new Error('Choose between 1 and 100 activities');
    const [own,ext]=await Promise.all([rawItems(user),external(user)]);hydrate(own,ext);
    const items=[],already=[],conflicts=[],seen=new Set(),entries=[];
    for(const entry of input.entries){
      const source=own.find(item=>item.id===entry.source_id && item.kind==='activity');if(!source)throw new Error('The original Life activity is no longer available');
      const start=iso(entry.starts_at);if(!start)throw new Error('Choose a start for each activity');
      const copy_date=dateOnly(entry.copy_date || start.slice(0,10));
      const id=`reset-${createHash('sha256').update(`${source.id}:${copy_date}`).digest('hex').slice(0,32)}`;
      if(seen.has(id))throw new Error('Choose each activity only once per day');seen.add(id);
      if(own.some(item=>item.id===id)){already.push({id,title:source.title});entries.push(entry);continue;}
      const item=normalize({...source,...entry,id,kind:'activity',created_at:entry.created_at || now(),updated_at:entry.updated_at || now()},null);
      item.copied_from=source.id;items.push(item);entries.push({...item,source_id:source.id,copy_date});
    }
    const overlaps=(a,b)=>Date.parse(a.starts_at)<Date.parse(b.ends_at) && Date.parse(a.ends_at)>Date.parse(b.starts_at);
    for(const item of items){
      for(const other of [...own.filter(other=>other.starts_at && other.status!=='done'),...items.filter(other=>other.id!==item.id)])if(overlaps(item,other))conflicts.push({item_id:item.id,title:item.title,with:other.title,where:'Life'});
      for(const block of ext.blocks.filter(block=>['planned','draft'].includes(block.status)))if(overlaps(item,block))conflicts.push({item_id:item.id,title:item.title,with:block.title,where:'Nex Schedule'});
    }
    const baseline=createHash('sha256').update(JSON.stringify({items,already,own,ext})).digest('hex');
    return {items,already,conflicts,baseline,entries};
  }
  async function saveWeek(input,user){
    const proposed=await previewWeek(input,user);
    if(input.baseline!==proposed.baseline)throw new Error('Your week changed. Review it again before saving.');
    if(proposed.conflicts.length)throw new Error('Change or skip overlapping activities before saving your week');
    if(proposed.items.length)await command(['HSET',key(user),...proposed.items.flatMap(item=>[item.id,JSON.stringify({...item,updated_at:now()})])]);
    return {items:proposed.items,already:proposed.already};
  }
  return {overview,profile,preview,save,checkIn,remove,alerts,pulse,previewWeek,saveWeek,photos};
}
export const lifeStore=createLifeStore();
