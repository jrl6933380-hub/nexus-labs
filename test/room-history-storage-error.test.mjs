import test from 'node:test';
import assert from 'node:assert/strict';
test('a Redis error inside HTTP 200 never reports a successful saved project',async()=>{
 const oldFetch=globalThis.fetch,oldUrl=process.env.KV_REST_API_URL,oldToken=process.env.KV_REST_API_TOKEN;
 process.env.KV_REST_API_URL='https://storage.test';process.env.KV_REST_API_TOKEN='test';
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({error:'storage failure'})});
 try{const {saveBuild}=await import('../lib/roomHistory.js?workspace-storage-test');await assert.rejects(saveBuild('alice',{projectId:'test',html:'<html>test</html>'}),/Redis command LPUSH failed/);}
 finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.KV_REST_API_URL;else process.env.KV_REST_API_URL=oldUrl;if(oldToken===undefined)delete process.env.KV_REST_API_TOKEN;else process.env.KV_REST_API_TOKEN=oldToken;}
});
