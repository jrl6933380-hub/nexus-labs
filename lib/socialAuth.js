import crypto from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

const STATE_PREFIX='nexus:social-auth:state:v1:';
const STATE_TTL_SECONDS=10*60;
const GOOGLE_ISSUERS=['https://accounts.google.com','accounts.google.com'];
const APPLE_ISSUER='https://appleid.apple.com';
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleKeys=createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

async function redis(command){
  const url=process.env.KV_REST_API_URL,token=process.env.KV_REST_API_TOKEN;
  if(!url||!token)throw new Error('Sign-in storage is unavailable');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command)});
  const data=await response.json();if(!response.ok||data.error)throw new Error('Sign-in storage request failed');return data.result;
}
function safeNext(value){const next=String(value || '/workspace.html');return next.startsWith('/')&&!next.startsWith('//')&&!/[\\\r\n]/u.test(next)?next:'/workspace.html';}
function publicUrl(){return String(process.env.NEXUS_PUBLIC_URL || 'https://nexus-labs-sigma.vercel.app').replace(/\/$/u,'');}
function callbackUrl(provider){return `${publicUrl()}/api/social-auth/callback/${provider}`;}
function configured(provider,env=process.env){
  if(provider==='google')return Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
  if(provider==='apple')return Boolean(env.APPLE_CLIENT_ID&&env.APPLE_TEAM_ID&&env.APPLE_KEY_ID&&env.APPLE_PRIVATE_KEY);
  return false;
}
async function postForm(url,values){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});
  const data=await response.json().catch(()=>({}));if(!response.ok||data.error)throw new Error('The sign-in provider could not finish signing in.');return data;
}
async function appleClientSecret(env=process.env){
  const key=await importPKCS8(String(env.APPLE_PRIVATE_KEY).replace(/\\n/gu,'\n'),'ES256');
  return new SignJWT({}).setProtectedHeader({alg:'ES256',kid:env.APPLE_KEY_ID}).setIssuer(env.APPLE_TEAM_ID).setAudience(APPLE_ISSUER).setSubject(env.APPLE_CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(key);
}

export function providerStatus(env=process.env){return {google:configured('google',env),apple:configured('apple',env)};}

export function createSocialAuth({command=redis,env=process.env,random=()=>crypto.randomBytes(32).toString('base64url')}={}){
  async function begin(provider,next,browserBinding){
    if(!configured(provider,env))throw new Error(`${provider==='apple'?'Apple':'Google'} sign-in is not connected yet.`);
    if(!browserBinding)throw new Error('Start sign-in from this browser again.');
    const state=random();await command(['SET',STATE_PREFIX+state,JSON.stringify({provider,browserBinding,next:safeNext(next),createdAt:Date.now()}),'EX',String(STATE_TTL_SECONDS)]);
    if(provider==='google'){
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callbackUrl('google'),response_type:'code',scope:'openid email profile',state,prompt:'select_account'});return url.href;
    }
    const url=new URL('https://appleid.apple.com/auth/authorize');
    url.search=new URLSearchParams({client_id:env.APPLE_CLIENT_ID,redirect_uri:callbackUrl('apple'),response_type:'code',response_mode:'form_post',scope:'name email',state});return url.href;
  }
  async function consumeState(provider,state,browserBinding){
    const raw=await command(['GETDEL',STATE_PREFIX+String(state || '')]);if(!raw)throw new Error('That sign-in attempt expired. Please try again.');
    let record;try{record=JSON.parse(raw);}catch{throw new Error('That sign-in attempt expired. Please try again.');}
    if(!browserBinding || record.browserBinding!==browserBinding)throw new Error('Start sign-in from this browser again.');
    if(record.provider!==provider)throw new Error('That sign-in response did not match the request.');return record;
  }
  async function finishGoogle(code){
    const token=await postForm('https://oauth2.googleapis.com/token',{code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:callbackUrl('google'),grant_type:'authorization_code'});
    const {payload}=await jwtVerify(token.id_token,googleKeys,{issuer:GOOGLE_ISSUERS,audience:env.GOOGLE_CLIENT_ID});
    if(!payload.sub||!payload.email||payload.email_verified!==true)throw new Error('Google did not provide a verified email address.');
    return {provider:'google',subject:payload.sub,email:payload.email,name:payload.name || payload.given_name || ''};
  }
  async function finishApple(code,user){
    const token=await postForm('https://appleid.apple.com/auth/token',{code,client_id:env.APPLE_CLIENT_ID,client_secret:await appleClientSecret(env),redirect_uri:callbackUrl('apple'),grant_type:'authorization_code'});
    const {payload}=await jwtVerify(token.id_token,appleKeys,{issuer:APPLE_ISSUER,audience:env.APPLE_CLIENT_ID});
    let supplied={};try{supplied=typeof user==='string'?JSON.parse(user):user || {};}catch{}
    const name=[supplied?.name?.firstName,supplied?.name?.lastName].filter(Boolean).join(' ');
    if(!payload.sub||!payload.email||![true,'true'].includes(payload.email_verified))throw new Error('Apple did not provide a verified email address.');
    return {provider:'apple',subject:payload.sub,email:payload.email,name};
  }
  async function finish(provider,{code,state,user,browserBinding}={}){
    if(!configured(provider,env))throw new Error('That sign-in option is not connected yet.');
    const request=await consumeState(provider,state,browserBinding);if(!code)throw new Error('The sign-in provider did not return permission.');
    return {request,identity:provider==='google'?await finishGoogle(code):await finishApple(code,user)};
  }
  return {begin,finish,status:()=>providerStatus(env)};
}

export const socialAuth=createSocialAuth();
