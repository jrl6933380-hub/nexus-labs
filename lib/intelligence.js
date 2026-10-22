import { randomUUID } from 'node:crypto';
import { normalizePublicUrl, capturePublicPage, compareCaptures } from './intelligenceCapture.js';

const fail = (message,status=400) => Object.assign(new Error(message),{status});
const idPattern = /^[a-f0-9-]{36}$/;
const LIMITS = {competitors:12,pages:3,dailyCaptures:60};
async function redis(command) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw fail('Intelligence storage is unavailable.',503);
  const response = await fetch(process.env.KV_REST_API_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.KV_REST_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(8000)});
  const data = await response.json();
  if (!response.ok || data.error) throw fail('Intelligence storage could not complete the request.',503);
  return data.result;
}
const unlockScript = 'if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end';
const quotaScript = 'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],172800) end; return n';
export function createIntelligence({command=redis,capture=capturePublicPage,now=Date.now,newId=randomUUID}={}) {
  const key = owner => {if(!owner || typeof owner!=='string')throw fail('Sign in required.',401);return 'nexus:intelligence:v1:'+encodeURIComponent(owner);};
  async function lock(owner,run) {
    const lockKey=key(owner)+':lock', token=newId();
    if (!await command(['SET',lockKey,token,'NX','EX',90])) throw fail('Another Intelligence action is running. Try again shortly.',409);
    try{return await run();}finally{await command(['EVAL',unlockScript,'1',lockKey,token]);}
  }
  async function records(owner) {
    const values=await command(['HVALS',key(owner)]);
    return (values||[]).map(v=>JSON.parse(v)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async function get(owner,id){if(!idPattern.test(String(id)))throw fail('Invalid competitor.');const raw=await command(['HGET',key(owner),id]);if(!raw)throw fail('Competitor not found.',404);return JSON.parse(raw);}
  async function write(owner,record){await command(['HSET',key(owner),record.id,JSON.stringify(record)]);return record;}
  return {
    async overview(owner) {return {competitors:await records(owner),limits:LIMITS,capabilities:{manualCapture:true,screenshots:false,scheduledMonitoring:false,adCollection:false,aiAnalysis:false}};},
    async add(owner,input={}) {return lock(owner,async()=>{
      const name=String(input.name||'').trim().slice(0,100);
      if(!name)throw fail('Enter a competitor name.');
      if(!Array.isArray(input.urls)||!input.urls.length||input.urls.length>LIMITS.pages)throw fail('Add between one and three page URLs.');
      const urls=[...new Set(input.urls.map(normalizePublicUrl))];
      const all=await records(owner);if(all.length>=LIMITS.competitors)throw fail('This initial release supports 12 competitors per account.');
      if(all.some(c=>c.pages.some(p=>urls.includes(p.url))))throw fail('One of those pages is already on your watchlist.');
      return write(owner,{id:newId(),name,createdAt:new Date(now()).toISOString(),pages:urls.map(url=>({id:newId(),url,latest:null,previous:null,change:null,status:'not_scanned',error:null,saved:false,note:''}))});
    });},
    async scan(owner,{id,pageId}={}) {return lock(owner,async()=>{
      const record=await get(owner,id),page=record.pages.find(p=>p.id===pageId);if(!page)throw fail('Page not found.',404);
      const day=new Date(now()).toISOString().slice(0,10);
      const count=await command(['EVAL',quotaScript,'1',key(owner)+':captures:'+day]);
      if(Number(count)>LIMITS.dailyCaptures)throw fail('Daily capture allowance reached. Try again tomorrow.',429);
      const attemptedAt=new Date(now()).toISOString();
      try {
        const latest=await capture(page.url);const change=compareCaptures(page.latest,latest);
        if(change.kind!=='unchanged'){page.previous=page.latest;page.change=change;}
        page.latest=latest;
        page.lastResult=change.kind;page.lastCheckedAt=attemptedAt;page.status='captured';page.error=null;
      }catch(error){page.status='failed';page.lastCheckedAt=attemptedAt;page.error={code:error.code||'CAPTURE_FAILED',message:error.code?error.message:'Capture failed. Try again shortly.'};}
      await write(owner,record);return {competitor:record,page};
    });},
    async annotate(owner,{id,pageId,saved,note}={}) {return lock(owner,async()=>{
      const record=await get(owner,id),page=record.pages.find(p=>p.id===pageId);if(!page)throw fail('Page not found.',404);
      if(saved!==undefined){if(typeof saved!=='boolean')throw fail('Invalid saved state.');page.saved=saved;}
      if(note!==undefined){if(typeof note!=='string'||note.length>4000)throw fail('Notes must be under 4,000 characters.');page.note=note;}
      return write(owner,record);
    });},
    async remove(owner,{id}={}) {return lock(owner,async()=>{await get(owner,id);await command(['HDEL',key(owner),id]);return {removed:true};});},
  };
}
export function intelligenceBrief(competitors) {
  const lines=['# Nexus / Intelligence','',`Exported ${new Date().toISOString()}`,'','Observed page content only. No inferred ad performance or AI analysis.',''];
  for(const competitor of competitors){lines.push(`## ${competitor.name}`,'');for(const page of competitor.pages){lines.push(`Source: ${page.url}`,`Last checked: ${page.lastCheckedAt||'Not scanned'}`,`Result: ${page.status==='failed'?'Inspection incomplete':page.lastResult||'Not scanned'}`);
    if(page.latest)lines.push(`Latest successful capture: ${page.latest.capturedAt}`,`Title: ${page.latest.title}`);
    if(page.error)lines.push(`Coverage gap: ${page.error.message}`);
    if(page.previous)lines.push(`Comparison baseline: ${page.previous.capturedAt}`);
    for(const s of page.change?.removed||[])lines.push(`Removed: ${s}`);
    for(const s of page.change?.added||[])lines.push(`Added: ${s}`);
    if(page.note)lines.push(`Research note: ${page.note}`);lines.push('');}}
  return lines.join('\n');
}
