import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAllyAdReviewQueue,AD_REVIEW_CHUNK_BYTES} from '../lib/allyAdReviewQueue.js';
import {createAllyAdReviewHandler} from '../api/ally-ad-review.js';
import {executeTool,INSTRUCTIONS} from '../scripts/ally/qwen-terminal-agent.mjs';

function memory(){
 const strings=new Map(),lists=new Map();
 return async args=>{
  const [cmd,...a]=args;
  if(cmd==='GET')return strings.get(a[0])??null;
  if(cmd==='SET'){
   if(a.includes('NX')&&strings.has(a[0]))return null;
   strings.set(a[0],a[1]);return 'OK';
  }
  if(cmd==='LPUSH'){const l=lists.get(a[0])||[];l.unshift(...a.slice(1));lists.set(a[0],l);return l.length;}
  if(cmd==='LTRIM'){const l=lists.get(a[0])||[];lists.set(a[0],l.slice(+a[1],+a[2]+1));return 'OK';}
  if(cmd==='EXPIRE')return 1;
  if(cmd==='LRANGE')return (lists.get(a[0])||[]).slice(+a[1],+a[2]+1);
  if(cmd==='MGET')return a.map(key=>strings.get(key)??null);
  if(cmd==='EVAL'){
   const [,count,key,previous,next]=a;
   assert.equal(count,1);
   if(strings.get(key)!==previous)return 0;
   strings.set(key,next);return 1;
  }
  throw Error('Unsupported mock command '+cmd);
 };
}
function fakeVideo(length=AD_REVIEW_CHUNK_BYTES+125){
 const bytes=Buffer.alloc(length,0x42);
 bytes.write('ftyp',4,'ascii');return bytes;
}
const sha=data=>createHash('sha256').update(data).digest('hex');
async function uploaded(q,owner='justin',device='ally-A',video=fakeVideo()){
 const begin=await q.begin(owner,device,{project_id:'Test-Project-0123',title:'Qwen test ad',bytes:video.length,sha256:sha(video),duration_ms:15000});
 const count=Math.ceil(video.length/AD_REVIEW_CHUNK_BYTES);
 for(let i=0;i<count;i++)await q.part(owner,device,{id:begin.id,index:i,data:video.subarray(i*AD_REVIEW_CHUNK_BYTES,(i+1)*AD_REVIEW_CHUNK_BYTES).toString('base64')});
 await q.finish(owner,device,begin.id);return begin.id;
}
function response(){
 return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(v){this.code=v;return this;},json(v){this.data=v;return this;},end(v){this.body=v;return this;}};
}
test('Qwen upload stays private and supports byte-range video on phone',async()=>{
 const q=createAllyAdReviewQueue({command:memory(),now:()=>12345});
 const bytes=fakeVideo();
 const id=await uploaded(q,'justin','ally-A',bytes);
 const rows=await q.list('justin');assert.equal(rows.length,1);
 assert.equal(rows[0].status,'pending_review');
 assert.equal((await q.list('someone-else')).length,0);
 const r=await q.videoRange('justin',id,'bytes=125-270');
 assert.equal(r.partial,true);assert.equal(r.data.length,146);
 assert.deepEqual(r.data,bytes.subarray(125,271));
 const tail=await q.videoRange('justin',id,'bytes=-40');
 assert.deepEqual(tail.data,bytes.subarray(-40));
 await assert.rejects(()=>q.videoRange('justin',id,'bytes=999999999-'),{status:416});
 const approved=await q.decide('justin',id,'approved','Looks good.');
 assert.equal(approved.status,'approved');
 assert.equal(approved.review_note,'Looks good.');
 await assert.rejects(()=>q.decide('justin',id,'rejected','changed my mind'),{status:409});
 assert.equal((await q.videoRange('justin',id)).data.length,bytes.length);
});
test('upload cannot be completed with missing/corrupt parts or from another device',async()=>{
 const q=createAllyAdReviewQueue({command:memory()});
 const bytes=fakeVideo(300000);
 const rec=await q.begin('justin','ally-A',{project_id:'Safe-123',title:'Review',bytes:bytes.length,sha256:sha(bytes),duration_ms:15000});
 await assert.rejects(()=>q.finish('justin','ally-A',rec.id),{status:409});
 await assert.rejects(()=>q.part('justin','ally-B',{id:rec.id,index:0,data:'AQ=='}),{status:403});
 await assert.rejects(()=>q.part('justin','ally-A',{id:rec.id,index:0,data:Buffer.alloc(10).toString('base64')}),{status:400});
 await assert.rejects(()=>q.begin('justin','ally-B',{project_id:'Safe-123',title:'Review',bytes:bytes.length,sha256:sha(bytes),duration_ms:15000}),{status:409});
 await assert.rejects(()=>q.decide('justin',rec.id,'approved'),{status:409});
});
test('upload chunks are exact and duplicate-safe',async()=>{
 const q=createAllyAdReviewQueue({command:memory()});
 const bytes=fakeVideo(150000),rec=await q.begin('justin','ally-A',{project_id:'Safe-123',title:'Review',bytes:bytes.length,sha256:sha(bytes),duration_ms:15000});
 const first=bytes.subarray(0,AD_REVIEW_CHUNK_BYTES).toString('base64');
 assert.deepEqual(await q.part('justin','ally-A',{id:rec.id,index:0,data:first}),{accepted:true,index:0});
 assert.deepEqual(await q.part('justin','ally-A',{id:rec.id,index:0,data:first}),{accepted:true,index:0});
 const altered=Buffer.alloc(AD_REVIEW_CHUNK_BYTES).toString('base64');
 await assert.rejects(()=>q.part('justin','ally-A',{id:rec.id,index:0,data:altered}),{status:409});
});
test('API rejects non-owner decisions and disallows cross-site writes',async()=>{
 const q=createAllyAdReviewQueue({command:memory()});
 const handler=createAllyAdReviewHandler({queue:q,bridge:{authorizeActiveDevice:async token=>{if(token!=='valid')throw Object.assign(Error('Not paired'),{status:401});return {owner:'justin',device_id:'ally-A'};}},resolveAccount:async req=>req.owner?{owner:true,id:'justin'}:{owner:false,id:'visitor'}});
 let res=response();
 await handler({method:'GET',owner:false,headers:{host:'nexus.example'},query:{}},res);
 assert.equal(res.code,403);
 res=response();await handler({method:'POST',owner:true,headers:{host:'nexus.example',origin:'https://attacker.example','content-type':'application/json'},body:{action:'decide',input:{id:'x',decision:'approved'}}},res);
 assert.equal(res.code,403);
 res=response();await handler({method:'POST',owner:false,headers:{host:'nexus.example','content-type':'application/json',authorization:'Bearer invalid'},body:{action:'upload_begin',input:{}}},res);
 assert.equal(res.code,401);
 res=response();await handler({method:'POST',owner:true,headers:{host:'nexus.example','content-type':'application/json'},body:{action:'decide',input:{id:'x',decision:'approved'}}},res);
 assert.equal(res.code,403); // browser decisions require Origin
});
test('owner-only video endpoint produces RFC byte ranges',async()=>{
 const q=createAllyAdReviewQueue({command:memory()});
 const bytes=fakeVideo(),id=await uploaded(q);
 const handler=createAllyAdReviewHandler({queue:q,resolveAccount:async()=>({owner:true,id:'justin'})});
 const r=response();
 await handler({method:'GET',headers:{host:'nexus.example',range:'bytes=0-9'},query:{action:'video',id}},r);
 assert.equal(r.code,206);
 assert.equal(r.headers['Content-Range'],'bytes 0-9/'+bytes.length);
 assert.deepEqual(r.body,bytes.subarray(0,10));
});
test('PowerShell review helper does not bind the reserved automatic input variable',async()=>{
 const uploader=await readFile(new URL('../scripts/ally/submit-ad-review.ps1',import.meta.url),'utf8');
 assert.match(uploader,/function Call-Review\(\[string\]\$action,\[hashtable\]\$reviewFields\)/);
 assert.match(uploader,/\$payload=@\{action=\$action;input=\$reviewFields\}\|ConvertTo-Json/);
 assert.doesNotMatch(uploader,/function Call-Review\([^\n]*\[hashtable\]\$input\)/);
});
test('Qwen submit_ad stays on a fixed PowerShell uploader with no model-provided command',async()=>{
 const calls=[];
 const run=async(file,argv,opts)=>{calls.push({file,argv,opts});return {stdout:'NEXUS_REVIEW_SUBMITTED fake',stderr:''};};
 const result=await executeTool({tool:'ad_macro',args:{action:'submit_ad',project_id:'Safe-123'}},{workspace:process.cwd(),commandRunner:run});
 assert.equal(result.status,'succeeded');
 assert.equal(calls[0].file,'powershell.exe');
 assert.equal(calls[0].opts.shell,false);
 assert.equal(calls[0].argv.at(-2),'-ProjectId');
 assert.equal(calls[0].argv.at(-1),'Safe-123');
 assert.match(calls[0].argv[5],/submit-ad-review\.ps1$/);
 assert.match(INSTRUCTIONS,/submit_ad/);
 await assert.rejects(()=>executeTool({tool:'ad_macro',args:{action:'submit_ad',project_id:'../secret'}},{workspace:process.cwd(),commandRunner:run}));
 assert.equal(calls.length,1);
});
