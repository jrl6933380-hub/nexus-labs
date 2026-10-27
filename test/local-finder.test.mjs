import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLocalOpportunities, OPPORTUNITY_COLUMNS} from '../lib/localOpportunities.js';
import {opportunitiesCsv} from '../public/local-opportunities.js';
import {createResearchStore, parseActorInput} from '../lib/researchJobs.js';
import {ACTORS, publicCatalog} from '../lib/actorCatalog.js';
const row = (name='Example Salon', address='1 Main St') => [name,'salons','Des Moines',address,'https://example.test','listed','yes','515-555-0100','','https://directory.test/example','https://example.test/contact','Booking is by phone on the contact page.','https://example.test/contact','2026-10-27T22:00:00Z','Draft: Could a booking website help your team?'];
const result = (rows=[row()]) => ({summary:'One observed service-fit signal.',sections:[{title:'Coverage and limits',items:['One site checked.']}],notes:'Fixture only.',tables:[{name:'Opportunities',columns:OPPORTUNITY_COLUMNS,rows}]});
function fixture() {
  const h=new Map();
  const command=async parts=>{
    const [cmd,,...rest]=parts;
    if(cmd==='HGET')return h.get(rest[0])??null;
    if(cmd==='HVALS')return [...h.values()];
    if(cmd==='HDEL'){h.delete(rest[0]);return 1;}
    if(cmd==='EVAL'){
      const [field,old,next,limit]=parts.slice(4);
      if((h.get(field)||'')!==old)return 0;
      if(!h.has(field)&&h.size>=Number(limit))return -1;
      h.set(field,next);return 1;
    }
    throw Error('Unexpected '+cmd);
  };
  return createResearchStore({command,wake:async()=>({woke:false})});
}
test('local finder is discoverable and all three bounded inputs are required',()=>{
  const a=publicCatalog().find(a=>a.id==='localfinder');
  assert.equal(a.cost,25);assert.equal(a.page,'/actor.html?a=localfinder');assert.equal(a.instructions,undefined);
  for(const missing of ['category','city','service']){
    const fields={category:'salons',city:'Des Moines',service:'booking websites'};delete fields[missing];
    assert.throws(()=>parseActorInput('localfinder',fields));
  }
  assert.throws(()=>parseActorInput('localfinder',{category:'x'.repeat(101),city:'Des Moines',service:'booking websites'}));
  assert.throws(()=>parseActorInput('localfinder',{category:'salons',city:'Des Moines',service:'booking websites',send:true}));
});
test('same business/location is deduplicated; different branch addresses survive',()=>{
  const a=row(), duplicate=row(' EXAMPLE SALON ','1 Main St.'), other=row('Example Salon','2 Main St');
  const r=normalizeLocalOpportunities(result([a,duplicate,other]));
  assert.equal(r.tables[0].rows.length,2);assert.match(r.notes,/Removed 1 duplicate/);
});
test('25 businesses and ten site attempts are hard result limits',()=>{
  const rows=Array.from({length:25},(_,i)=>{const r=row('Salon '+i);r[6]=i<10?'yes':'no';return r;});
  assert.equal(normalizeLocalOpportunities(result(rows)).tables[0].rows.length,25);
  assert.throws(()=>normalizeLocalOpportunities(result([...rows,row('Salon 26')])),/1–25/);
  rows[10][6]='blocked';rows[10][5]='blocked';
  assert.throws(()=>normalizeLocalOpportunities(result(rows)),/10 websites/);
  assert.throws(()=>normalizeLocalOpportunities(result([])),/empty search/);
});
test('evidence, contact provenance, timestamp and website state must agree',()=>{
  for(const index of [9,10,12,13]){
    const bad=row();bad[index]='';
    assert.throws(()=>normalizeLocalOpportunities(result([bad])));
  }
  for(const [index,value] of [[4,'javascript:alert(1)'],[9,'https://user:pass@example.test'],[5,'not listed'],[6,'maybe']]){
    const bad=row();bad[index]=value;
    assert.throws(()=>normalizeLocalOpportunities(result([bad])));
  }
  const unlisted=row();unlisted[4]='';unlisted[5]='not listed';unlisted[6]='no';
  assert.equal(normalizeLocalOpportunities(result([unlisted])).tables[0].rows[0][5],'not listed');
  const blocked=row();blocked[5]='blocked';blocked[6]='blocked';
  assert.equal(normalizeLocalOpportunities(result([blocked])).tables[0].rows[0][6],'blocked');
  const short=row().slice(0,-1);assert.throws(()=>normalizeLocalOpportunities(result([short])),/15 cells/);
});
test('CSV preserves commas/quotes/newlines and neutralizes formulas including phones',()=>{
  const csv=opportunitiesCsv({columns:['Name','Phone','Note'],rows:[['A, "B"','+15155550100','=SUM(1,2)'],['@cmd','-1','text\nline']]});
  assert.ok(csv.startsWith('﻿'));assert.ok(csv.includes('"A, ""B"""'));assert.ok(csv.includes('"\'+15155550100"'));assert.ok(csv.includes('"\'=SUM(1,2)"'));assert.ok(csv.includes('"\'@cmd"'));assert.ok(csv.includes('"text\nline"'));assert.ok(csv.endsWith('\r\n'));
});
test('shared submit/claim/complete/history path preserves deduplicated export',async()=>{
  const s=fixture(),w=await s.createLink({label:'test',credits:50});
  const j=await s.submit(w.token,{actor:'localfinder',category:'salons',city:'Des Moines',service:'booking websites'});
  assert.equal(j.credits_left,25);
  const c=await s.claim({job_id:j.job_id});assert.equal(c.actor,'localfinder');assert.match(c.instructions,/untrusted/);assert.match(c.instructions,/Do not contact anyone/);
  await assert.rejects(()=>s.complete({job_id:j.job_id,result:result(Array.from({length:11},(_,i)=>row('Salon '+i)))}),/10 websites/);
  await s.complete({job_id:j.job_id,result:result([row(),row()])});
  const status=await s.status(w.token,{job_id:j.job_id});
  assert.equal(status.result.tables[0].rows.length,1);assert.equal(status.status,'done');
  assert.equal((await s.history(w.token))[0].actor,'localfinder');
  await assert.rejects(()=>s.status('other-wallet',{job_id:j.job_id}));
});
test('failed local search returns exactly 25 credits and cannot refund twice',async()=>{
  const s=fixture(),w=await s.createLink({label:'test',credits:25});
  const j=await s.submit(w.token,{actor:'localfinder',category:'salons',city:'Des Moines',service:'booking websites'});
  await s.claim({job_id:j.job_id});
  const done=await s.complete({job_id:j.job_id,error:'No business could be verified.'});assert.equal(done.refunded,true);
  assert.equal((await s.walletByToken(w.token)).credits,25);
  await assert.rejects(()=>s.complete({job_id:j.job_id,error:'Again'}));
  assert.equal((await s.walletByToken(w.token)).credits,25);
});
