import {renderScheduleCalendar} from './schedule-calendar.js';
import {renderReminders} from './reminders.js';
import {renderLife} from './life.js';
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
export function createSimpleChat({header,host,storage=localStorage,key,ctx,openChat,startNew=openChat,openWorkspace,isChat,read=async url=>{const response=await fetch(url,{credentials:'include',cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not read your workspace.');return data;}}){
 let preference=readChatPreference(storage,key),version=0;
 const spaces=[['Calendar','planner'],['Reminders','reminders'],['Projects','workbench'],['Life','life'],['Agents & chats','messages']];
 const menuButton=action('☰',async()=>{menu.showModal();await recentMenu();});menuButton.className='simple-menu-button';menuButton.setAttribute('aria-label','Open workspace menu');
 const brand=make('div',undefined,'simple-chat-brand');brand.append(make('span','N','simple-chat-mark'));const copy=make('span','Nexus');copy.append(make('small','Simple view'));brand.append(copy);
 header.prepend(menuButton);header.append(brand);
 const menu=make('dialog',undefined,'simple-chat-menu');menu.setAttribute('aria-label','Your Nexus workspace');
 const menuHead=make('div',undefined,'simple-card-head');menuHead.append(make('strong','Your Nexus'),action('Close',()=>menu.close()));menu.append(menuHead);
 menu.append(action('New conversation',()=>{menu.close();startNew();}));
 menu.append(action('Conversation',()=>{menu.close();openChat();}));
 for(const [label,id] of spaces)menu.append(action(label,()=>{menu.close();if(id==='messages'){if(ctx.openChatDirectory)ctx.openChatDirectory();else openChat();}else surface(id);}));
 menu.append(action('Settings',()=>{menu.close();ctx.openChatSettings();}));
 const recents=make('section',undefined,'simple-recent-chats');menu.append(recents);document.body.append(menu);
 async function recentMenu(){recents.replaceChildren(make('h3','Recent conversations'));try{await ctx.loadRecentConversations?.();const items=ctx.recentThreads?.()||[];for(const item of items.filter(item=>item.message_count!==0).slice(0,12)){recents.append(action(item.title||'Conversation',()=>{menu.close();ctx.openThread(item);}));}if(!items.length)recents.append(make('p','Your conversations will appear here.','simple-card-note'));}catch{recents.append(make('p','Recent conversations could not load.','simple-card-note'));}}
 menu.addEventListener('click',event=>{if(event.target===menu){const box=menu.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)menu.close();}});
 function sync(){document.body.classList.toggle('simple-chat',preference==='simple');menu.close();}
 function settings(){
  const form=make('form',undefined,'simple-view-settings');form.append(make('h3','Nexus view'));
  const label=make('label','Choose your view on this device');const select=make('select');
  for(const [value,text] of [['workspace','Current workspace'],['simple','Simple chat']]){const option=make('option',text);option.value=value;select.append(option);}select.value=preference;select.id='nexus-chat-view-preference';label.htmlFor=select.id;form.append(label,select,make('p','Same Nexus, conversations, and saved work.','simple-card-note'));
  const save=action('Save view',()=>{});save.type='submit';form.append(save);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;preference=select.value;writeChatPreference(storage,key,preference);sync();if(preference==='simple')await startNew();else await openWorkspace();};
  return form;
 }
 ctx.chatViewSettings=settings;
 async function surface(id,{target=host}={}){
  if(preference!=='simple')return;
  if(!isChat()){await openChat();target=host;}
  const request=++version;
  target.querySelector('.simple-workspace-card')?.remove();
  const card=make('section',undefined,'simple-workspace-card');card.setAttribute('aria-label',spaces.find(s=>s[1]===id)?.[0]||'Workspace');
  const top=make('div',undefined,'simple-card-head');top.append(make('strong',id==='planner'?'Your agenda':id==='reminders'?'Your reminders':id==='life'?'Your life':'Your projects'),action('Open',()=>ctx.go(id)));card.append(top);
  const content=make('div');content.setAttribute('aria-live','polite');content.append(make('p','Reading saved workspace…','simple-card-note'));card.append(content);target.append(card);
  try{
   const embeddedCtx={...ctx,calendarState:{date:new Date(),mode:'day',timelineScrollTop:Math.max(0,new Date().getHours()-1)*80},go:destination=>['planner','reminders','life'].includes(destination)&&destination===id?surface(id,{target}):ctx.go(destination)};
   if(['planner','reminders','life'].includes(id)){
    const renderer=id==='planner'?renderScheduleCalendar:id==='reminders'?renderReminders:renderLife;
    const widget=await renderer(embeddedCtx);if(request!==version||!card.isConnected)return;
    content.replaceChildren(widget);card.classList.add('simple-interactive-card');return;
   }
   const data=await read('/api/room-history');if(request!==version||!card.isConnected)return;
   const items=Array.isArray(data)?data:data.projects||data.builds||[];content.replaceChildren();
   if(!items.length){content.append(make('p','No saved projects yet.','simple-card-note'));return;}
   const label=make('label','Saved project'),select=make('select');select.setAttribute('aria-label','Saved project');
   for(const item of items){const option=make('option',item.mainLabel||item.title||item.label||item.name||'Untitled project');option.value=item.latestBuildId||item.id;select.append(option);}label.append(select);content.append(label);
   const preview=make('div',undefined,'simple-project-preview');content.append(preview);let previewVersion=0;
   async function loadProject(){
    const ticket=++previewVersion,id=select.value;preview.replaceChildren(make('p','Reading saved project…','simple-card-note'));
    try{const payload=await read('/api/room-history?id='+encodeURIComponent(id));if(ticket!==previewVersion||!card.isConnected)return;
     const html=payload.build?.html;if(typeof html!=='string'||!html.trim())throw Error('This saved project has no preview yet.');
     const frame=make('iframe');frame.title=`Saved project: ${select.selectedOptions[0].textContent}`;frame.setAttribute('sandbox','allow-scripts allow-forms');frame.setAttribute('referrerpolicy','no-referrer');frame.srcdoc=html;
     preview.replaceChildren(frame);const actions=make('div',undefined,'simple-project-actions');actions.append(action('Open project',()=>ctx.openWorkbenchPanel?.(id,'preview')),action('Edit with Nex',()=>ctx.openWorkbenchPanel?.(id,'edit')));preview.append(actions);
    }catch(error){if(ticket===previewVersion)preview.replaceChildren(make('p',error.message,'simple-card-note'),action('Retry preview',loadProject));}
   }
   select.onchange=loadProject;await loadProject();
  }catch(error){if(card.isConnected){content.replaceChildren(make('p',error.message,'simple-card-note'),action('Try again',()=>surface(id,{target})));}}
 }
 sync();return {get enabled(){return preference==='simple';},surface,contextual:async(text,target)=>{const id=contextualSpace(text);if(id&&preference==='simple')await surface(id,{target});},sync};
}
