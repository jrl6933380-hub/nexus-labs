#!/usr/bin/env node
// Local, deterministic preview + pitch pack for REVIEWED Forge leads.
// No model, network, browser, outreach, publishing or billing. Lead data is treated as text only.
import {readFile,writeFile,mkdir,readdir,lstat,rename} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {generateSiteVariants} from '../../public/site-compose.mjs';
import {generatePitchScript} from '../../public/forge-pitch.js';
import {LAUNCH_OFFER,TIERS} from '../../lib/forgeProgram.js';

const DEFAULT_ROOT=join(process.env.LOCALAPPDATA||process.cwd(),'NexusAlly','forge-leads');
const NO_SITE=new Set(['no_dedicated_site_found','social_booking_only']);
const UNCHECKED='needs_checking';
const BATCH_NAME=/^batch-[0-9a-f-]{8,64}$/;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug=(s,n)=>String(n).padStart(2,'0')+'-'+String(s).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
const sha=text=>createHash('sha256').update(text).digest('hex');

// The approved launch offer is OPT-IN. Without it, the pitch says to confirm the offer instead of quoting a price.
export function launchOffer(){
 const tier=TIERS.launch;
 return {tiers:[{key:'launch',name:'Launch',priceCents:tier.priceCents,signUpCents:LAUNCH_OFFER.signUpCents,
  editsPerMonth:null,editsPromoLabel:'unlimited minor edits during launch',aiAssistant:false}]};
}

// picks: 'eligible' or an array of 1-based positions in the batch review.
export function choose(batch,picks){
 const list=Array.isArray(batch?.candidates)?batch.candidates:[];
 if(batch?.status!=='ready_for_review')throw Error('Only a finished (ready_for_review) research batch can be used.');
 let indexes;
 if(picks==='eligible')indexes=list.map((c,i)=>NO_SITE.has(c.status)&&!c.duplicate?i:-1).filter(i=>i>=0);
 else{
  if(!Array.isArray(picks)||!picks.length||picks.length>10||picks.some(n=>!Number.isInteger(n)||n<1||n>list.length))throw Error('Pick 1-10 leads by their number in the review, or use eligible.');
  indexes=[...new Set(picks.map(n=>n-1))];
 }
 if(!indexes.length)throw Error('No eligible leads. Nothing was built.');
 return indexes.map(i=>{
  const c=list[i];
  if(c.status==='has_website')throw Error(`Lead ${i+1} (${String(c.name).slice(0,60)}) already has a website; not building a pitch for it.`);
  if(c.duplicate)throw Error(`Lead ${i+1} (${String(c.name).slice(0,60)}) was found in an earlier batch.`);
  if(!NO_SITE.has(c.status)&&c.status!==UNCHECKED)throw Error(`Lead ${i+1} has an unknown website status.`);
  return {position:i+1,candidate:c};
 });
}

export function pitchText(name,pitch){
 return [`PITCH FOR ${name}`,'',pitch.opener,'','WHAT WE FOUND',...pitch.weaknesses.map(x=>'- '+x),'','DISCOVERY QUESTIONS',...pitch.discoveryQuestions.map(x=>'- '+x),'',
  pitch.demoLabel.toUpperCase(),pitch.demoLine,'','PRICING',pitch.pricingLine,'','OBJECTIONS',...pitch.objections.map(o=>`- "${o.objection}" -> ${o.response}`),'','UPSELL',pitch.upsell,'','NEXT STEP',pitch.nextStep,'',
  'Nothing has been sent. Confirm the business and its website status yourself before any call.'].join('\n');
}

