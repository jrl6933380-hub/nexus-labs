import test from 'node:test';
import assert from 'node:assert/strict';
import {friendlyError,showFeedback} from '../public/ux.js';
import {renderWelcome} from '../public/workspace-views.js';
import {renderReminders} from '../public/reminders.js';

function element(tag){return {tagName:tag,children:[],attrs:{},className:'',value:'',setAttribute(k,v){this.attrs[k]=v;},append(...nodes){this.children.push(...nodes);},prepend(...nodes){this.children.unshift(...nodes);},appendChild(node){this.children.push(node);},replaceChildren(...nodes){this.children=nodes;},focus(){}};}
const all=root=>[root,...root.children.flatMap(all)];

test('errors hide service diagnostics and give actionable account, retry, and conflict guidance',()=>{
  assert.match(friendlyError(Object.assign(new Error('opaque'),{status:401})),/sign in again/);
  assert.match(friendlyError(Object.assign(new Error('opaque'),{status:429})),/Wait a moment/);
  const error=friendlyError(new Error('Missing KV_REST_API_TOKEN /api/life HTTP 500'),{subject:'your answer',keepDraft:true});
  assert.doesNotMatch(error,/KV_|\/api\/|HTTP|500/);assert.match(error,/answers are still here/);assert.match(error,/try again/);
  assert.equal(friendlyError(new Error('That time is taken. Choose an open time or ask Nex to help.')),'That time is taken. Choose an open time or ask Nex to help.');
  assert.equal(friendlyError(new Error('Choose a date for this time.')),'Choose a date for this time.');
});

test('welcome has one main action and collapsed goal choices route to the correct product',()=>{
  const previous=globalThis.document;globalThis.document={createElement:element};const prompts=[],routes=[];
  try{
    const root=renderWelcome({ask:prompt=>prompts.push(prompt),go:view=>routes.push(view)});
    const primary=all(root).filter(el=>el.className==='uxprimary');assert.equal(primary.length,1);primary[0].onclick();assert.match(prompts[0],/Do not build or change anything/);
    const options=all(root).find(el=>el.tagName==='details');assert.ok(!options.open);
    for(const choice of all(options).filter(el=>el.className==='starter'))choice.onclick();
    assert.deepEqual(routes,['workbench','planner','life']);
    const status=showFeedback(root,'Answer saved.');assert.equal(status.attrs.role,'status');assert.equal(status.attrs['aria-live'],'polite');
  }finally{globalThis.document=previous;}
});

test('failed quick capture keeps the typed reminder and retry enabled, then confirms the saved title',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch;globalThis.document={createElement:element};let fail=true,items=[];
  globalThis.fetch=async(url,options)=>{
    if(options?.method==='POST'){
      if(fail)return {ok:false,status:503,json:async()=>({error:'Redis /api/reminders internal error'})};
      const body=JSON.parse(options.body);items=[{id:'saved',title:body.title,status:'planned'}];
    }
    return {ok:true,json:async()=>({items})};
  };
  try{
    const root=await renderReminders({ask(){}}),form=all(root).find(el=>el.className==='reminderquick');form.children[0].value='Call Dad';
    await form.onsubmit({preventDefault(){}});assert.equal(form.children[0].value,'Call Dad');assert.equal(form.children[1].disabled,false);
    const status=all(root).find(el=>el.className==='reminderstatus');assert.match(status.textContent,/try again/);assert.doesNotMatch(status.textContent,/Redis|\/api\//);
    fail=false;await form.onsubmit({preventDefault(){}});assert.equal(all(root).find(el=>el.className==='uxfeedback').textContent,'Added reminder: Call Dad.');
  }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});
