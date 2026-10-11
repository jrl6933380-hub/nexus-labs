import test from 'node:test';import assert from 'node:assert/strict';
import {createNexusMessagesHandler} from '../api/nexus-messages.js';
import {createAssistantHandler} from '../api/room-assistant.js';
const res=()=>({code:0,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('customer Messages metadata uses distinct account keys and never invokes owner team execution',async()=>{
 const keys=[],handler=createNexusMessagesHandler({getOwner:async()=>null,getUser:async req=>req.headers.user,store:{overview:async id=>{keys.push(id);return {specialists:[],groups:[],pinned_system_ids:[]};}},team:()=>{throw Error('private runner');}});
 for(const user of ['alice','bob']){const out=res();await handler({method:'GET',headers:{user}},out);assert.equal(out.code,200);assert.equal(out.body.customer,true);}
 assert.notEqual(keys[0],keys[1]);assert.ok(keys.every(id=>/^customer-[a-f0-9]{40}$/.test(id)));
 for(const request of [{method:'POST',body:{action:'team_create',owner:'Mrlopez'}},{method:'GET',query:{group_id:'group-private'}}]){const out=res();await handler({...request,headers:{user:'alice'}},out);assert.equal(out.code,403);}assert.equal(keys.length,2);
});
test('customer conversation reads use the authenticated account and fixed main conversation',async()=>{
 const calls=[],handler=createAssistantHandler({resolveUser:async req=>req.headers.user,conversations:{getConversation:async(user,id)=>{calls.push([user,id]);return [{role:'user',text:user}];}}});
 for(const user of ['alice','bob']){const out=res();await handler({method:'GET',headers:{user},query:{user:'owner',projectId:'private'}},out);assert.equal(out.code,200);assert.equal(out.body.turns[0].text,user);}
 const out=res();await handler({method:'GET',headers:{}},out);assert.equal(out.code,401);assert.deepEqual(calls,[['alice','nex-main'],['bob','nex-main']]);
});
test('a customer home turn uses the everyday Nex prompt and persists within that account',async()=>{
 let prompt,stored;const handler=createAssistantHandler({resolveUser:async()=> 'alice',conversations:{getConversation:async()=>[],appendTurns:async(...args)=>stored=args},ask:async input=>{prompt=input.body.system;return {text:JSON.stringify({kind:'reply',message:'Let’s talk through your day.'})};},meter:{reserveBuild:async()=>({ok:true,reservationId:'test',period:1}),settleBuild:async()=>{}},searchVaultFn:async()=>[]});
 const out=res();await handler({method:'POST',body:{surface:'nexus',message:'How can I organize my day?',projectId:'owner',context:{calendar:{items:[]}}}},out);assert.equal(out.code,200);assert.match(prompt,/main Nexus conversation/);assert.match(prompt,/never claim to save/);assert.deepEqual(stored.slice(0,2),['alice','nex-main']);
});
