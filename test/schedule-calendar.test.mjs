import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDayItems,calendarLayout,calendarKey,renderScheduleCalendar} from '../public/schedule-calendar.js';
const date=new Date(2026,9,5);
function event(id,hour,minutes,duration=60) {
  const start=new Date(2026,9,5,hour,minutes);
  return {id,title:id,starts_at:start.toISOString(),ends_at:new Date(start.getTime()+duration*60000).toISOString(),status:'planned',category:'work'};
}
test('calendar clips overnight events into both days without leaking cancelled events',()=>{
  const overnight=event('Overnight',23,0,120);
  assert.equal(calendarDayItems([overnight],new Date(2026,9,6)).length,1);
  const [layout]=calendarLayout([overnight],new Date(2026,9,6));
  assert.equal(layout.start,0);assert.equal(layout.end,60);
  assert.equal(calendarDayItems([{...overnight,status:'cancelled'}],date).length,0);
  assert.equal(calendarKey(date),'2026-10-05');
});
test('overlapping calendar events receive separate columns; adjoining events use full width',()=>{
  const layout=calendarLayout([event('A',9,0,120),event('B',9,30,60),event('C',11,0)],date);
  assert.equal(layout[0].columns,2);assert.notEqual(layout[0].column,layout[1].column);
  assert.equal(layout[2].columns,1);
});
function fakeElement(tag) {
  return {tagName:tag,children:[],attrs:{},className:'',style:{setProperty(){}},classList:{toggle(){},add(){}},
    setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
    get childNodes(){return this.children;},querySelector(){return null;},scrollIntoView(){},
  };
}
function descendants(root){return [root,...root.children.flatMap(descendants)];}
test('calendar view switches load ranges and time-slot clicks carry date and hour into Add',async()=>{
  const previousDocument=globalThis.document, previousFetch=globalThis.fetch, previousFrame=globalThis.requestAnimationFrame;
  const calls=[];
  globalThis.document={createElement:fakeElement};globalThis.requestAnimationFrame=(callback)=>callback();
  globalThis.fetch=async()=>({ok:true,json:async()=>({items:[],drafts:[]})});
  try {
    const root=await renderScheduleCalendar({openScheduleStudio:(...args)=>calls.push(args),setScheduleItems(){}},{balance:()=>fakeElement('div')});
    assert.equal(descendants(root).filter((node)=>node.className==='caldate').length,42);
    await descendants(root).find((node)=>node.textContent==='Day').onclick();
    const slots=descendants(root).filter((node)=>node.className==='calslot');assert.equal(slots.length,24);
    slots[9].onclick();assert.equal(calls[0][0],'block');assert.match(calls[0][1],/^\d{4}-\d{2}-\d{2}$/);assert.equal(calls[0][2],540);
    await descendants(root).find((node)=>node.textContent==='Multi-day').onclick();
    assert.equal(descendants(root).filter((node)=>node.className==='calslot').length,72);
    await descendants(root).find((node)=>node.textContent==='List').onclick();
    assert.equal(descendants(root).filter((node)=>node.className==='calempty').length,1);
  } finally {globalThis.document=previousDocument;globalThis.fetch=previousFetch;globalThis.requestAnimationFrame=previousFrame;}
});

test('calendar keeps events and saved draft review linked to their exact records',async()=>{
  const previousDocument=globalThis.document, previousFetch=globalThis.fetch, previousFrame=globalThis.requestAnimationFrame;
  const item=event('Work record',9,0), draft={...event('Draft record',12,0),draft_id:'auto-draft',status:'draft'};
  const opened=[];
  globalThis.document={createElement:fakeElement};globalThis.requestAnimationFrame=(callback)=>callback();
  globalThis.fetch=async()=>({ok:true,json:async()=>({items:[item],drafts:['auto-draft'],draft_items:[draft]})});
  try {
    const root=await renderScheduleCalendar({openPlannerItem:(record)=>opened.push(record),reviewWeekDraft:(id,items)=>opened.push({id,items})},{balance:()=>fakeElement('div')});
    const review=descendants(root).find((node)=>node.className==='caldraft');review.onclick();
    assert.deepEqual(opened[0],{id:'auto-draft',items:[draft]});
  } finally {globalThis.document=previousDocument;globalThis.fetch=previousFetch;globalThis.requestAnimationFrame=previousFrame;}
});


test('activity actions target the exact block without nested buttons or completion controls',async()=>{
  const previousDocument=globalThis.document, previousFetch=globalThis.fetch, previousFrame=globalThis.requestAnimationFrame;
  const start=new Date();start.setHours(9,0,0,0);
  const item={id:'direct-actions',title:'Social',starts_at:start.toISOString(),ends_at:new Date(+start+3600000).toISOString(),category:'social',status:'planned'};
  const calls=[];
  globalThis.document={createElement:fakeElement};globalThis.requestAnimationFrame=(callback)=>callback();
  globalThis.fetch=async()=>({ok:true,json:async()=>({items:[item],drafts:[]})});
  try {
    const root=await renderScheduleCalendar({editScheduleNotes:record=>calls.push(['notes',record]),editScheduleItem:record=>calls.push(['edit',record]),openScheduleOverrun:record=>calls.push(['overrun',record])},{balance:()=>fakeElement('div')});
    await descendants(root).find(node=>node.textContent==='Today').onclick();
    await descendants(root).find(node=>node.textContent==='Day').onclick();
    const block=descendants(root).find(node=>node.className==='caltimed');assert.ok(block);
    const menu=block.children[1];assert.equal(menu.hidden,true);
    block.children[0].onclick();assert.equal(menu.hidden,false);assert.equal(block.children[0].attrs['aria-expanded'],'true');
    for(const label of ['Add notes','Edit','Running over'])descendants(block).find(node=>node.textContent===label).onclick();
    assert.deepEqual(calls,[['notes',item],['edit',item],['overrun',item]]);
    for(const node of descendants(block).filter(node=>node.tagName==='button'))assert.equal(descendants(node).slice(1).some(child=>child.tagName==='button'),false);
    assert.equal(descendants(block).some(node=>node.textContent==='Mark done'),false);
    block.children[0].onclick();assert.equal(menu.hidden,true);
    await descendants(root).find(node=>node.textContent==='List').onclick();
    assert.ok(descendants(root).find(node=>node.className==='caleventrow').children[1].children.some(node=>node.textContent==='Add notes'));
  } finally {globalThis.document=previousDocument;globalThis.fetch=previousFetch;globalThis.requestAnimationFrame=previousFrame;}
});
