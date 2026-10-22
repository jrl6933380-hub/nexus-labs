import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizePublicUrl,publicAddress,resolvePublicUrl,capturePublicPage,extractPage} from '../lib/intelligenceCapture.js';
import {createIntelligence,intelligenceBrief} from '../lib/intelligence.js';
import {createIntelligenceHandler} from '../api/intelligence.js';

function fixture(capture){
  const hashes=new Map(),values=new Map();let seq=0;
  const uuid=()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;
  const command=async([op,key,...args])=>{
    if(op==='SET'){if(values.has(key))return null;values.set(key,args[0]);return 'OK';}
    if(op==='EVAL'){
      const [count,k,arg]=args;
      if(key.includes('INCR')){const n=Number(values.get(k)||0)+1;values.set(k,n);return n;}
      if(values.get(k)===arg){values.delete(k);return 1;}return 0;
    }
    if(op==='HVALS')return [...(hashes.get(key)?.values()||[])];
    if(op==='HGET')return hashes.get(key)?.get(args[0])||null;
    if(op==='HSET'){if(!hashes.has(key))hashes.set(key,new Map());hashes.get(key).set(args[0],args[1]);return 1;}
    if(op==='HDEL')return hashes.get(key)?.delete(args[0])?1:0;
    throw Error('Unexpected command: '+op);
  };
  return {service:createIntelligence({command,capture,newId:uuid,now:()=>Date.UTC(2026,9,22)}),values};
}
const snapshot=text=>({text,title:'Pricing',hash:createHash('sha256').update(text).digest('hex'),capturedAt:'2026-10-22T12:00:00.000Z',url:'https://public.com/pricing',screenshot:null});

test('rejects private, disguised, credentialed and non-HTTPS URL inputs',()=>{
  for(const url of ['http://public.com','https://127.1','https://2130706433','https://0x7f000001','https://169.254.169.254','https://[::1]','https://user:pass@public.com','https://public.com:8443','https://x.internal'])assert.throws(()=>normalizePublicUrl(url));
  assert.equal(normalizePublicUrl('https://public.com/pricing#plan'),'https://public.com/pricing');
  assert.equal(publicAddress('::ffff:127.0.0.1'),false);
  assert.equal(publicAddress('100.64.0.2'),false);
});
test('checks every resolved address before capture',async()=>{
  await assert.rejects(resolvePublicUrl('https://public.com',async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]),/not a public website/);
});
test('validates redirect destinations and never requests an internal address',async()=>{
  let requests=0;
  await assert.rejects(capturePublicPage('https://public.com',{resolver:async()=>[{address:'93.184.216.34',family:4}],request:async()=>{requests++;return {status:302,location:'https://169.254.169.254/latest'};}}));
  assert.equal(requests,1);
});
test('extracts page facts, removes executable content and rejects challenge pages',()=>{
  const result=extractPage('<title>Plans &amp; pricing</title><script>do not include this</script><main><h1>Our plans</h1><p>Starter includes three projects and unlimited team members for $29 per month.</p></main>');
  assert.equal(result.title,'Plans & pricing');assert.doesNotMatch(result.text,/do not include/);assert.match(result.text,/\$29/);
  assert.throws(()=>extractPage('<title>Just a moment</title><p>Verify you are human</p>'));
});
test('tenant records and saved annotations remain isolated',async()=>{
  const {service}=fixture();const record=await service.add('alice',{name:'Competitor',urls:['https://public.com/pricing']});
  await service.annotate('alice',{id:record.id,pageId:record.pages[0].id,saved:true,note:'Check annual pricing.'});
  assert.equal((await service.overview('alice')).competitors[0].pages[0].saved,true);
  assert.deepEqual((await service.overview('bob')).competitors,[]);
  await assert.rejects(service.annotate('bob',{id:record.id,pageId:record.pages[0].id,note:'stolen'}),/not found/);
  await assert.rejects(service.remove('bob',{id:record.id}),/not found/);
});
test('stores a baseline, observes a change, retains comparison on unchanged and failed scans',async()=>{
  let text='Starter\n$29 per month';let failed=false;
  const {service}=fixture(async()=>{if(failed)throw Object.assign(Error('Access challenge'),{code:'BROWSER_REQUIRED'});return snapshot(text);});
  const record=await service.add('alice',{name:'Competitor',urls:['https://public.com/pricing']});const input={id:record.id,pageId:record.pages[0].id};
  let {page}=await service.scan('alice',input);assert.equal(page.change.kind,'baseline');
  text='Starter\n$39 per month';({page}=await service.scan('alice',input));assert.equal(page.change.kind,'changed');assert.deepEqual(page.change.added,['$39 per month']);assert.deepEqual(page.change.removed,['$29 per month']);
  ({page}=await service.scan('alice',input));assert.equal(page.lastResult,'unchanged');assert.equal(page.previous.text,'Starter\n$29 per month');
  failed=true;({page}=await service.scan('alice',input));assert.equal(page.status,'failed');assert.equal(page.latest.text,'Starter\n$39 per month');
  const brief=intelligenceBrief((await service.overview('alice')).competitors);assert.match(brief,/Coverage gap: Access challenge/);assert.match(brief,/Removed: \$29/);
});
test('serializes simultaneous account writes instead of losing state',async()=>{
  const {service}=fixture();const results=await Promise.allSettled([service.add('alice',{name:'A',urls:['https://a.com']}),service.add('alice',{name:'B',urls:['https://b.com']})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
});
test('bounds page count, duplicate imports, notes and daily capture spend',async()=>{
  let calls=0;const {service}=fixture(async()=>{calls++;return snapshot('Starter $29');});
  await assert.rejects(service.add('alice',{name:'Too many',urls:Array(4).fill('https://public.com')}),/three/);
  const record=await service.add('alice',{name:'A',urls:['https://public.com']});
  await assert.rejects(service.add('alice',{name:'Duplicate',urls:['https://public.com']}),/already/);
  await assert.rejects(service.annotate('alice',{id:record.id,pageId:record.pages[0].id,note:'x'.repeat(4001)}),/4,000/);
  for(let i=0;i<60;i++)await service.scan('alice',{id:record.id,pageId:record.pages[0].id});
  await assert.rejects(service.scan('alice',{id:record.id,pageId:record.pages[0].id}),error=>error.status===429);assert.equal(calls,60);
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.body=data;return this;}};}
test('API requires authentication, same-origin JSON writes and uses server identity',async()=>{
  const service=fixture().service;let owner=null;const handler=createIntelligenceHandler({service,authenticate:async()=>owner});
  const get=response();await handler({method:'GET'},get);assert.equal(get.code,401);
  owner='alice';const cross=response();await handler({method:'POST',headers:{host:'nexus.com',origin:'https://evil.com','content-type':'application/json'},body:{action:'add'}},cross);assert.equal(cross.code,403);
  const req={method:'POST',headers:{host:'nexus.com',origin:'https://nexus.com','content-type':'application/json'},body:{action:'add',owner:'bob',name:'A',urls:['https://public.com']}};
  const created=response();await handler(req,created);assert.equal(created.code,201);assert.equal((await service.overview('alice')).competitors.length,1);assert.equal((await service.overview('bob')).competitors.length,0);
  const invalid=response();await handler({...req,body:{action:'add',name:'Bad',urls:['http://localhost']}},invalid);assert.equal(invalid.code,400);
  const method=response();await handler({method:'PUT'},method);assert.equal(method.code,405);
});
