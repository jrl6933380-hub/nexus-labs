import test from 'node:test';
import assert from 'node:assert/strict';
import {chat,reviewImage} from '../scripts/ally/qwen-console.mjs';

test('thinking is opt-in and local only',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(String(url).endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'local-qwen'}]})};
  return {ok:true,json:async()=>({choices:[{message:{content:'{"kind":"reply","answer":"Ready"}'}}]})};
 };
 const r=await chat({message:'Plan a landing page',thinking:true},{fetchImpl});
 assert.equal(r.answer,'Ready');
 assert.equal(r.thinking,true);
 assert.ok(calls.every(x=>String(x.url).startsWith('http://127.0.0.1:9931/')));
 const payload=JSON.parse(calls.at(-1).opts.body);
 assert.equal(payload.chat_template_kwargs.enable_thinking,true);
 assert.equal(payload.response_format.type,'json_object');
 assert.equal(payload.tools,undefined);
 await assert.rejects(chat({message:'hello',thinking:'yes'},{fetchImpl}),/Invalid thinking/);
});

test('image analysis accepts bounded local PNG and rejects remote links',async()=>{
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 const image='data:image/png;base64,'+Buffer.concat([signature,Buffer.alloc(160)]).toString('base64');
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(String(url).endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'local-qwen'}]})};
  return {ok:true,json:async()=>({choices:[{message:{content:'A simple layout.'}}]})};
 };
 const r=await reviewImage({prompt:'Describe this image',image},{fetchImpl});
 assert.equal(r.answer,'A simple layout.');
 assert.equal(r.stored,false);
 assert.equal(calls.length,2);
 const body=JSON.parse(calls.at(-1).opts.body);
 assert.equal(body.messages[1].content[1].image_url.url,image);
 assert.equal(body.tools,undefined);
 await assert.rejects(reviewImage({prompt:'What is this?',image:'https://example.org/image.png'},{fetchImpl}),/Choose a PNG/);
 await assert.rejects(reviewImage({prompt:'What is this?',image:'data:image/png;base64,'+Buffer.alloc(160).toString('base64')},{fetchImpl}),/Image content/);
});
