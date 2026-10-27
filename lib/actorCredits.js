// Actor credit packs. 1 credit is about 10 cents at the base rate; bigger packs give a few bonus credits.
// Credits never expire and are non-refundable, except a failed search restores its credits automatically.
import {createHmac} from 'node:crypto';

export const PACKS={
  p5:{id:'p5',cents:500,credits:50},
  p10:{id:'p10',cents:1000,credits:110},
  p25:{id:'p25',cents:2500,credits:300},
};

export const walletSecret=()=>process.env.ACTOR_WALLET_SECRET||process.env.STRIPE_SECRET_KEY||'';

// A buyer with no wallet gets one at a token only the buyer (and our server) can compute from the Stripe session id.
export const walletToken=(sessionId,secret)=>createHmac('sha256',secret).update('actor-wallet:'+sessionId).digest('base64url').slice(0,32);

// Add the purchased credits for one paid Checkout Session. Idempotent by session id.
export async function grantFromSession(session,{store,secret=walletSecret()}={}){
  const m=session?.metadata||{};
  if(m.kind!=='actor_credits')return {handled:false,reason:'not actor credits'};
  if(session.payment_status!=='paid')return {handled:false,reason:'not paid'};
  const pack=PACKS[m.pack];
  if(!pack)return {handled:false,reason:'unknown pack'};
  if(m.link_id){
    const r=await store.addCredits({link_id:m.link_id,credits:pack.credits,ref:session.id,why:'purchase'});
    return {handled:true,link_id:m.link_id,credits:r.credits};
  }
  if(!secret)return {handled:false,reason:'no wallet secret'};
  const token=walletToken(session.id,secret);
  const r=await store.grantPurchase({token,label:'Purchased credits',credits:pack.credits,ref:session.id});
  return {handled:true,link_id:r.link_id,credits:r.credits,token};
}
