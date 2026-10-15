import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {workspaceFixture} from './helpers/workspaceFixture.mjs';

const html=readFileSync(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const spec={title:'Tutor',audience:'One learner',purpose:'Learn maths',workflow:['Try a question'],collections:[{id:'notes',label:'Notes',fields:[{id:'note',label:'Note',type:'text',required:true}]}],skill:'Offer hints.',guidance:'Ask which topic.',requirements:[],html:'<!doctype html><html><body>A lesson</body></html>'};
const account={id:'fixture-pro',workbenchUserId:'fixture-pro',scheduleUserId:'room:fixture-pro',owner:true};

// A deterministic DOM/host double executes the shipped widget handlers.
// It does not prove real browser rendering or ChatGPT fullscreen support.
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
async function harness({mode='fullscreen',state,clipboard=false,standard=false,sendError=false,sendGate}={}){
 const f=workspaceFixture();await f.execute('save_board_kit',{board_id:'tutor',spec},account);
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

test('catalog search, filter and sort execute against the current saved board list',async()=>{
 const h=await harness();assert.match(h.by('board-count').textContent,/1 of 1/);h.by('board-search').value='missing';h.by('board-search').handlers.input();assert.match(h.by('board-count').textContent,/0 of 1/);
 h.by('board-search').value='MATH';h.by('board-search').handlers.input();assert.match(h.by('board-count').textContent,/1 of 1/);
 h.by('board-filter').value='scoped';h.by('board-filter').handlers.change();assert.match(h.by('board-count').textContent,/0 of 1/);
 h.by('board-filter').value='private_preview';h.by('board-sort').value='name';h.by('board-sort').handlers.change();assert.match(h.by('board-count').textContent,/1 of 1/);assert.equal(h.states.at(-1).catalog.sort,'name');
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
test('sharing needs content review and exports only a template, never saved records or IDs',async()=>{
 const h=await harness({clipboard:true});await h.f.execute('save_board_entry',{board_id:'tutor',collection_id:'notes',entry_id:'private-note',data:{note:'fixture-secret-learning-record'}},account);await h.click('Open board');await h.click('Details');await h.click('Share template');
 const field=h.by('board-template-export'),payload=JSON.parse(field.value);assert.deepEqual(Object.keys(payload),['format','version','spec']);assert.equal(payload.spec.title,'Tutor');assert.equal(field.value.includes('fixture-secret-learning-record'),false);for(const name of ['entries','board_id','baseline','account','permissions'])assert.equal(Object.hasOwn(payload.spec,name),false);
 const copy=h.context.document.root.querySelectorAll('button').find(item=>item.textContent==='Copy template');assert.equal(copy.disabled,true);await copy.onclick();assert.equal(h.context.copied,undefined);
 const check=h.by('editor').querySelectorAll('input').find(item=>item.type==='checkbox');check.checked=true;check.onchange();assert.equal(copy.disabled,false);await copy.onclick();assert.equal(h.context.copied,field.value);
});
test('clipboard denial provides a manual copy fallback without claiming successful sharing',async()=>{
 const h=await harness();await h.click('Open board');await h.click('Details');await h.click('Share template');const check=h.by('editor').querySelectorAll('input')[0];check.checked=true;check.onchange();await h.click('Copy template');assert.equal(h.by('board-template-export').selected,true);
});
test('import review does not save; explicit confirmation creates a fresh owned private copy',async()=>{
 const h=await harness();await h.click('Open board');await h.click('Details');await h.click('Share template');const text=h.by('board-template-export').value;await h.click('Cancel');await h.click('← My board catalog');await h.click('Import template');h.by('nexus-field-template').value=text;
 const form=h.by('editor').querySelector('form');await form.onsubmit({preventDefault(){}});await h.settle();assert.equal(h.calls.filter(c=>c.name==='save_nexus_board_kit').length,0);assert.equal(h.by('editor').hidden,false);assert.ok(h.by('nexus-field-confirm'));
 h.by('nexus-field-confirm').value='yes';h.by('nexus-field-title').value='My tutor copy';await h.by('editor').querySelector('form').onsubmit({preventDefault(){}});await h.settle();const save=h.calls.find(c=>c.name==='save_nexus_board_kit');assert.ok(save);assert.notEqual(save.args.board_id,'tutor');assert.equal(save.args.baseline,undefined);assert.equal(save.args.spec.title,'My tutor copy');assert.equal((await h.f.execute('board_kits',{},account)).boards.length,2);
 const other={...account,id:'other',workbenchUserId:'other'};assert.equal((await h.f.execute('board_kits',{},other)).boards.length,0);
});
test('import rejects records, grants and malformed JSON before any write',async()=>{
 for(const text of ['not json',JSON.stringify({format:'nexus-board-template',version:1,spec,entries:[]}),JSON.stringify({format:'nexus-board-template',version:1,spec:{...spec,permissions:['admin']}})]){const h=await harness();await h.click('Import template');h.by('nexus-field-template').value=text;await h.by('editor').querySelector('form').onsubmit({preventDefault(){}});await h.settle();assert.equal(h.calls.filter(c=>c.name==='save_nexus_board_kit').length,0);assert.equal(h.by('status').attrs.role,'alert');}
});
test('account switching clears the old preview, focus mode and search state',async()=>{
 const h=await harness();await h.click('Open board');await h.click('View board');const previous=await h.f.execute('board',{},account);h.listeners['openai:set_globals']({detail:{globals:{toolOutput:{...previous,account:{id:'other',owner:false},boards:[],projects:[],updated_at:'2099-01-01T00:00:00Z'}}}});assert.equal(h.by('board-kit-detail').children.length,0);assert.equal(h.context.document.root.className.includes('focus-board'),false);assert.equal(h.states.at(-1).selection,null);assert.equal(h.states.at(-1).accountId,'other');
});
test('viewer keeps the opaque preview sandbox and limits imported HTML to existing CSP',()=>{
 assert.match(html,/frame\.setAttribute\('sandbox','allow-scripts'\)/);assert.doesNotMatch(html,/allow-same-origin/);assert.match(html,/default-src 'none'/);assert.match(html,/if\(event.source!==window.parent\)return/);assert.match(html,/availableDisplayModes:\['inline','fullscreen'\]/);assert.match(html,/safe-area-inset-top/);
});

test('saved work and edit forms live inside the focused board and retain the selected section after save',async()=>{
 const h=await harness();await h.f.execute('save_board_entry',{board_id:'tutor',collection_id:'notes',entry_id:'first',data:{note:'Saved launch note'}},account);
 await h.click('Open board');await h.click('View board');await h.click('Notes');
 assert.equal(h.by('board-pane-records-notes').hidden,false);await h.click('Edit');
 const pane=h.by('board-pane-records-notes');assert.ok(pane.contains(h.by('editor')));
 h.by('nexus-field-note').value='Updated launch note';await h.by('editor').querySelector('form').onsubmit({preventDefault(){}});await h.settle();
 assert.equal(h.by('board-pane-records-notes').hidden,false);assert.ok(h.by('board').className.includes('focus-board'));
 const entries=await h.f.execute('board_entries',{board_id:'tutor',collection_id:'notes'},account);assert.equal(entries.entries[0].data.note,'Updated launch note');
});
test('asking creates a private waiting question and requests a saved answer through both host bridges',async()=>{
 for(const standard of [false,true]){const h=await harness({standard});await h.click('Open board');await h.click('View board');await h.click('Ask AI · Answers');
 h.by('board-chat-message').value='What comes next?';await h.by('board-chat-message').parent.onsubmit({preventDefault(){}});await h.settle();
 assert.equal(h.messages.length,1);assert.match(h.messages[0],/save_nexus_board_entry/);assert.match(h.messages[0],/read_nexus_workspace/);assert.match(h.messages[0],/My question: What comes next/);
 const entries=await h.f.execute('board_entries',{board_id:'tutor',collection_id:'board_replies'},account);assert.equal(entries.entries.length,1);assert.equal(entries.entries[0].data.status,'waiting');assert.equal(entries.entries[0].data.answer,null);
 assert.equal(h.by('board-chat-message').value,'');assert.ok(h.by('board').className.includes('focus-board'));assert.equal(h.by('board-pane-answers').hidden,false);
 }
});
test('an actual saved answer appears inside the board after refresh and survives reopening',async()=>{
 const h=await harness();await h.click('Open board');await h.click('Ask AI · Answers');h.by('board-chat-message').value='Next step?';await h.by('board-chat-message').parent.onsubmit({preventDefault(){}});await h.settle();
 const entry=(await h.f.execute('board_entries',{board_id:'tutor',collection_id:'board_replies'},account)).entries[0];
 await h.f.execute('save_board_entry',{board_id:'tutor',collection_id:'board_replies',entry_id:entry.entry_id,baseline:entry.baseline,data:{...entry.data,answer:'Pick one demonstration.',next_step:'Choose the project.',status:'answered'}},account);await h.click('Refresh answers');
 assert.ok(h.by('board-pane-answers').querySelectorAll('p').some(p=>p.textContent==='Pick one demonstration.'));
 await h.click('Refresh board');assert.equal(h.by('board-pane-answers').hidden,false);assert.ok(h.by('board-pane-answers').querySelectorAll('p').some(p=>p.textContent==='Pick one demonstration.'));
});
test('failed handoff retains the draft and durable waiting record without a fabricated answer',async()=>{
 const h=await harness({sendError:true});await h.click('Open board');await h.click('Ask AI · Answers');h.by('board-chat-message').value='Keep my question';await h.by('board-chat-message').parent.onsubmit({preventDefault(){}});await h.settle();
 assert.equal(h.by('board-chat-message').value,'Keep my question');assert.equal(h.by('board-chat-message').disabled,false);
 assert.ok(h.by('board-chat-message').parent.children.some(n=>n.attrs.role==='alert'));
 const entries=await h.f.execute('board_entries',{board_id:'tutor',collection_id:'board_replies'},account);assert.equal(entries.entries[0].data.status,'waiting');assert.equal(entries.entries[0].data.answer,null);
});
test('double submission while delivery is pending saves and sends only once',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const h=await harness({sendGate:gate});await h.click('Open board');h.by('board-chat-message').value='Teach me';const form=h.by('board-chat-message').parent,first=form.onsubmit({preventDefault(){}});await h.settle();await form.onsubmit({preventDefault(){}});assert.equal(h.messages.length,1);release();await first;
 assert.equal(h.calls.filter(c=>c.name==='save_nexus_board_entry').length,1);
});
test('answer payloads are rendered as text and collection collisions do not rewrite a board',async()=>{
 const h=await harness();const kit=await h.f.execute('board_kit',{board_id:'tutor'},account);await h.f.execute('save_board_kit',{board_id:'tutor',baseline:kit.baseline,spec:{...kit.spec,collections:[...kit.spec.collections,{id:'board_replies',label:'Existing data',fields:[{id:'custom',label:'Custom',type:'text'}]}]}},account);await h.click('Open board');h.by('board-chat-message').value='Hello';await h.by('board-chat-message').parent.onsubmit({preventDefault(){}});assert.equal(h.messages.length,0);assert.equal(h.calls.some(c=>c.name==='save_nexus_board_entry'),false);assert.equal(h.calls.some(c=>c.name==='save_nexus_board_kit'),false);
 assert.match(html,/node\('p',entry.data.answer/);assert.doesNotMatch(html,/innerHTML\s*=/);
});
test('account changes clear saved answers and pending board view',async()=>{
 const h=await harness();await h.click('Open board');await h.click('View board');const previous=await h.f.execute('board',{},account);h.listeners['openai:set_globals']({detail:{globals:{toolOutput:{...previous,account:{id:'other',owner:false},boards:[],projects:[],updated_at:'2099-01-01T00:00:00Z'}}}});assert.equal(h.by('board-kit-detail').children.length,0);assert.equal(h.by('board').className.includes('focus-board'),false);assert.equal(h.states.at(-1).accountId,'other');
});
test('customer workspace shows the same core tools and treats custom boards as a future option',async()=>{
 const h=await harness();await h.click('Open board');await h.click('View board');const previous=await h.f.execute('board',{},account);
 h.listeners['openai:set_globals']({detail:{globals:{toolOutput:{...previous,account:{id:'customer:alice',name:'alice',owner:false},boards:[],projects:[],board_studio:{available:false},updated_at:'2099-01-01T00:00:00Z'}}}});
 assert.equal(h.by('account').textContent,'alice · Your workspace');assert.equal(h.by('boards-tab').hidden,true);assert.equal(h.by('custom-boards-future').hidden,false);assert.equal(h.by('import-form').hidden,true);
 for(const id of ['projects-tab','schedule-tab','reminders-tab','usage-tab'])assert.equal(h.by(id).hidden,false);
 h.by('usage-tab').onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(h.by('projects-tab').attrs['aria-selected'],'true');
});