function indexHtml(batch,rows){
 const cards=rows.map(r=>`<section><h2>${escape(r.name)}</h2><p>${escape(r.location)} · ${escape(r.label)}${r.unverified?' · <b>unverified</b>':''}</p>
<p>${r.previews.map(p=>`<a href="${escape(r.folder)}/${escape(p.file)}">${escape(p.label)} preview</a>`).join(' · ')} · <a href="${escape(r.folder)}/pitch.txt">Pitch</a></p>
${r.phone?`<p>Phone from listing (unverified): ${escape(r.phone)}</p>`:''}</section>`).join('');
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Forge previews</title><style>body{font:16px system-ui;margin:0;padding:16px;background:#111;color:#f4efe4}section{border:1px solid #444;border-radius:10px;padding:12px;margin:12px 0}a{color:#d4af37}</style><h1>Forge previews: ${escape(batch.spec?.business)} in ${escape(batch.spec?.city)}</h1><p>Concept previews and call notes only. Nothing was sent, published or posted.</p>${cards}</html>`;
}

// Pure: returns the files to write. Never contacts anything.
export function buildPack({batch,picks,offer=null}){
 const chosen=choose(batch,picks),files=[],rows=[];
 for(const {position,candidate:c} of chosen){
  const folder=slug(c.name,position);
  const siteLead={businessName:c.name,category:batch.spec?.business,location:c.location};
  const variants=generateSiteVariants(siteLead);
  const pitchLead={...siteLead,websiteStatus:c.status,siteStatus:'ready',siteHtml:variants[0].html,
   research:{identity_confirmed:false,website_confirmed:false,checked_at:c.checked_at}};
  const pitch=generatePitchScript(pitchLead,offer);
  const previews=variants.map(v=>({label:v.label,file:v.id+'.html'}));
  for(const v of variants)files.push({path:`${folder}/${v.id}.html`,content:v.html});
  files.push({path:`${folder}/pitch.txt`,content:pitchText(c.name,pitch)});
  files.push({path:`${folder}/pitch.json`,content:JSON.stringify({lead:{name:c.name,location:c.location,website_status:c.status,notes:String(c.notes||'').slice(0,600),
   evidence_urls:(c.evidence_urls||[]).slice(0,4),map_url:c.map_url,phone_suggestion:c.phone_suggestion||'',phone_source_url:c.phone_source_url||'',checked_at:c.checked_at||''},pitch},null,2)});
  rows.push({name:c.name,location:c.location,folder,previews,phone:c.phone_suggestion||'',unverified:c.status===UNCHECKED,
   label:{no_dedicated_site_found:'No dedicated website found',social_booking_only:'Social / booking only',needs_checking:'Needs checking'}[c.status]});
 }
 files.push({path:'index.html',content:indexHtml(batch,rows)});
 files.push({path:'pack.json',content:JSON.stringify({version:1,created_at:new Date().toISOString(),business:batch.spec?.business,city:batch.spec?.city,
  leads:rows.map(r=>({name:r.name,folder:r.folder,unverified:r.unverified})),files:files.map(f=>({path:f.path,sha256:sha(f.content),bytes:Buffer.byteLength(f.content)}))},null,2)});
 return {files,leads:rows.length};
}

export async function readBatch(root,name){
 if(!BATCH_NAME.test(String(name)))throw Error('Unexpected batch name.');
 const file=join(root,'batches',name,'batch.json'),info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size>1000000)throw Error('Unexpected batch file.');
 return JSON.parse(await readFile(file,'utf8'));
}
export async function latestBatchName(root){
 let best=null;
 for(const name of await readdir(join(root,'batches')).catch(()=>[])){
  if(!BATCH_NAME.test(name))continue;
  try{const b=await readBatch(root,name);if(b.status==='ready_for_review'&&(!best||String(b.created_at)>best.at))best={name,at:String(b.created_at)};}catch{}
 }
 if(!best)throw Error('No finished research batch found.');
 return best.name;
}

// Writes into a NEW folder only; an existing pack is never overwritten.
export async function writePack(root,batchName,pack,{now=new Date()}={}){
 const stamp=now.toISOString().replace(/[-:]/g,'').slice(0,15);
 const dir=join(root,'previews',`${batchName}-${stamp}`);
 await mkdir(join(root,'previews'),{recursive:true});
 await mkdir(dir);
 for(const f of pack.files){
  const target=join(dir,...f.path.split('/'));
  await mkdir(dirname(target),{recursive:true});
  const temp=target+'.tmp';await writeFile(temp,f.content,'utf8');await rename(temp,target);
 }
 return dir;
}

export async function run({batch,picks,launch=false,list=false,root=DEFAULT_ROOT,now}={}){
 const name=batch&&batch!=='latest'?batch:await latestBatchName(root);
 const data=await readBatch(root,name);
 if(list){
  return {batch:name,lines:data.candidates.map((c,i)=>`${i+1}. ${c.name} | ${c.status}${c.duplicate?' | duplicate':''}${c.phone_suggestion?' | '+c.phone_suggestion:''}`)};
 }
 const pack=buildPack({batch:data,picks,offer:launch?launchOffer():null});
 const dir=await writePack(root,name,pack,{now});
 return {batch:name,dir,leads:pack.leads,files:pack.files.length};
}

function parsePicks(value){
 if(value==='eligible')return 'eligible';
 const nums=String(value||'').split(',').map(x=>Number(x.trim()));
 return nums;
}
async function cli(args){
 const opts={};
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(a==='--list'||a==='--launch-offer')opts[a.slice(2)]=true;
  else if(['--batch','--pick','--root'].includes(a)&&args[i+1]){opts[a.slice(2)]=args[++i];}
  else throw Error('Usage: --batch NAME|latest (--list | --pick 1,2|eligible) [--launch-offer]');
 }
 const root=opts.root?resolve(opts.root):DEFAULT_ROOT;
 const result=await run({batch:opts.batch||'latest',picks:opts.list?undefined:parsePicks(opts.pick),launch:Boolean(opts['launch-offer']),list:Boolean(opts.list),root});
 if(opts.list){console.log('BATCH '+result.batch);for(const l of result.lines)console.log(l);return;}
 console.log(`FORGE_PREVIEW_READY leads=${result.leads} files=${result.files} dir=${result.dir}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli(process.argv.slice(2)).catch(e=>{console.error(String(e.message||e).slice(0,300));process.exitCode=1;});
