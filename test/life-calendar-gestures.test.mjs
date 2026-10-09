import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the actual pointer handlers with deterministic geometry and timers.
class Element {
  constructor(){this.children=[];this.parentElement=null;this.className='';this.dataset={};this.style={setProperty(){}};this.scrollTop=640;this.scrollLeft=0;this.attrs={};this.hidden=false;
    this.classList={add:(...names)=>{this.className+=' '+names.join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(n=>!names.includes(n)).join(' ');},toggle:(name,value)=>{const has=this.matches('.'+name);if(value===undefined)value=!has;if(value&&!has)this.classList.add(name);if(!value&&has)this.classList.remove(name);}};
  }
  append(...items){for(const item of items){item.remove();item.parentElement=this;this.children.push(item);}}
  replaceChildren(...items){for(const child of [...this.children])child.remove();this.append(...items);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  matches(selector){return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : selector==='button'&&this.tag==='button';}
  closest(selector){return selector.split(',').some(s=>this.matches(s)) ? this : this.parentElement?.closest(selector) || null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
  setAttribute(key,value){this.attrs[key]=value;} removeAttribute(key){delete this.attrs[key];}
  setPointerCapture(){}
  getBoundingClientRect(){if(this.matches('.lc-viewport'))return {top:100,bottom:500,left:0,right:393,width:393};if(this.matches('.lc-grid'))return {top:100-640};return {top:100,left:42,right:218,width:176};}
}
function setup(){
  let now=0,id=0;const timers=new Map(),created=[];
  const document={createElement(tag){const el=new Element();el.tag=tag;return el;},addEventListener(){},removeEventListener(){}};
  const source=readFileSync(new URL('../public/life-calendar.js',import.meta.url),'utf8').replace(/^import .*\n/m,'').replace(/export /g,'');
  const sandbox={document,Date,performance:{now:()=>now},setTimeout(fn,delay){timers.set(++id,{fn,at:now+delay});return id;},clearTimeout(key){timers.delete(key);},requestAnimationFrame(){},
    calendarKey:date=>date.toISOString().slice(0,10),calendarLayout:()=>[]};
  vm.runInNewContext(source,sandbox);
  const root=sandbox.renderLifeCalendar({items:[],state:{date:new Date('2026-10-08T12:00:00Z')},onCreate:value=>created.push(value),onOpen(){},onChange(){},onNavigate(){}});
  return {root,created,lane:root.querySelector('.lc-lane'),viewport:root.querySelector('.lc-viewport'),actions:root.querySelector('.lc-selectionactions'),advance(ms){now+=ms;for(const [key,timer] of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}}};
}
const pointer=(target,x=120,y=200,type='touch')=>({target,button:0,pointerId:1,pointerType:type,clientX:x,clientY:y,preventDefault(){},stopPropagation(){}});

test('quick touch and swipe never flash a selection or open details',()=>{
  const h=setup(),e=pointer(h.lane);
  h.lane.onpointerdown(e);assert.equal(h.root.querySelector('.lc-draft'),null);assert.equal(h.actions.hidden,true);
  h.advance(150);h.lane.onpointerup(e);h.advance(500);assert.equal(h.root.querySelector('.lc-draft'),null);
  h.lane.onpointerdown(e);h.lane.onpointermove(pointer(h.lane,120,170));
  assert.equal(h.viewport.scrollTop,670);assert.equal(h.actions.hidden,true);
  h.advance(500);h.lane.onpointerup(e);assert.equal(h.root.querySelector('.lc-draft'),null);assert.equal(h.created.length,0);
});
test('a deliberate hold selects; details require the explicit button',()=>{
  const h=setup(),e=pointer(h.lane);h.lane.onpointerdown(e);h.advance(419);assert.equal(h.root.querySelector('.lc-draft'),null);
  h.advance(1);assert.ok(h.root.querySelector('.lc-draft'));assert.equal(h.actions.hidden,false);
  h.lane.onpointerup(e);assert.equal(h.created.length,0);h.actions.querySelector('button').onclick();assert.equal(h.created.length,1);
});
test('mouse selection remains immediate and cancellation clears a pending hold',()=>{
  const h=setup();h.lane.onpointerdown(pointer(h.lane,120,200,'mouse'));assert.ok(h.root.querySelector('.lc-draft'));
  h.lane.onpointercancel();h.lane.onpointerdown(pointer(h.lane));h.lane.onpointercancel();h.advance(500);
  assert.equal(h.root.querySelector('.lc-draft'),null);
});
test('draft resizing ignores jitter and does not jump to the grabbed edge position',()=>{
  const h=setup();h.lane.selectRange(540,600);const draft=h.root.querySelector('.lc-draft'),edge=draft.querySelector('.lc-resize');edge.dataset.edge='end';
  draft.onpointerdown(pointer(edge,120,240));const initial=draft.style.height;
  draft.onpointermove(pointer(edge,120,244));assert.equal(draft.style.height,initial);
  draft.onpointermove(pointer(edge,120,260));assert.equal(draft.style.height,'100px');
});
test('edge scrolling stays gentle regardless of pointer-event frequency',()=>{
  const scroll=(hz)=>{const h=setup();h.lane.selectRange(540,600);const draft=h.root.querySelector('.lc-draft');
    draft.onpointerdown(pointer(draft,120,450));
    for(let i=0;i<hz;i++){h.advance(1000/hz);draft.onpointermove(pointer(draft,120,500));}
    return h.viewport.scrollTop-640;};
  const slow=scroll(60),fast=scroll(120);
  assert.ok(slow>70&&slow<85);assert.ok(fast>70&&fast<85);assert.ok(Math.abs(slow-fast)<2);
});
