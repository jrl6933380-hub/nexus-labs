import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createForgeResearchImport} from '../lib/forgeResearchImport.js';
import {createForgeResearchHandler} from '../api/forge-research.js';
import {runScript} from '../lib/store/lua.js';
import {validateResearchImport} from '../public/forge-research-contract.js';
const candidate={candidate_id:'a'.repeat(32),businessName:'Example Barber',location:'Des Moines, Iowa',category:'barbers',
 phone:'(515) 555-0199',phone_source_url:'https://example.com/contact',website_status:'social_booking_only',original_status:'needs_checking',
 checked_at:'2026-11-05T10:00:00Z',source_urls:['https://example.com/contact'],notes:'Owner verified the public details.',
 identity_confirmed:true,phone_confirmed:true,website_confirmed:true};
const input=(changes={})=>({batch_id:'research-'+'b'.repeat(32),request_id:'review_request_1',candidates:[{...candidate,...changes}]});
function fixture(){
 const hashes=new Map();let queue=Promise.resolve();
 const hash=k=>{if(!hashes.has(k))hashes.set(k,new Map());return hashes.get(k);};
 const primitive=async([op,key,...args])=>{
  if(op==='HGET')return hash(key).get(args[0])??null;
  if(op==='HSET'){for(let i=0;i<args.length;i+=2)hash(key).set(args[i],args[i+1]);return 1;}
  if(op==='HGETALL')return [...hash(key)].flat();throw Error(op);
 };
 const command=args=>{if(args[0]!=='EVAL')return primitive(args);const n=Number(args[2]);const work=queue.then(()=>runScript(args[1],{keys:args.slice(3,3+n),argv:args.slice(3+n),redisCall:primitive}));queue=work.catch(()=>{});return work;};
 return {hash,importLeads:createForgeResearchImport({command,now:()=>Date.parse('2026-11-05T11:00:00Z')})};
}
test('approval validation rejects unverified, malformed and unresolved details',()=>{
 for(const bad of [{phone_confirmed:false},{identity_confirmed:false},{website_confirmed:false},{phone:'555'},{phone:'5155550199 ext 22'},
  {website_status:'has_website'},{website_status:'needs_checking'},{source_urls:['javascript:alert(1)']},{phone_source_url:'http://example.com'},{businessName:'<script>'}])assert.throws(()=>validateResearchImport(input(bad)));
 assert.equal(validateResearchImport(input()).candidates[0].phone,'(515) 555-0199');
});
test('real atomic script creates assigned leads with phone and research provenance',async()=>{
 const f=fixture();const result=await f.importLeads('justin','Mrlopez',input());assert.equal(result.created_count,1);
 const lead=JSON.parse([...f.hash('nexus:forge:leads').values()][0]);
 assert.equal(lead.assignedTo,'Mrlopez');assert.equal(lead.status,'assigned');assert.equal(lead.research.phone_source_url,candidate.phone_source_url);
 assert.equal(lead.source.importedBy,'Mrlopez');assert.equal(lead.research.identity_confirmed,true);assert.equal(lead.notes,candidate.notes);
 const again=await f.importLeads('justin','Mrlopez',input());assert.deepEqual(again,result);assert.equal(f.hash('nexus:forge:leads').size,1);
 await assert.rejects(f.importLeads('justin','Mrlopez',input({notes:'Changed after approval'})),e=>e.status===409);
});
test('concurrent imports, formatting differences and existing suppression never produce a second lead',async()=>{
 const f=fixture();const [a,b]=await Promise.all([
  f.importLeads('justin','Mrlopez',input()),
  f.importLeads('justin','Mrlopez',{...input({candidate_id:'c'.repeat(32),businessName:'Alias storefront',location:'DSM',phone:'+1 515-555-0199'}),batch_id:'research-'+'d'.repeat(32),request_id:'other_request_2'})]);
 assert.equal(a.created_count+b.created_count,1);assert.equal(a.duplicate_count+b.duplicate_count,1);
 const lead=JSON.parse([...f.hash('nexus:forge:leads').values()][0]);lead.suppressed=true;lead.lastDisposition='do_not_call';
 f.hash('nexus:forge:leads').set(lead.id,JSON.stringify(lead));
 const result=await f.importLeads('another','Mrlopez',{...input({businessName:'Renamed business'}),request_id:'suppression_check'});
 assert.equal(result.results[0].suppressed,true);assert.equal(result.created_count,0);assert.equal(f.hash('nexus:forge:leads').size,1);
 assert.equal(JSON.parse(f.hash('nexus:forge:leads').get(lead.id)).lastDisposition,'do_not_call');
});
test('name/location duplicates and deterministic batch identity are protected even if phone changed',async()=>{
 const f=fixture();await f.importLeads('justin','Mrlopez',input());
 const duplicate=await f.importLeads('justin','Mrlopez',{...input({phone:'5155550100'}),request_id:'edited_phone_request'});
 assert.equal(duplicate.duplicate_count,1);assert.equal(f.hash('nexus:forge:leads').size,1);
});
const req=(method='POST',body=input(),headers={})=>({method,body,headers:{host:'nexus-labs-sigma.vercel.app',origin:'https://nexus-labs-sigma.vercel.app','content-type':'application/json',...headers}});
const response=()=>({code:200,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
test('API requires an owner session, manager role, JSON and exact same HTTPS origin; bearer approval is refused',async()=>{
 let calls=0;const build=(owner=true,manager=true)=>createForgeResearchHandler({resolveAccount:async()=>({id:'justin',owner,workbenchUserId:'Mrlopez'}),isManager:async()=>manager,importLeads:async()=>{calls++;return {created_count:1};}});
 for(const [handler,request,code] of [
  [build(false),req(),403],[build(true,false),req(),403],[build(),req('POST',input(),{authorization:'Bearer device-token'}),403],
  [build(),req('POST',input(),{origin:'https://evil.example'}),403],[build(),req('POST',input(),{origin:undefined}),403],
  [build(),req('POST',input(),{'content-type':'text/plain'}),415],[build(),req('DELETE'),405],
 ]){const res=response();await handler(request,res);assert.equal(res.code,code);}
 assert.equal(calls,0);const res=response();await build()(req(),res);assert.equal(res.code,200);assert.equal(calls,1);
});
