import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {teamCommand} from './teamRuns.js';
const ownerId=env=>{const id=String(env.NEXUS_OWNER_ID || 'justin').trim().toLowerCase();if(!/^[a-z0-9_-]{3,32}$/u.test(id))throw new Error('Owner identity is not configured.');return id;};
const digest=value=>createHash('sha256').update(value).digest('hex');
const STORE_KEY=`
if redis.call('GET',KEYS[2]) then return 'replayed' end
if redis.call('GET',KEYS[1]) and ARGV[2] ~= 'rotate' then return 'exists' end
redis.call('SET',KEYS[1],ARGV[1])
redis.call('SET',KEYS[2],'issued','EX',86400)
return 'created'`;
export function createWorkspaceOwnerKeyStore({command=teamCommand,env=process.env,generate=()=>`nxw_${randomBytes(32).toString('base64url')}`,now=Date.now}={}){
 const id=ownerId(env),storageKey=`nexus:workspace:owner-key:v1:${id}`;
 async function current(){const raw=await command(['GET',storageKey]);return raw?JSON.parse(raw):null;}
 async function verify(key){if(typeof key!=='string' || !/^nxw_[a-zA-Z0-9_-]{43}$/u.test(key))return false;const record=await current();if(!record?.digest || record.revoked)return false;const expected=Buffer.from(record.digest,'hex'),actual=Buffer.from(digest(key),'hex');return expected.length===actual.length && timingSafeEqual(expected,actual);}
 return {
  async status(){const record=await current();return {configured:Boolean(record && !record.revoked),created_at:record?.created_at || null};},
  async create({request_id,rotate=false}={}){
   if(typeof request_id!=='string'||!/^[a-zA-Z0-9_-]{8,120}$/u.test(request_id))throw Object.assign(new Error('A stable setup request ID is required.'),{status:400});
   const key=generate(),record={digest:digest(key),owner:id,created_at:now()};
   const result=await command(['EVAL',STORE_KEY,2,storageKey,`${storageKey}:request:${request_id}`,JSON.stringify(record),rotate?'rotate':'new']);
   if(result==='replayed')throw Object.assign(new Error('This key was already issued once. It cannot be shown again. Use your saved copy or explicitly replace it.'),{status:409});
   if(result!=='created')throw Object.assign(new Error('A key already exists. Explicitly choose Replace key to revoke it and make a new one.'),{status:409});
   if(!await verify(key))throw Object.assign(new Error('The stored key could not be verified. No key will be displayed.'),{status:503});
   return {key,usable:true,shown_once:true,created_at:record.created_at};
  },verify,
 };
}
