import './store/installFetch.js';
import crypto from 'node:crypto';
import {aiWorkAmount,usageEstimate,outputCapacity} from './aiWorkUsage.js';
import {getUserPlan,isOperatorUser,PLANS} from './roomAuth.js';
import {FORGE_CREDIT_PRICING} from './forgePricing.js';

export const USAGE_WINDOWS={short:5*3600000,weekly:7*86400000};
// Initial safety allowances, adjustable after pod-cost measurements. Never public units.
export const TIER_USAGE={free:{short:30,weekly:60},hosted:{short:90,weekly:300},growth:{short:180,weekly:600},unlimited:{short:180,weekly:600}};
export const USAGE_SCRIPT=`
local state=cjson.decode(redis.call('GET',KEYS[1]) or '{}')
local action=ARGV[1]
local now=tonumber(ARGV[2])
local shortMs=tonumber(ARGV[3])
local weekMs=tonumber(ARGV[4])
if not state.short or now >= state.short.resetAt then state.short={spent=0,resetAt=now+shortMs} end
if not state.weekly or now >= state.weekly.resetAt then state.weekly={spent=0,resetAt=now+weekMs} end
state.extra=state.extra or {granted=0,remaining=0,enabled=false}
state.holds=state.holds or {}
for id,hold in pairs(state.holds) do if hold.settled and now-hold.at>604800000 then state.holds[id]=nil end end
local result={}
if action=='grant' then
 if redis.call('GET',KEYS[2]) then return cjson.encode({duplicate=true}) end
 local amount=tonumber(ARGV[5])
 if state.extra.remaining==0 then state.extra.granted=0 end
 state.extra.granted=state.extra.granted+amount
 state.extra.remaining=state.extra.remaining+amount
 redis.call('SET',KEYS[2],'fulfilled')
elseif action=='toggle' then
 state.extra.enabled=ARGV[5]=='true'
elseif action=='reserve' then
 local amount=tonumber(ARGV[5])
 local shortLimit=tonumber(ARGV[6])
 local weekLimit=tonumber(ARGV[7])
 local id=ARGV[8]
 if state.holds[id] then return cjson.encode({ok=false,reason='request_already_metered'}) end
 local included=math.min(amount,math.max(0,math.min(shortLimit-state.short.spent,weekLimit-state.weekly.spent)))
 local extra=amount-included
 local source=extra==0 and 'included' or (included==0 and 'extra' or 'mixed')
 if extra>0 and (not state.extra.enabled or state.extra.remaining<extra) then result={ok=false,reason='usage_exhausted'} end
 if result.ok~=false and included>0 and ARGV[9]=='free' then
  local global=tonumber(redis.call('GET',KEYS[3]) or '0')
  if global+included>5000 then result={ok=false,reason='global_ceiling_exceeded'}
  else redis.call('SET',KEYS[3],tostring(global+included),'EX',86400) end
 end
 if result.ok~=false then
  state.extra.remaining=state.extra.remaining-extra
  state.short.spent=state.short.spent+included;state.weekly.spent=state.weekly.spent+included
  state.holds[id]={amount=amount,included=included,extra=extra,source=source,shortReset=state.short.resetAt,weekReset=state.weekly.resetAt,at=now}
  result={ok=true,reservationId=id,reserved=amount,source=source,period=0}
 end
elseif action=='settle' then
 local hold=state.holds[ARGV[6]]
 if hold and not hold.settled then
  local charge=math.max(0,math.min(hold.amount,tonumber(ARGV[5])))
  local included=hold.included or (hold.source=='extra' and 0 or hold.amount)
  local extra=hold.extra or (hold.source=='extra' and hold.amount or 0)
  local includedRefund=math.max(0,included-charge)
  local extraRefund=extra-math.max(0,charge-included)
  state.extra.remaining=state.extra.remaining+extraRefund
  if hold.shortReset==state.short.resetAt then state.short.spent=math.max(0,state.short.spent-includedRefund) end
  if hold.weekReset==state.weekly.resetAt then state.weekly.spent=math.max(0,state.weekly.spent-includedRefund) end
  hold.settled=true
  hold.charged=charge
  hold.usage=ARGV[7] and cjson.decode(ARGV[7]) or nil
  result={charged=charge}
 end
end
-- Capacity is recorded to 0.001 units; prevent floating-point refund drift.
state.short.spent=math.floor(state.short.spent*1000+0.5)/1000
state.weekly.spent=math.floor(state.weekly.spent*1000+0.5)/1000
state.extra.remaining=math.floor(state.extra.remaining*1000+0.5)/1000
redis.call('SET',KEYS[1],cjson.encode(state))
if action=='read' or action=='toggle' then return cjson.encode(state) end
return cjson.encode(result)`;

