import test from 'node:test';
import assert from 'node:assert/strict';
import {NEXUS_GUIDE,QUICK_STARTS,findGuideEntries,renderNexusGuide,renderFeatureHelp,draftNexusExample} from '../public/nexus-guide.js';
import {VIEWS,matchView} from '../public/workspace-views.js';

function element(tag){return {tagName:tag,children:[],attrs:{},className:'',value:'',setAttribute(k,v){this.attrs[k]=v;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}};}
const all=root=>[root,...root.children.flatMap(all)];

test('practical-use search finds everyday needs and marks future products honestly',()=>{
  assert.ok(findGuideEntries('recipe').some(entry=>entry.id==='memory'));
  assert.ok(findGuideEntries('sleep').some(entry=>entry.id==='build'));
  assert.ok(findGuideEntries('birthday').some(entry=>entry.id==='reminders'));
  assert.equal(NEXUS_GUIDE.find(entry=>entry.id==='legacy').status,'Planned');
  assert.equal(NEXUS_GUIDE.find(entry=>entry.id==='teams').status,'Planned');
  assert.ok(!NEXUS_GUIDE.find(entry=>entry.id==='groups').status);
  assert.ok(NEXUS_GUIDE.every(entry=>entry.view==='chat' || VIEWS[entry.view]));
  assert.equal(matchView('help'),'guide');assert.equal(matchView('open explore nexus'),'guide');
});
test('guide actions draft examples and route to spaces without any model or mutation request',()=>{
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch;globalThis.document={createElement:element};globalThis.fetch=()=>{throw new Error('Guide must not call a service');};
  const drafts=[],routes=[],ctx={draftPrompt:text=>drafts.push(text),openSystem:id=>routes.push(id),go:id=>routes.push(id),ask:()=>{throw new Error('Examples must not send automatically');}};
  try{
    const guide=renderNexusGuide(ctx),examples=all(guide).filter(node=>node.className==='guideexample');
    assert.ok(examples.length>QUICK_STARTS.length);for(const item of examples)item.onclick();
    assert.equal(drafts.length,examples.length);assert.ok(drafts.every(text=>typeof text==='string' && text.length>20));
    for(const item of all(guide).filter(node=>node.className==='guideopen'))item.onclick();
    assert.deepEqual(routes,NEXUS_GUIDE.map(entry=>entry.view));
    const search=all(guide).find(node=>node.tagName==='input');search.value='birthday';search.oninput();
    const cards=all(guide).filter(node=>node.className==='guidefeature');assert.equal(cards.length,1);
    assert.ok(all(cards[0]).some(node=>node.textContent==='Reminders'));
    search.value='no feature with this phrase';search.oninput();assert.match(all(guide).find(node=>node.className==='guidestatus').textContent,/0 features found/);
    const help=renderFeatureHelp('life',ctx);assert.equal(help.tagName,'details');assert.ok(!help.open);assert.equal(renderFeatureHelp('guide',ctx),null);
  }finally{globalThis.document=oldDocument;globalThis.fetch=oldFetch;}
});
test('drafting opens main chat, preserves an unsent message, and waits before filling the composer',async()=>{
  let opened=0,focused=0;const input={value:'My ingredients are rice and beans.',focus:()=>focused++};
  await draftNexusExample({input,openMain:async()=>{opened++;assert.equal(input.value,'My ingredients are rice and beans.');}},QUICK_STARTS[0].prompt);
  assert.equal(opened,1);assert.equal(focused,1);assert.equal(input.value,'My ingredients are rice and beans.\n\n'+QUICK_STARTS[0].prompt);
  input.value=QUICK_STARTS[0].prompt;await draftNexusExample({input,openMain:async()=>{}},QUICK_STARTS[0].prompt);assert.equal(input.value,QUICK_STARTS[0].prompt);
});
