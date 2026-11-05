import {createHash} from 'node:crypto';
import {getStore} from './store/index.js';
import {prepareLead} from './forgeLeads.js';
import {validateResearchImport,normalizeResearchPhone} from '../public/forge-research-contract.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
// One transaction scans all leads (including suppressed records), adds approved leads,
// and saves its receipt. Replay cannot duplicate or overwrite a lead after a lost response.
export const RESEARCH_IMPORT_SCRIPT=`
local receipt=redis.call('HGET',KEYS[2],ARGV[1])
if receipt then
 local saved=cjson.decode(receipt)
 if saved.digest~=ARGV[2] then return cjson.encode({conflict=true}) end
 return receipt
end
local all=redis.call('HGETALL',KEYS[1])
local expected=cjson.decode(ARGV[3])
if #all~=#expected then return cjson.encode({changed=true}) end
for i=1,#expected,2 do
 if redis.call('HGET',KEYS[1],expected[i])~=expected[i+1] then return cjson.encode({changed=true}) end
end
local incoming=cjson.decode(ARGV[4])
for _,row in ipairs(incoming) do redis.call('HSET',KEYS[1],row.id,cjson.encode(row)) end
local result=ARGV[5]
redis.call('HSET',KEYS[2],ARGV[1],result)
return result`;
const norm=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

export function createForgeResearchImport({command=async args=>{
 const store=getStore();if(!store)throw fail('Forge storage is unavailable.',503);return store.command(args);
},now=Date.now}={}){
 return async(owner,username,input)=>{
  if(!/^[a-z0-9_-]{3,40}$/i.test(owner||'')||typeof username!=='string'||!username.trim())throw fail('Owner identity required.',403);
  const data=validateResearchImport(input),timestamp=now();
  const digest=hash(JSON.stringify({batch_id:data.batch_id,candidates:data.candidates}));
  const rows=data.candidates.map(c=>{
   const id='lead_research_'+hash(owner+'|'+data.batch_id+'|'+c.candidate_id).slice(0,32);
   const lead=prepareLead({businessName:c.businessName,phone:c.phone,location:c.location,
    category:c.category,websiteStatus:c.website_status,assignedTo:username,sourceUrl:c.source_urls[0]},
    {createdBy:username,id,at:timestamp});
   lead.status='assigned';lead.notes=c.notes;
   lead.research={batch_id:data.batch_id,candidate_id:c.candidate_id,checked_at:c.checked_at,
    original_status:c.original_status,source_urls:c.source_urls,phone_source_url:c.phone_source_url,
    reviewed_by:username,reviewed_at:new Date(timestamp).toISOString(),
    identity_confirmed:true,phone_confirmed:true,website_confirmed:true};
   lead.history=[{type:'research_import',by:username,at:timestamp,batch_id:data.batch_id}];
   return {candidate_id:c.candidate_id,lead};
  });
  for(let attempt=0;attempt<5;attempt++){
   const expected=await command(['HGETALL','nexus:forge:leads']);
   const existing=[];for(let i=1;i<expected.length;i+=2)existing.push(JSON.parse(expected[i]));
   const created=[],results=[];
   for(const row of rows){
    const duplicate=existing.find(l=>l.id===row.lead.id||normalizeResearchPhone(l.phone)===normalizeResearchPhone(row.lead.phone)||
     (norm(l.businessName)===norm(row.lead.businessName)&&norm(l.location)===norm(row.lead.location)));
    if(duplicate)results.push({candidate_id:row.candidate_id,status:'duplicate',lead_id:duplicate.id,suppressed:duplicate.suppressed===true});
    else{created.push(row.lead);existing.push(row.lead);results.push({candidate_id:row.candidate_id,status:'created',lead_id:row.lead.id,suppressed:false});}
   }
   const receipt={digest,results,imported_at:new Date(timestamp).toISOString()};
   const raw=await command(['EVAL',RESEARCH_IMPORT_SCRIPT,2,'nexus:forge:leads','nexus:forge:research:receipts:'+owner,
    data.request_id,digest,JSON.stringify(expected),JSON.stringify(created),JSON.stringify(receipt)]);
   const result=JSON.parse(raw);if(result.changed)continue;
   if(result.conflict)throw fail('This import request already has different details. Review the saved receipt before trying again.',409);
   return {results:result.results,created_count:result.results.filter(r=>r.status==='created').length,
    duplicate_count:result.results.filter(r=>r.status==='duplicate').length,imported_at:result.imported_at};
  }
  throw fail('Forge leads changed during import. Retry the same request.',409);
 };
}
export const importForgeResearch=createForgeResearchImport();
