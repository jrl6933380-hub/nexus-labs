import '../lib/store/installFetch.js';
import {researchStore} from '../lib/researchJobs.js';
import {PACKS,grantFromSession,walletSecret} from '../lib/actorCredits.js';
// Public endpoint to buy actor credits. No accounts: a buyer either tops up the wallet link they already have
// or gets a new wallet link after paying. Credits are only ever added after Stripe says the session is paid.
const SITE_URL=()=>process.env.SITE_URL||'https://nexus-labs-sigma.vercel.app';
async function stripe(method,path,body){
  const key=process.env.STRIPE_SECRET_KEY;
  const params=new URLSearchParams();
  for(const [k,v] of Object.entries(body||{})){if(v!==undefined&&v!==null)params.append(k,String(v));}
  const res=await fetch('https://api.stripe.com/v1/'+path,{method,headers:{Authorization:'Bearer '+key,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:params}:{})});
  const data=await res.json();
  if(!res.ok)throw new Error(data.error?.message||'Stripe request failed');
  return data;
}
const fail=(message,status=400,code='ACTOR_CREDITS_INVALID')=>Object.assign(new Error(message),{status,code});

export function createActorCreditsHandler({store=researchStore,post=(p,b)=>stripe('POST',p,b),get=p=>stripe('GET',p),configured=()=>Boolean(process.env.STRIPE_SECRET_KEY),secret=walletSecret}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
   const origin=req.headers?.origin,host=req.headers?.host;
   if(origin&&new URL(origin).host!==host)return res.status(403).json({error:'Open the page on this Nexus site.'});
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use application/json.'});
   const b=req.body;
   if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['action','key','pack','session_id','from'].includes(k)))return res.status(400).json({error:'Unknown fields.'});
   const {action,key,pack,session_id,from}=b;
   const page=from==='market'?'/marketplace.html':'/research.html';
   if(action==='packs')return res.status(200).json({ok:true,data:{packs:Object.values(PACKS).map(({id,cents,credits})=>({id,cents,credits}))}});
   if(action==='balance'){const w=await store.walletByToken(key);return res.status(200).json({ok:true,data:{credits:w.credits,search_cost:w.search_cost}});}
   if(!configured())throw fail('Buying credits is not set up yet.',503,'NOT_CONFIGURED');
   if(action==='checkout'){
    const p=PACKS[pack];if(!p)throw fail('Choose a credit pack.');
    let linkId='';
    if(key){linkId=(await store.walletByToken(key)).link_id;}
    const site=SITE_URL();
    const session=await post('checkout/sessions',{
     mode:'payment',
     'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':p.cents,
     'line_items[0][price_data][product_data][name]':p.credits+' Nexus actor credits','line_items[0][quantity]':1,
     'metadata[kind]':'actor_credits','metadata[pack]':p.id,...(linkId?{'metadata[link_id]':linkId}:{}),
     success_url:site+page+'?'+(key?'k='+encodeURIComponent(key)+'&':'')+'paid=1&session_id={CHECKOUT_SESSION_ID}',
     cancel_url:site+page+(key?'?k='+encodeURIComponent(key):''),
    });
    return res.status(200).json({ok:true,data:{url:session.url}});
   }
   if(action==='claim'){
    if(typeof session_id!=='string'||!/^cs_[A-Za-z0-9_]{10,200}$/u.test(session_id))throw fail('That payment reference is not valid.');
    const session=await get('checkout/sessions/'+session_id);
    const g=await grantFromSession(session,{store,secret:secret()});
    if(!g.handled)throw fail(g.reason==='not paid'?'That payment is not complete yet. Give it a moment and refresh.':'That payment could not be matched.',g.reason==='not paid'?402:400);
    return res.status(200).json({ok:true,data:{credits:g.credits,...(g.token?{path:'/research.html?k='+g.token}:{})}});
   }
   return res.status(400).json({error:'Unknown action.'});
  }catch(e){
   const status=e.status||(e.name==='ZodError'?400:500);
   if(status>=500)console.error('actor-credits error:',e.message);
   return res.status(status).json({error:status>=500?'Temporarily unavailable. Try again shortly.':e.message,code:e.code});
  }
 };
}
export default createActorCreditsHandler();
