import test from 'node:test';
import assert from 'node:assert/strict';
import {chatRequest,claimRestResume} from '../lib/nexChatRequests.js';
test('rest queue inputs stay tenant-scoped and a saved request can only be claimed once',async()=>{
 const originalFetch=globalThis.fetch,previous={url:process.env.KV_REST_API_URL,token:process.env.KV_REST_API_TOKEN};const data=new Map();
 process.env.KV_REST_API_URL='https://queue.invalid';process.env.KV_REST_API_TOKEN='test-only';
 globalThis.fetch=async(_url,{body})=>{const [op,key,value,...flags]=JSON.parse(body);let result=null;if(op==='GET')result=data.get(key)||null;if(op==='SET' && (!flags.includes('NX') || !data.has(key))){data.set(key,value);result='OK';}return {ok:true,json:async()=>({result})};};
 try{const id='12345678-1234-1234-1234-123456789abc';await chatRequest('alice',id,{state:'resting',payload:{message:'Alice private request'}});assert.equal(await chatRequest('bob',id),null);assert.equal((await chatRequest('alice',id)).payload.message,'Alice private request');assert.equal(await claimRestResume('alice',id),true);assert.equal(await claimRestResume('alice',id),false);assert.equal(await claimRestResume('bob',id),true);}
 finally{globalThis.fetch=originalFetch;if(previous.url===undefined)delete process.env.KV_REST_API_URL;else process.env.KV_REST_API_URL=previous.url;if(previous.token===undefined)delete process.env.KV_REST_API_TOKEN;else process.env.KV_REST_API_TOKEN=previous.token;}
});
