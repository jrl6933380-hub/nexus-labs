import {getRequestUser,getUserPlan,isPaidPlan} from '../lib/roomAuth.js';
import {getOrCreateAnonId} from '../lib/anonSession.js';
import {publicForgePricing} from '../lib/forgePricing.js';
import {roomMeter} from '../lib/roomMetering.js';
export function createUsageHandler({resolveUser=getRequestUser,meter=roomMeter,resolvePlan=getUserPlan}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method Not Allowed'});
  try{
   let user=await resolveUser(req);
   if(req.method==='POST'){
    if(!user)return res.status(401).json({error:'Sign in first.'});
    if(req.body?.action!=='extra_usage'||typeof req.body.enabled!=='boolean')return res.status(400).json({error:'Choose whether to use extra usage.'});
    return res.status(200).json({usageLimits:await meter.setExtraEnabled(user,req.body.enabled)});
   }
   if(!user)user=getOrCreateAnonId(req,res);
   const full=meter.summary?await meter.summary(user):null;
   const slim=value=>({unlimited:Boolean(value.unlimited),percentRemaining:value.percentRemaining??100,resetAt:value.resetAt??null});
   const daily=full?{...full.short,unlimited:full.exempt}:slim(await meter.getDailyUsageSummary(user));
   const usage=full?{...full.weekly,unlimited:full.exempt}:slim(await meter.getUsageSummary(user));
   let canExport=false;try{canExport=isPaidPlan(await resolvePlan(user));}catch{}
   return res.status(200).json({usage,daily,usageLimits:full,pricing:publicForgePricing(),canExport});
  }catch(error){console.error('Usage:',error.message);return res.status(503).json({error:'Could not load usage. Try again.'});}
 };
}
export default createUsageHandler();
