// /lib/systemSnapshot.js
const KEY='nexus:system:snapshot';
const TTL=15*60*1000;
const URL=process.env.KV_REST_API_URL;
const TOKEN=process.env.KV_REST_API_TOKEN;
async function redis(command){if(!URL||!TOKEN)throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');const r=await fetch(URL,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(command)});const d=await r.json();if(!r.ok)throw new Error(`Snapshot Redis command ${command[0]} failed`);return d.result;}
export function createSystemSnapshot(input={}){const now=input.generated_at||Date.now();return{schema_version:1,snapshot_id:input.snapshot_id||`snapshot-${now}`,generated_at:now,source:input.source||{},project:input.project||{},repositories:input.repositories||[],capabilities:(input.capabilities||[]).map(({name,access='read',approval='not_required'})=>({name,access,approval})),architecture:input.architecture||{},verification:input.verification||{},freshness:{ttl_ms:input.ttl_ms||TTL}};}
export function snapshotStaleness(snapshot,{now=Date.now(),current_commit_sha=null,requested_paths=[]}={}){if(!snapshot)return{stale:true,reasons:['missing']};const reasons=[];if(now-(snapshot.generated_at||0)>(snapshot.freshness?.ttl_ms||TTL))reasons.push('expired');if(current_commit_sha&&snapshot.source?.commit_sha&&current_commit_sha!==snapshot.source.commit_sha)reasons.push('source_changed');const known=new Set(snapshot.project?.files_touched||[]);if(requested_paths.some(p=>known.size&&!known.has(p)))reasons.push('scope_mismatch');return{stale:reasons.length>0,reasons};}
export function selectSnapshotContext(snapshot,sections=[]){if(!snapshot)return{};if(!sections.length)return snapshot;return Object.fromEntries(sections.filter(s=>Object.hasOwn(snapshot,s)).map(s=>[s,snapshot[s]]));}
export async function loadSystemSnapshot(){const raw=await redis(['GET',KEY]);if(!raw)return null;try{return JSON.parse(raw);}catch{return null;}}
export async function loadFreshSnapshot(options={}){const snapshot=await loadSystemSnapshot();const freshness=snapshotStaleness(snapshot,options);return{snapshot:freshness.stale?null:snapshot,stale:freshness.stale,reasons:freshness.reasons};}
export async function saveSystemSnapshot(input){const snapshot=createSystemSnapshot(input);await redis(['SET',KEY,JSON.stringify(snapshot)]);return snapshot;}
