import {openCalendarAt} from './calendar-navigation.js';
import {openReminderDetail} from './reminders.js';
const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const action=(label,run)=>{const el=make('button',label);el.type='button';el.onclick=run;return el;};
export function readChatPreference(storage,key){try{return storage.getItem(key)==='simple'?'simple':'workspace';}catch{return 'workspace';}}
export function writeChatPreference(storage,key,value){try{storage.setItem(key,value);}catch{}}
export function contextualSpace(text){
 const value=String(text||'');
 if(/\b(remind(?:er|ers)?|remember)\b/i.test(value))return 'reminders';
 if(/\b(calendar|schedule|agenda|today|tomorrow|planned)\b/i.test(value))return 'planner';
 if(/\b(life|energy|balance|routine)\b/i.test(value))return 'life';
 if(/\b(projects?|build|website|app|page)\b/i.test(value))return 'workbench';
 return null;
}
export function createSimpleChat({header,host,storage=localStorage,key,ctx,openChat,openWorkspace,isChat,read=async url=>{const response=await fetch(url,{credentials:'include',cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not read your workspace.');return data;}}){
 let preference=readChatPreference(storage,key),version=0;
 const toggle=action('Simple chat',async()=>{preference=preference==='simple'?'workspace':'simple';writeChatPreference(storage,key,preference);sync();if(preference==='simple')await openChat();else await openWorkspace();});
 toggle.className='simple-view-toggle';
 const bar=make('div',undefined,'simple-chat-tools');
 const spaces=[['Calendar','planner'],['Reminders','reminders'],['Projects','workbench'],['Life','life'],['Agents & chats','messages']];
 const menu=make('details',undefined,'simple-workspace-menu');const summary=make('summary','Workspace');menu.append(summary);
 const links=make('div',undefined,'simple-workspace-links');for(const [label,id] of spaces)links.append(action(label,()=>{menu.open=false;ctx.go(id);}));links.append(action('Current view',()=>toggle.click()));menu.append(links);
 bar.append(toggle,menu);for(const [label,id] of [['Agenda','planner'],['Reminders','reminders'],['Projects','workbench'],['Life','life']])bar.append(action(label,()=>surface(id)));header.after(bar);
 function sync(){document.body.classList.toggle('simple-chat',preference==='simple');toggle.textContent=preference==='simple'?'Current view':'Simple chat';toggle.setAttribute('aria-pressed',String(preference==='simple'));for(const child of bar.children)if(child!==toggle)child.hidden=preference!=='simple';}
 const format=value=>{const d=new Date(value);return Number.isFinite(+d)?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'No date set';};
 async function surface(id,{target=host}={}){
  if(preference!=='simple')return;
  if(!isChat()){await openChat();target=host;}
  const request=++version;
  target.querySelector('.simple-workspace-card')?.remove();
  const card=make('section',undefined,'simple-workspace-card');card.setAttribute('aria-label',spaces.find(s=>s[1]===id)?.[0]||'Workspace');
  const top=make('div',undefined,'simple-card-head');top.append(make('strong',id==='planner'?'Your agenda':id==='reminders'?'Your reminders':id==='life'?'Your life':'Your projects'),action('Open',()=>ctx.go(id)));card.append(top);
  const content=make('div');content.setAttribute('aria-live','polite');content.append(make('p','Reading saved workspace…','simple-card-note'));card.append(content);target.append(card);
  try{
   const data=await read(id==='planner'?'/api/planner':id==='reminders'?'/api/reminders':id==='life'?'/api/life':'/api/room-history');
   if(request!==version||!card.isConnected)return;
   const records=Array.isArray(data)?data:data.items||data.projects||data.builds||[];
   const now=Date.now();let items=id==='workbench'?records:records.filter(item=>!['done','cancelled','draft'].includes(item.status));
   if(id==='planner'||id==='life')items=items.filter(item=>new Date(item.ends_at||item.starts_at)>=now).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
   if(id==='reminders')items=items.sort((a,b)=>new Date(a.due_at||a.due_date||'9999-01-01')-new Date(b.due_at||b.due_date||'9999-01-01'));
   content.replaceChildren();
   for(const item of items.slice(0,3)){
    const row=action(item.title||item.label||item.name||'Untitled',()=>{
     if(id==='planner')return item.calendar_marker?openReminderDetail(ctx,item.reminder_id):openCalendarAt(ctx,item);
     if(id==='life')return ctx.go('life');
     if(id==='reminders')return openReminderDetail(ctx,item.id);
     return ctx.openWorkbenchPanel?.(item.id,'preview');
    });row.className='simple-card-row';
    const meta=id==='planner'||id==='life'?`${item.calendar_marker?'Reminder · ':''}${format(item.starts_at)}`:id==='reminders'?item.due_at?format(item.due_at):item.due_date||'No date set':item.status||'Saved project';
    row.append(make('small',meta));content.append(row);
   }
   if(!items.length)content.append(make('p',id==='planner'||id==='life'?'No upcoming activities.':id==='reminders'?'No active reminders.':'No saved projects yet.','simple-card-note'));
   content.append(make('p',`Saved workspace · ${items.length} ${id==='planner'||id==='life'?'upcoming':id==='reminders'?'active':'projects'}`,'simple-card-note'));
   content.append(action('Refresh card',()=>surface(id,{target})));
  }catch(error){if(card.isConnected){content.replaceChildren(make('p',error.message,'simple-card-note'),action('Try again',()=>surface(id,{target})));}}
 }
 sync();return {get enabled(){return preference==='simple';},surface,contextual:async(text,target)=>{const id=contextualSpace(text);if(id&&preference==='simple')await surface(id,{target});},sync};
}