async function redis(parts){
 const url=process.env.KV_REST_API_URL,token=process.env.KV_REST_API_TOKEN;
 if(!url||!token)throw new Error('Usage storage is unavailable');
 const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(parts)});
 const data=await response.json();if(!response.ok||data.error)throw new Error('Usage storage is unavailable');return data.result;
}
const percent=(remaining,total)=>total>0?Math.max(0,Math.min(100,Math.floor(100*remaining/total))):0;
export function createNexusUsage({command=redis,now=Date.now,resolvePlan=getUserPlan,isExempt=isOperatorUser,limits=TIER_USAGE}={}){
 const key=user=>{if(!user)throw new Error('Usage account required');return `nexus:usage:v2:${encodeURIComponent(user)}`;};
 async function run(user,action,args=[],receipt='unused'){
  const result=await command(['EVAL',USAGE_SCRIPT,3,key(user),`nexus:usage:purchase:${receipt}`,`nexus:usage:global:${Math.floor(now()/86400000)}`,action,now(),USAGE_WINDOWS.short,USAGE_WINDOWS.weekly,...args]);
  return typeof result==='string'?JSON.parse(result):result;
 }
 async function policy(user){const plan=await resolvePlan(user);return {plan,limits:limits[plan]||limits.free};}
 async function summary(user,{exempt=false}={}){
  if(exempt||isExempt(user))return {exempt:true,plan:'Owner',short:{percentRemaining:100,resetAt:null},weekly:{percentRemaining:100,resetAt:null},extra:{percentRemaining:0,available:false,enabled:false},pack:{priceUsd:6},updatedAt:now()};
  const [{plan,limits:cap},state]=await Promise.all([policy(user),run(user,'read')]);
  return {exempt:false,plan:plan===PLANS.FREE?'Free':plan===PLANS.HOSTED?'Pro':'Plus',short:{percentRemaining:percent(cap.short-state.short.spent,cap.short),resetAt:state.short.resetAt},weekly:{percentRemaining:percent(cap.weekly-state.weekly.spent,cap.weekly),resetAt:state.weekly.resetAt},extra:{percentRemaining:percent(state.extra.remaining,state.extra.granted),available:state.extra.remaining>0,enabled:state.extra.enabled},pack:{priceUsd:6},updatedAt:now()};
 }
 async function reserveBuild({userId,kind='assistant',requestId,work}={}){
  if(!['assistant','fresh','edit'].includes(kind))throw new Error('Unknown usage kind');
  if(isExempt(userId))return {ok:true,unlimited:true,reservationId:'exempt',period:0,reserved:0};
  const {plan,limits:cap}=await policy(userId);
  let maxOutputTokens;
  if(work){const state=await run(userId,'read');const included=Math.max(0,Math.min(cap.short-state.short.spent,cap.weekly-state.weekly.spent));const available=included+(state.extra.enabled?state.extra.remaining:0);const input=usageEstimate(work.messages,0).input;maxOutputTokens=Math.max(0,Math.min(work.maxOutputTokens,outputCapacity(available,input)));if(maxOutputTokens<Math.min(256,work.maxOutputTokens))return {ok:false,reason:'usage_exhausted'};}
  const amount=work?aiWorkAmount(usageEstimate(work.messages,maxOutputTokens)):kind==='fresh'?FORGE_CREDIT_PRICING.freshBuild:kind==='edit'?FORGE_CREDIT_PRICING.edit:FORGE_CREDIT_PRICING.assistant;
  const reservation=await run(userId,'reserve',[amount,cap.short,cap.weekly,requestId||crypto.randomUUID(),plan]);return {...reservation,...(work?{maxOutputTokens}: {})};
 }
 async function settleBuild({userId,reservationId,success,chargedCredits,usage}={}){
  if(isExempt(userId))return {charged:0,unlimited:true};
  return run(userId,'settle',[success?(Number.isFinite(chargedCredits)?Math.max(0,chargedCredits):1e9):0,reservationId,JSON.stringify(usage||{})]);
 }
 async function grantBonusCredits(user,amount,{purchaseId}={}){
  if(!purchaseId||!Number.isInteger(amount)||amount<=0)throw new Error('A valid paid purchase is required');
  return run(user,'grant',[amount],purchaseId);
 }
 async function setExtraEnabled(user,enabled){if(typeof enabled!=='boolean')throw new Error('Choose whether to use extra usage');await run(user,'toggle',[String(enabled)]);return summary(user);}
 // Compatibility for existing builder APIs; the underlying ledger is shared.
 async function internalSummary(user,window){
  const data=await summary(user);if(data.exempt)return {...data[window],unlimited:true,limit:null,remaining:null,consumed:0,reserved:0};
  const [{limits:cap},state]=await Promise.all([policy(user),run(user,'read')]);
  return {...data[window],unlimited:false,limit:cap[window],remaining:Math.max(0,cap[window]-state[window].spent),consumed:state[window].spent,reserved:0};
 }
 async function getUsageSummary(user){return internalSummary(user,'weekly');}
 async function getDailyUsageSummary(user){return internalSummary(user,'short');}
 return {summary,reserveBuild,settleBuild,grantBonusCredits,setExtraEnabled,getUsageSummary,getDailyUsageSummary};
}
export const nexusUsage=createNexusUsage();
