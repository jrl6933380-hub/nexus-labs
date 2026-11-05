// Shared browser/server validation for owner-reviewed research imports.
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const text=(value,max,label)=>{
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f<>]/.test(value))fail('Check '+label+'.');
 return value.trim();
};
export const normalizeResearchPhone=value=>{
 let phone=String(value||'').replace(/\D/g,'');
 if(phone.length===11&&phone.startsWith('1'))phone=phone.slice(1);
 return phone;
};
export function researchUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>1600)fail('Use an HTTPS source link.');return u.href;}
 catch{fail('Use an HTTPS source link.');}
}
export function validateResearchImport(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Choose reviewed candidates.');
 if(!/^research-[a-f0-9]{32}$/.test(input.batch_id||''))fail('Invalid research batch.');
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(input.request_id||''))fail('Invalid import request.');
 if(!Array.isArray(input.candidates)||input.candidates.length<1||input.candidates.length>10)fail('Select one to ten candidates.');
 const seen=new Set();
 const candidates=input.candidates.map(c=>{
  if(!c||!/^[a-f0-9]{32}$/.test(c.candidate_id||'')||seen.has(c.candidate_id))fail('Invalid or repeated candidate.');seen.add(c.candidate_id);
  if(c.identity_confirmed!==true||c.phone_confirmed!==true||c.website_confirmed!==true)fail('Verify business identity, phone and website status before importing.');
  if(!['no_dedicated_site_found','social_booking_only'].includes(c.website_status))fail('Resolve the website check before importing.');
  const phone=text(c.phone,40,'the business phone');
  if(!/^\+?[\d ().-]+$/.test(phone)||!/^\d{10}$/.test(normalizeResearchPhone(phone)))fail('Use a verified ten-digit US phone number.');
  if(!Array.isArray(c.source_urls)||c.source_urls.length<1||c.source_urls.length>8)fail('Keep one to eight evidence links.');
  const checkedAt=text(c.checked_at,40,'the research date');
  if(!Number.isFinite(Date.parse(checkedAt))||Date.parse(checkedAt)>Date.now()+300000)fail('Check the research date.');
  return {
   candidate_id:c.candidate_id,businessName:text(c.businessName,120,'the business name'),
   location:text(c.location,180,'the business location'),category:text(c.category,80,'the business category'),
   phone,phone_source_url:researchUrl(c.phone_source_url),website_status:c.website_status,
   original_status:['no_dedicated_site_found','social_booking_only','has_website','needs_checking'].includes(c.original_status)?c.original_status:'needs_checking',
   checked_at:checkedAt,source_urls:[...new Set(c.source_urls.map(researchUrl))],
   notes:c.notes?text(c.notes,1000,'the research notes'):'',
   identity_confirmed:true,phone_confirmed:true,website_confirmed:true,
  };
 }).sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id));
 return {batch_id:input.batch_id,request_id:input.request_id,candidates};
}
