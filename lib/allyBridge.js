// Owner-only Ally pairing and outbound-only session transport (phase 1).
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {getStore} from './store/index.js';
const KEY='nexus:ally:v1', TTL=300;
const digest=x=>createHash('sha256').update(x).digest('hex');
const fail=(m,status=400)=>Object.assign(new Error(m),{status});
const cas=`local old=redis.call('HGET',KEYS[1],ARGV[1]) or ''
if old~=ARGV[2] then return 0 end
redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]) return 1`;
const exchange=`local pair=redis.call('GET',KEYS[1])
if not pair then return 0 end
local p=cjson.decode(pair)
local old=redis.call('HGET',KEYS[2],p.owner)
if not old or cjson.decode(old).nonce~=p.nonce then return 0 end
redis.call('DEL',KEYS[1])
redis.call('HSET',KEYS[2],p.owner,ARGV[1])
redis.call('SET',KEYS[3],p.owner,'EX',7776000)
return 1`;
export function createAllyBridge({command=async args=>{const s=getStore();if(!s)throw fail('Storage unavailable.',503);return s.command(args);},now=Date.now}={}){
 const load=async owner=>{const raw=await command(['HGET',KEY,owner]);return {raw:raw||'',s:raw?JSON.parse(raw):null};};
 async function update(owner,fn){for(let i=0;i<10;i++){const {raw,s}=await load(owner);const next=fn(s);if(await command(['EVAL',cas,1,KEY,owner,raw,JSON.stringify(next.s)]))return next.out;}throw fail('Concurrent change. Retry.',409);}
 async function auth(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw fail('Pair Ally first.',401);const h=digest(token),owner=await command(['GET','nexus:ally:token:'+h]);const {s}=owner?await load(owner):{};if(!s||s.hash!==h)throw fail('Pairing revoked.',401);return {owner,h};}
 return {
  async pairCode(owner){const code=randomBytes(9).toString('hex').toUpperCase(),nonce=randomUUID();await update(owner,s=>({s:{...(s||{}),nonce},out:null}));await command(['SET','nexus:ally:pair:'+digest(code),JSON.stringify({owner,nonce}),'EX',TTL]);return {code,expires_at:now()+TTL*1000};},
  async pair(code,label){code=String(code||'').replace(/[\s-]/g,'').toUpperCase();if(!/^[A-F0-9]{18}$/.test(code))throw fail('Invalid pairing code.');if(typeof label!=='string'||label.length<1||label.length>60)throw fail('Choose a device label.');const key='nexus:ally:pair:'+digest(code),raw=await command(['GET',key]);if(!raw)throw fail('Pairing code expired.',401);const {owner}=JSON.parse(raw),token=randomBytes(32).toString('hex'),s={id:randomUUID(),label,hash:digest(token),active:false,seen:0,nonce:null};if(!await command(['EVAL',exchange,3,key,KEY,'nexus:ally:token:'+digest(token),JSON.stringify(s)]))throw fail('Pairing code expired.',401);return {token,device_id:s.id};},
  async status(owner){const {s}=await load(owner);return s?{paired:!!s.hash,device_id:s.id,label:s.label,active:!!s.active&&now()-s.seen<30000,last_seen:s.seen||null}:{paired:false,active:false};},
  async stop(owner,revoke=false){return update(owner,s=>({s:{...(s||{}),active:false,session:null,...(revoke?{hash:null}:{})},out:{stopped:true,revoked:revoke}}));},
  async start(token,session){if(!/^[0-9a-f-]{36}$/.test(session||''))throw fail('Invalid session.');const a=await auth(token);return update(a.owner,s=>{if(s.hash!==a.h)throw fail('Revoked.',401);return {s:{...s,active:true,session,seen:now()},out:{active:true}};});},
  async poll(token,session){const a=await auth(token);return update(a.owner,s=>{if(s.hash!==a.h||!s.active||s.session!==session)throw fail('Session stopped.',409);return {s:{...s,seen:now()},out:{active:true,command:null}};});},
  async disconnect(token,session){const a=await auth(token);return update(a.owner,s=>{if(s.hash!==a.h)throw fail('Revoked.',401);return {s:s.session===session?{...s,active:false,session:null}:s,out:{stopped:true}};});}
 };
}
export const allyBridge=createAllyBridge();
