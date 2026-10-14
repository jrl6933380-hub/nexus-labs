import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {workspaceFixture} from './helpers/workspaceFixture.mjs';

const html=readFileSync(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const spec={title:'Tutor',audience:'One learner',purpose:'Learn maths',workflow:['Try a question'],collections:[{id:'notes',label:'Notes',fields:[{id:'note',label:'Note',type:'text',required:true}]}],skill:'Offer hints.',guidance:'Ask which topic.',requirements:[],html:'<!doctype html><html><body>A lesson</body></html>'};
const account={id:'fixture-pro',workbenchUserId:'fixture-pro',scheduleUserId:'room:fixture-pro',owner:false};

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
async function harness({mode='fullscreen',state,clipboard=false,standard=false}={}){
 const f=workspaceFixture();await f.execute('save_board_kit',{board_id:'tutor',spec},account);
 const listeners={},calls=[],states=[],displayCalls=[];let uuid=0;
 const document={createElement(tag){return new Element(tag,this);},createTextNode(text){const node=new Element('#text',this);node.textContent=text;return node;},documentElement:{style:{}},getElementById(id){return this.root.querySelector('#'+id) || (id==='board'?this.root:null);}};
 document.root=new Element('div',document);document.root.id='board';
 for(const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){if(match[2]==='board')continue;const el=document.createElement(match[1]);el.id=match[2];if(match[1]==='button')el.textContent=html.slice(match.index+match[0].length).split('</button>')[0];if(match[0].includes(' hidden'))el.hidden=true;for(const [,key,value] of match[0].matchAll(/(role|aria-controls|aria-selected)="([^"]+)"/g))el.setAttribute(key,value);document.root.append(el);}
 const by=id=>document.getElementById(id);by('board-filter').value='all';by('board-sort').value='recent';
 const invoke=async(name,args={})=>{calls.push({name,args});const actions={read_nexus_workspace:'board',read_nexus_board_kit:'board_kit',list_nexus_board_entries:'board_entries',save_nexus_board_kit:'save_board_kit'},action=actions[name],{request_id,...input}=args;try{const execute=()=>f.execute(action,input,account);return {structuredContent:request_id?await f.once(account.id,request_id,action,input,execute):await execute()};}catch(e){return {isError:true,structuredContent:{error:e.message}};}};
 let window;const emit=event=>listeners.message?.(event);
 window={openai:{widgetState:state,setWidgetState:value=>states.push(value),callTool:invoke,requestDisplayMode:async({mode:requested})=>{displayCalls.push(requested);return {mode:requested==='inline'?'inline':mode};}},addEventListener:(name,fn)=>{listeners[name]=fn;},parent:{postMessage:async msg=>{let result;if(msg.method==='ui/initialize')result={hostContext:{availableDisplayModes:['inline','fullscreen']}};else if(msg.method==='tools/call')result=await invoke(msg.params.name,msg.params.arguments);else if(msg.method==='ui/request-display-mode'){displayCalls.push(msg.params.mode);result={mode};}else return;emit({source:window.parent,data:{jsonrpc:'2.0',id:msg.id,result}});}}};
 if(standard){delete window.openai.callTool;delete window.openai.requestDisplayMode;}
 const context={document,window,navigator:clipboard?{clipboard:{writeText:async text=>{context.copied=text;}}}:{},crypto:{randomUUID:()=>`fixture-${++uuid}`},Intl,Date,setTimeout,clearTimeout,DOMParser:class{parseFromString(text){return {head:{prepend(){}},createElement:document.createElement.bind(document),documentElement:{outerHTML:text}};}}};
 vm.runInNewContext(source,context);
 const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};await settle();if(!state)by('boards-tab').onclick();
 const click=async label=>{const b=document.root.querySelectorAll('button').find(item=>item.textContent===label);assert.ok(b,'Missing '+label);await b.onclick();await settle();return b;};
 return {f,by,window,context,calls,states,displayCalls,listeners,click,settle};
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
 const h=await harness({clipboard:true});await h.f.execute('save_board_entry',{board_id:'tutor',collection_id:'notes',entry_id:'private-note',data:{note:'fixture-secret-learning-record'}},account);await h.click('Open board');await h.click('Share template');
 const field=h.by('board-template-export'),payload=JSON.parse(field.value);assert.deepEqual(Object.keys(payload),['format','version','spec']);assert.equal(payload.spec.title,'Tutor');assert.equal(field.value.includes('fixture-secret-learning-record'),false);for(const name of ['entries','board_id','baseline','account','permissions'])assert.equal(Object.hasOwn(payload.spec,name),false);
 const copy=h.context.document.root.querySelectorAll('button').find(item=>item.textContent==='Copy template');assert.equal(copy.disabled,true);await copy.onclick();assert.equal(h.context.copied,undefined);
 const check=h.by('editor').querySelectorAll('input').find(item=>item.type==='checkbox');check.checked=true;check.onchange();assert.equal(copy.disabled,false);await copy.onclick();assert.equal(h.context.copied,field.value);
});
test('clipboard denial provides a manual copy fallback without claiming successful sharing',async()=>{
 const h=await harness();await h.click('Open board');await h.click('Share template');const check=h.by('editor').querySelectorAll('input')[0];check.checked=true;check.onchange();await h.click('Copy template');assert.equal(h.by('board-template-export').selected,true);
});
test('import review does not save; explicit confirmation creates a fresh owned private copy',async()=>{
 const h=await harness();await h.click('Open board');await h.click('Share template');const text=h.by('board-template-export').value;await h.click('Cancel');await h.click('← My board catalog');await h.click('Import template');h.by('nexus-field-template').value=text;
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
