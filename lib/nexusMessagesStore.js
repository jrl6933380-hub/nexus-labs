const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const SPECIALIST_ROLES = Object.freeze({
  research: { label:'Research', description:'Find and organize useful information', defaultScopes:['conversation'] },
  build: { label:'Build', description:'Create and improve projects', defaultScopes:['conversation','projects'] },
  life: { label:'Life support', description:'Help with plans, habits, and balance', defaultScopes:['conversation','schedule','reminders','life'] },
  custom: { label:'Custom role', description:'Give this specialist one clear job', defaultScopes:['conversation'] },
});
export const MESSAGE_SCOPES = Object.freeze(['conversation','projects','schedule','reminders','life']);
export const MESSAGE_SYSTEM_IDS = Object.freeze(['planner','reminders','life','workbench','legacy','teams','deck','approvals','forge','story','agents','memory','ventures','pod','skills']);
const DEFAULT_PINNED_SYSTEM_IDS = Object.freeze(['planner','reminders','workbench','life']);
const MAX_SPECIALISTS = 20;
const MAX_GROUPS = 20;

function ownerKey(owner) {
  const normalized=String(owner || '').trim().toLowerCase();
  if(!/^[a-z0-9_-]{3,64}$/u.test(normalized))throw new Error('A valid Nexus owner is required');
  return `nexus:messages:${normalized}:v1`;
}
function cleanId(value,prefix){const id=String(value || '').trim();if(!new RegExp(`^${prefix}-[a-zA-Z0-9_-]{3,64}$`,'u').test(id))throw new Error(`A valid ${prefix} id is required`);return id;}
function cleanText(value,limit){return String(value || '').replace(/\s+/gu,' ').trim().slice(0,limit);}
function cleanScopes(value){const requested=Array.isArray(value)?value:[];return [...new Set(requested.filter(scope=>MESSAGE_SCOPES.includes(scope)))];}
function cleanPinnedSystems(value){const requested=Array.isArray(value)?value:DEFAULT_PINNED_SYSTEM_IDS;return [...new Set(requested.filter(id=>MESSAGE_SYSTEM_IDS.includes(id)))];}
function cleanSpecialist(value){
  const role=SPECIALIST_ROLES[value?.role] ? value.role : 'custom';
  return {id:cleanId(value?.id,'agent'),name:cleanText(value?.name,40) || SPECIALIST_ROLES[role].label,role,job:cleanText(value?.job,240) || SPECIALIST_ROLES[role].description,scopes:cleanScopes(value?.scopes).length?cleanScopes(value.scopes):SPECIALIST_ROLES[role].defaultScopes,created_at:Number(value?.created_at)||Date.now()};
}
function cleanGroup(value,specialists){
  const available=new Set(specialists.map(item=>item.id));
  return {id:cleanId(value?.id,'group'),include_nex:value?.include_nex !== false,title:cleanText(value?.title,60) || 'New group',member_ids:[...new Set((Array.isArray(value?.member_ids)?value.member_ids:[]).filter(id=>available.has(id)))].slice(0,8),scopes:cleanScopes(value?.scopes),created_at:Number(value?.created_at)||Date.now()};
}
function normalize(raw){
  let parsed={};try{parsed=raw?JSON.parse(raw):{};}catch{}
  const specialists=(Array.isArray(parsed.specialists)?parsed.specialists:[]).map(value=>{try{return cleanSpecialist(value);}catch{return null;}}).filter(Boolean).slice(0,MAX_SPECIALISTS);
  const groups=(Array.isArray(parsed.groups)?parsed.groups:[]).map(value=>{try{return cleanGroup(value,specialists);}catch{return null;}}).filter(Boolean).slice(0,MAX_GROUPS);
  return {specialists,groups,pinned_system_ids:cleanPinnedSystems(parsed.pinned_system_ids)};
}
async function command(parts){
  if(!KV_URL || !KV_TOKEN)return null;
  const response=await fetch(KV_URL,{method:'POST',headers:{Authorization:`Bearer ${KV_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(parts)});
  const data=await response.json();if(!response.ok || data.error)throw new Error('Nexus Messages storage is unavailable');return data.result;
}
export function createNexusMessagesStore({run=command,idFactory=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`}={}){
  async function read(owner){return normalize(await run(['GET',ownerKey(owner)]));}
  async function write(owner,state){await run(['SET',ownerKey(owner),JSON.stringify(state)]);return state;}
  return {
    async overview(owner){return read(owner);},
    async createSpecialist(owner,input){const state=await read(owner);if(state.specialists.length>=MAX_SPECIALISTS)throw new Error('You have reached the specialist limit');const specialist=cleanSpecialist({...input,id:idFactory('agent'),created_at:Date.now()});state.specialists.unshift(specialist);await write(owner,state);return specialist;},
    async createGroup(owner,input){const state=await read(owner);if(state.groups.length>=MAX_GROUPS)throw new Error('You have reached the group limit');const group=cleanGroup({...input,include_nex:input?.include_nex === true,id:idFactory('group'),created_at:Date.now()},state.specialists);if(!group.member_ids.length)throw new Error('Choose at least one specialist');group.scopes=[...new Set(group.member_ids.flatMap(id=>state.specialists.find(item=>item.id===id)?.scopes || []))];state.groups.unshift(group);await write(owner,state);return group;},
    async setGroupNex(owner,id,include){if(typeof include!=='boolean')throw new Error('Choose whether Nex participates');const state=await read(owner),group=state.groups.find(item=>item.id===cleanId(id,'group'));if(!group)throw new Error('Choose an available group');group.include_nex=include;await write(owner,state);return group;},
    async setPinnedSystems(owner,ids){const state=await read(owner);state.pinned_system_ids=cleanPinnedSystems(ids);await write(owner,state);return state.pinned_system_ids;},
    async remove(owner,type,id){const state=await read(owner);if(type==='specialist'){const clean=cleanId(id,'agent');state.specialists=state.specialists.filter(item=>item.id!==clean);state.groups=state.groups.map(group=>({...group,member_ids:group.member_ids.filter(member=>member!==clean)})).filter(group=>group.member_ids.length);}else if(type==='group')state.groups=state.groups.filter(item=>item.id!==cleanId(id,'group'));else throw new Error('Choose a specialist or group');await write(owner,state);return true;},
  };
}

export const nexusMessagesStore=createNexusMessagesStore();
