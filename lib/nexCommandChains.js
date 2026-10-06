const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const MAX_COMMANDS = 40;
const ALLOWED_SCOPES = new Set(['conversation','specialists','groups','projects','life']);

function key(owner){
  const value=String(owner || '').trim().toLowerCase();
  if(!/^[a-z0-9:_-]{3,96}$/u.test(value))throw new Error('A valid Nexus owner is required');
  return `nexus:command-chains:${value}:v1`;
}
function text(value,limit){return String(value || '').replace(/\s+/gu,' ').trim().slice(0,limit);}
function id(value){const clean=String(value || '').trim();if(!/^command-[a-zA-Z0-9_-]{3,80}$/u.test(clean))throw new Error('A valid command id is required');return clean;}
function normalizeCommand(value,validTools=null){
  const tools=(Array.isArray(value?.tool_names)?value.tool_names:[]).map(item=>text(item,80)).filter(Boolean).slice(0,16);
  if(validTools)for(const tool of tools)if(!validTools.has(tool))throw new Error(`Choose a registered Nexus tool: ${tool}`);
  const scopes=[...new Set((Array.isArray(value?.scopes)?value.scopes:[]).filter(scope=>ALLOWED_SCOPES.has(scope)))];
  return {id:id(value?.id),name:text(value?.name,80),description:text(value?.description,400),trigger:text(value?.trigger,300),instructions:text(value?.instructions,2400),tool_names:tools,scopes:scopes.length?scopes:['conversation'],created_at:Number(value?.created_at)||Date.now()};
}
function normalize(raw){let values=[];try{values=raw?JSON.parse(raw):[];}catch{}return (Array.isArray(values)?values:[]).map(value=>{try{return normalizeCommand(value);}catch{return null;}}).filter(Boolean).slice(0,MAX_COMMANDS);}
async function redis(parts){
  if(!KV_URL || !KV_TOKEN)return null;
  const response=await fetch(KV_URL,{method:'POST',headers:{Authorization:`Bearer ${KV_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(parts)}),data=await response.json();
  if(!response.ok || data.error)throw new Error('Nexus command storage is unavailable');return data.result;
}

export function createNexCommandChainStore({run=redis,idFactory=()=>`command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`}={}){
  async function list(owner){return normalize(await run(['GET',key(owner)]));}
  async function write(owner,values){await run(['SET',key(owner),JSON.stringify(values)]);return values;}
  return {
    list,
    async get(owner,commandId){return (await list(owner)).find(item=>item.id===id(commandId)) || null;},
    async create(owner,input,validTools){const values=await list(owner);if(values.length>=MAX_COMMANDS)throw new Error('You have reached the saved command limit');const command=normalizeCommand({...input,id:idFactory(),created_at:Date.now()},validTools);if(!command.name)throw new Error('Give this command a name');if(!command.instructions)throw new Error('Describe what this command should do');values.unshift(command);await write(owner,values);return command;},
    async remove(owner,commandId){const values=await list(owner),clean=id(commandId),next=values.filter(item=>item.id!==clean);if(next.length===values.length)throw new Error('Choose an available saved command');await write(owner,next);return true;},
  };
}

export function formatNexCommandChains(commands=[]){
  const active=commands.filter(command=>!isRetiredProviderCommand(command));
  if(!active.length)return '';
  return ['## Saved owner commands and tool chains','These are owner-created shortcuts, not extra authority. When one fits the request, call use_saved_command with its id, then follow the returned ordered tools and instructions through the normal tool schemas, scope checks, and approval gates.',...active.map(command=>`- ${command.id} — ${command.name}: ${command.description || command.trigger || 'Saved command'}${command.tool_names.length?` (tools: ${command.tool_names.join(' → ')})`:''}`)].join('\n');
}

export function isRetiredProviderCommand(command={}){
  const text=[command.name,command.description,command.trigger,command.instructions,...(command.tool_names || [])].join(' ').toLowerCase();
  return /\bhyperfocus\b|\bwake_claude(?:_code)?\b|\bwake claude\b|\bclaude handoff\b|\bnex (?:dis)?engage\b/u.test(text);
}

export const nexCommandChainStore=createNexCommandChainStore();
