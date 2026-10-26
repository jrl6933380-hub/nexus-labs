// Owner-only login vault for social accounts (TikTok, Instagram, Facebook).
// Passwords are encrypted at rest with AES-256-GCM and are returned only by reveal(), never by status().
// Kept in its own Redis hash so the planner overview that agents read can never carry a password.
import crypto from 'node:crypto';
import {z} from 'zod';

export const LOGIN_PLATFORMS=['tiktok','instagram','facebook'];
export const loginSchema=z.object({
  platform:z.enum(LOGIN_PLATFORMS),
  username:z.string().max(200).default(''),
  // Omit (or send '') to keep the saved password; send a value to replace it.
  password:z.string().max(500).optional(),
}).strict();

const fail=(message,status=400,code='LOGIN_INPUT_INVALID')=>Object.assign(new Error(message),{status,code});
const key=user=>{if(typeof user!=='string'||!user)throw fail('Authenticated account required.',401,'UNAUTHORIZED');return 'nexus:account-logins:v1:'+encodeURIComponent(user);};

function encKey(){
  const secret=process.env.NEXUS_CREDENTIAL_ENC_KEY||process.env.NEXUS_GRANT_SIGNING_SECRET;
  if(!secret)throw fail('The login vault is not configured on the server.',503,'VAULT_NOT_CONFIGURED');
  return crypto.createHash('sha256').update(secret+':account-login-vault:v1').digest();
}
export function encryptSecret(plain,k=encKey()){
  const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',k,iv);
  const enc=Buffer.concat([c.update(plain,'utf8'),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),enc]).toString('base64');
}
export function decryptSecret(payload,k=encKey()){
  const buf=Buffer.from(payload,'base64'),d=crypto.createDecipheriv('aes-256-gcm',k,buf.subarray(0,12));
  d.setAuthTag(buf.subarray(12,28));
  return Buffer.concat([d.update(buf.subarray(28)),d.final()]).toString('utf8');
}

export function createAccountLoginStore({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts),now=Date.now}={}){
  const get=async(user,platform)=>{const raw=await command(['HGET',key(user),platform]);return raw?JSON.parse(raw):null;};
  const pub=r=>({platform:r.platform,username:r.username,has_password:Boolean(r.password_enc),updated_at:r.updated_at});
  return {
    // Never includes a password.
    async status(user){
      const rows=(await command(['HVALS',key(user)])||[]).map(r=>JSON.parse(r));
      return {logins:rows.map(pub).sort((a,b)=>a.platform<b.platform?-1:1)};
    },
    async save(user,input){
      const d=loginSchema.parse(input),old=await get(user,d.platform);
      const password_enc=d.password?encryptSecret(d.password):(old?.password_enc||'');
      const rec={platform:d.platform,username:d.username,password_enc,updated_at:now()};
      await command(['HSET',key(user),d.platform,JSON.stringify(rec)]);
      return pub(rec);
    },
    async reveal(user,{platform}){
      z.enum(LOGIN_PLATFORMS).parse(platform);
      const r=await get(user,platform);if(!r)throw fail('No login saved for this account.',404,'NOT_FOUND');
      return {platform,username:r.username,password:r.password_enc?decryptSecret(r.password_enc):''};
    },
    async remove(user,{platform}){
      z.enum(LOGIN_PLATFORMS).parse(platform);
      const n=await command(['HDEL',key(user),platform]);
      if(!n)throw fail('No login saved for this account.',404,'NOT_FOUND');
      return {deleted:true,platform};
    },
  };
}
export const accountLoginStore=createAccountLoginStore();
