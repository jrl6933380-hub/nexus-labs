import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const spec={title:'Launch Studio',audience:'Owner',purpose:'Plan a launch',workflow:['Scope the offer'],collections:[{id:'notes',label:'Notes',fields:[{id:'note',label:'Note',type:'text',required:true}]}],skill:'Plan launches.',guidance:'Scope first.',requirements:['Provider setup pending'],html:'<!doctype html><html><body>Launch path</body></html>'};
const account={id:'fixture-pro',workbenchUserId:'fixture-pro',scheduleUserId:'room:fixture-pro',owner:false};
// Tests the real widget against an isolated host contract, not provider APIs or production storage.
function memoryHost(){const kits=new Map(),records=new Map();let revision=0;return {once:async(_u,_id,_a,_i,run)=>run(),execute:async(action,input,identity)=>{
 if(action==='save_board_kit'){const kit={board_id:input.board_id,title:input.spec.title,purpose:input.spec.purpose,spec:input.spec,status:'private_preview',baseline:'v'+(++revision),updated_at:revision,tool_contract:{unimplemented:input.spec.requirements},shared_skills:[]};kits.set(input.board_id,kit);return kit;}
 if(action==='board_kit')return kits.get(input.board_id);
 if(action==='board_entries')return {entries:input.collection_id==='notes'?[{entry_id:'note-1',baseline:'record-v1',data:{note:'Record for '+input.board_id}}]:[...records.values()].filter(e=>e.board_id===input.board_id && e.collection_id===input.collection_id)};
 if(action==='save_board_entry'){const entry={...input,baseline:'record-'+(++revision),created_at:revision};records.set(input.entry_id,entry);return {saved:true,entry};}
 if(action==='board')return {account:identity,boards:[...kits.values()],projects:[],schedule:[],reminders:[],usage:{exempt:true},updated_at:new Date(Date.parse('2026-10-15T00:00:00Z')+(++revision)).toISOString()};
 throw Error('Unexpected test action '+action);
}};}
class Element{
 constructor(tag,document){this.tag=tag;this.document=document;this.children=[];this.attrs={};this.value='';this.hidden=false;this.className='';this.style={};this.handlers={};this.classList={toggle:(name,value)=>{const names=new Set(this.className.split(' ').filter(Boolean));value?names.add(name):names.delete(name);this.className=[...names].join(' ');}};}
 append(...items){for(const item of items){item.remove();item.parent=this;this.children.push(item);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
 replaceChildren(...items){this.children.forEach(child=>{child.parent=null;});this.children=[];this.append(...items);}
 contains(item){return item===this || this.children.some(child=>child.contains(item));}
 matches(selector){if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('[')){const [,name,value]=selector.match(/\[([^=]+)=([^\]]+)\]/);return this.attrs[name]===value;}return this.tag===selector;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
 setAttribute(name,value){this.attrs[name]=String(value);}getAttribute(name){return this.attrs[name];}
 addEventListener(name,fn){this.handlers[name]=fn;}focus(){this.document.activeElement=this;}select(){this.selected=true;}
 insertBefore(item,target){item.remove();item.parent=this;this.children.splice(this.children.indexOf(target),0,item);}
 get isConnected(){return this===this.document.root || Boolean(this.parent?.isConnected);}
}
async function harness({fixture=memoryHost,mode='fullscreen',state,clipboard=false,standard=false,sendError=false,sendGate}={}){
 const f=fixture();await f.execute('save_board_kit',{board_id:'tutor',spec},account);
 const listeners={},calls=[],states=[],displayCalls=[],messages=[];let uuid=0;
 const document={createElement(tag){return new Element(tag,this);},createTextNode(text){const node=new Element('#text',this);node.textContent=text;return node;},documentElement:{style:{}},getElementById(id){return this.root.querySelector('#'+id) || (id==='board'?this.root:null);}};
 document.root=new Element('div',document);document.root.id='board';
 for(const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){if(match[2]==='board')continue;const el=document.createElement(match[1]);el.id=match[2];if(match[1]==='button')el.textContent=html.slice(match.index+match[0].length).split('</button>')[0];if(match[0].includes(' hidden'))el.hidden=true;for(const [,key,value] of match[0].matchAll(/(role|aria-controls|aria-selected)="([^"]+)"/g))el.setAttribute(key,value);document.root.append(el);}
 const by=id=>document.getElementById(id);by('board-filter').value='all';by('board-sort').value='recent';
 const invoke=async(name,args={})=>{calls.push({name,args});const actions={read_nexus_workspace:'board',read_nexus_board_kit:'board_kit',list_nexus_board_entries:'board_entries',save_nexus_board_kit:'save_board_kit',save_nexus_board_entry:'save_board_entry'},action=actions[name],{request_id,...input}=args;try{const execute=()=>f.execute(action,input,account);return {structuredContent:request_id?await f.once(account.id,request_id,action,input,execute):await execute()};}catch(e){return {isError:true,structuredContent:{error:e.message}};}};
 let window;const emit=event=>listeners.message?.(event);
 const deliver=async prompt=>{messages.push(prompt);if(sendError)throw Error('Host delivery failed');if(sendGate)await sendGate;};
 window={openai:{widgetState:state,setWidgetState:value=>states.push(value),callTool:invoke,sendFollowUpMessage:async({prompt})=>deliver(prompt),requestDisplayMode:async({mode:requested})=>{displayCalls.push(requested);return {mode:requested==='inline'?'inline':mode};}},addEventListener:(name,fn)=>{listeners[name]=fn;},parent:{postMessage:async msg=>{let result;if(msg.method==='ui/initialize')result={hostContext:{availableDisplayModes:['inline','fullscreen']}};else if(msg.method==='tools/call')result=await invoke(msg.params.name,msg.params.arguments);else if(msg.method==='ui/request-display-mode'){displayCalls.push(msg.params.mode);result={mode};}else if(msg.method==='ui/message'){await deliver(msg.params.content[0].text);result={};}else return;emit({source:window.parent,data:{jsonrpc:'2.0',id:msg.id,result}});}}};
 if(standard){delete window.openai.callTool;delete window.openai.requestDisplayMode;delete window.openai.sendFollowUpMessage;}
 const context={document,window,navigator:clipboard?{clipboard:{writeText:async text=>{context.copied=text;}}}:{},crypto:{randomUUID:()=>`fixture-${++uuid}`},Intl,Date,setTimeout,clearTimeout,DOMParser:class{parseFromString(text){return {head:{prepend(){}},createElement:document.createElement.bind(document),documentElement:{outerHTML:text}};}}};
 vm.runInNewContext(source,context);
 const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};await settle();if(!state)by('boards-tab').onclick();
 const click=async label=>{const b=document.root.querySelectorAll('button').find(item=>item.textContent===label);assert.ok(b,'Missing '+label);await b.onclick();await settle();return b;};
 return {f,by,window,context,calls,states,displayCalls,listeners,click,settle,messages};
}


function textOf(el){return [el.textContent||'',...el.children.map(textOf)].join(' ');}
function details(h,label){return h.by('board-kit-detail').querySelectorAll('details').find(el=>el.children[0]?.textContent===label);}
test('board opens on its canvas with one neutral composer and no record or implementation dump',async()=>{
 const h=await harness();await h.click('Open board');const root=h.by('board-kit-detail');assert.equal(root.querySelectorAll('textarea').length,1);assert.equal(h.by('board-pane-canvas').hidden,false);assert.equal(h.by('board-pane-answers').hidden,true);assert.equal(h.by('board-pane-records-notes').hidden,true);assert.equal(h.by('board-pane-details').hidden,true);assert.equal(h.calls.filter(c=>c.name==='list_nexus_board_entries').length,0);for(const label of ['Hint','Practice','Explain','Start','Ask assistant'])assert.equal(root.querySelectorAll('button').some(b=>b.textContent===label),false);
});
test('records load only when their tab opens and retain real edit baselines',async()=>{
 const h=await harness();await h.click('Open board');await h.click('Notes');const pane=h.by('board-pane-records-notes');assert.equal(h.calls.filter(c=>c.name==='list_nexus_board_entries').length,1);assert.match(textOf(pane),/Record for tutor/);await h.click('Edit');assert.equal(h.by('nexus-field-note').value,'Record for tutor');await h.click('Cancel');await h.click('Board');await h.click('Notes');assert.equal(h.calls.filter(c=>c.name==='list_nexus_board_entries').length,1);
});
test('delayed records cannot leak into a newly selected board',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});const f=memoryHost(),execute=f.execute;f.execute=async(action,input,...rest)=>{if(action==='board_entries' && input.board_id==='tutor')await gate;return execute(action,input,...rest)};const h=await harness({fixture:()=>f});await f.execute('save_board_kit',{board_id:'other',spec:{...spec,title:'Training desk'}},account);await h.click('Open board');await h.click('Notes');await h.click('← My board catalog');await h.by('refresh').onclick();await h.settle();const card=h.by('board-kits').children.find(c=>c.querySelector('h3')?.textContent==='Training desk');await card.querySelector('button').onclick();await h.settle();release();await h.settle();assert.equal(textOf(h.by('board-kit-detail')).includes('Record for tutor'),false);assert.equal(h.by('board-pane-records-notes').children.length,0);
});
test('failed lazy record fetch can retry without breaking the canvas',async()=>{
 const f=memoryHost(),execute=f.execute;let fail=true;f.execute=async(action,...rest)=>{if(action==='board_entries' && fail){fail=false;throw Error('offline')}return execute(action,...rest)};const h=await harness({fixture:()=>f});await h.click('Open board');await h.click('Notes');const pane=h.by('board-pane-records-notes');assert.match(textOf(pane),/could not load/);await h.click('Retry');assert.match(textOf(pane),/Record for tutor/);assert.equal(h.by('board-kit-detail').querySelectorAll('iframe').length,1);
});
test('one in-board composer uses either host bridge and preserves failed drafts',async()=>{
 for(const standard of [false,true]){const h=await harness({standard});await h.click('Open board');await h.click('Ask AI · Answers');h.by('board-chat-message').value='Scope my launch';await h.by('board-chat-message').parent.onsubmit({preventDefault(){}});assert.equal(h.messages.length,1);assert.match(h.messages[0],/board "tutor"/);assert.match(h.messages[0],/Scope my launch/);assert.doesNotMatch(h.messages[0],/lesson|teaching|learner/);assert.equal(h.by('board-chat-message').value,'');}
 const h=await harness({sendError:true});await h.click('Open board');h.by('board-chat-message').value='Keep my note';await h.by('board-chat-message').parent.onsubmit({preventDefault(){}});assert.equal(h.by('board-chat-message').value,'Keep my note');assert.equal(h.by('board-chat-message').disabled,false);
});
test('canvas remains opaque and fullscreen contains the board workspace',()=>{
 assert.match(html,/frame\.setAttribute\('sandbox','allow-scripts'\)/);assert.doesNotMatch(html,/allow-same-origin/);assert.match(html,/default-src 'none'/);assert.match(html,/#board\.focus-board #board-kit-detail>\.board-surface/);
});

test('full-size view requests host fullscreen, preserves selection and provides Back',async()=>{
 const h=await harness();await h.click('Open board');await h.click('View board');assert.ok(h.context.document.root.className.includes('focus-board'));assert.deepEqual(h.displayCalls,['fullscreen']);assert.equal(h.states.at(-1).selection.id,'tutor');assert.equal(h.states.at(-1).focusBoard,true);
 await h.click('Back to workspace');assert.equal(h.context.document.root.className.includes('focus-board'),false);assert.deepEqual(h.displayCalls,['fullscreen','inline']);
});

test('host refusal and standard MCP display bridge degrade honestly without losing the board',async()=>{
 for(const standard of [false,true]){const h=await harness({mode:'inline',standard});await h.click('Open board');await h.click('View board');assert.match(h.by('board-view-note').textContent,/did not grant fullscreen/);assert.ok(h.context.document.root.className.includes('focus-board'));assert.equal(h.displayCalls[0],'fullscreen');}
});

test('a remounted fullscreen board restores its selection without issuing a new fullscreen request',async()=>{
 const h=await harness({state:{accountId:account.id,tab:'boards',selection:{kind:'board',id:'tutor'},focusBoard:true,catalog:{query:'math',filter:'all',sort:'name'}}});assert.equal(h.by('board-search').value,'math');assert.ok(h.context.document.root.className.includes('focus-board'));assert.deepEqual(h.displayCalls,[]);
 h.listeners['openai:set_globals']({detail:{globals:{displayMode:'inline'}}});assert.equal(h.context.document.root.className.includes('focus-board'),false);
});

test('account switching clears the old preview, focus mode and search state',async()=>{
 const h=await harness();await h.click('Open board');await h.click('View board');const previous=await h.f.execute('board',{},account);h.listeners['openai:set_globals']({detail:{globals:{toolOutput:{...previous,account:{id:'other',owner:false},boards:[],projects:[],updated_at:'2099-01-01T00:00:00Z'}}}});assert.equal(h.by('board-kit-detail').children.length,0);assert.equal(h.context.document.root.className.includes('focus-board'),false);assert.equal(h.states.at(-1).selection,null);assert.equal(h.states.at(-1).accountId,'other');
});

test('double submission while delivery is pending sends only once',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const h=await harness({sendGate:gate});await h.click('Open board');h.by('board-chat-message').value='Teach me';const form=h.by('board-chat-message').parent,pending=form.onsubmit({preventDefault(){}});await form.onsubmit({preventDefault(){}});await h.settle();assert.equal(h.messages.length,1);release();await pending;
});

test('new resource version retains installed-client aliases',()=>{
 const resource=readFileSync(new URL('../lib/workspaceBoard.js',import.meta.url),'utf8');assert.ok(resource.includes("BOARD_URI='ui://nexus/workspace-board/v9.html'"));for(const version of ['v8','v7','v6','v5','v4','v3','v2'])assert.ok(resource.includes('ui://nexus/workspace-board/'+version+'.html'));
});

