// Voice attachments stay separate from creative copy and are scoped to the owning account.
export function createAdVoiceovers({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts)}={}){
 const key=user=>{if(!user)throw Object.assign(new Error('Sign in to Nexus.'),{status:401});return 'nexus:ad-voiceovers:v1:'+encodeURIComponent(user);};
 return {
  async get(user,campaign){const raw=await command(['HGET',key(user),campaign]);return raw?JSON.parse(raw):null;},
  async set(user,campaign,media_id){const record={media_id,updated_at:Date.now()};await command(['HSET',key(user),campaign,JSON.stringify(record)]);return record;}
 };
}
export const adVoiceovers=createAdVoiceovers();
