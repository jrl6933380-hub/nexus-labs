import {createNexusLab} from './nexusLab.js';
import {nexusLabAssets} from './nexusLabAssets.js';
import {nexusLabAgentTasks} from './nexusLabAgentRuntime.js';
import {AGENT_CAPABILITIES} from './nexusLabAgentTasks.js';
import {ownerCapabilityCatalog} from '../api/owner-capabilities.js';
import {listVaultItems} from './codeVault.js';
async function catalog(owner){
  const [installed,vault]=await Promise.all([ownerCapabilityCatalog({owner:owner.id}),listVaultItems()]);
  return [...installed.tools.map(t=>({id:`tool:${t.name}`,name:t.name,text:t.description||'',source:'Installed tool'})),...installed.skills.map(s=>({id:`skill:${s.name}`,name:s.name,text:s.description||'',source:s.source||'Installed skill'})),...(Array.isArray(vault)?vault:[]).map(v=>({id:`vault:${v.id||v.name}`,name:v.name,text:[v.purpose,v.when_to_use,...(v.tags||[])].filter(Boolean).join(' '),source:v.source||'Vault reference'}))];
}
// Understand, Detect, Cutout and Video have no outside provider. A connected AI does the work through
// Lab tasks; a capability is ready only after that AI passes its own self-test.
const base=createNexusLab({catalog,assets:nexusLabAssets});
const AGENT=new Set(AGENT_CAPABILITIES);
const AGENT_NOTE='Done by your connected AI (Claude or ChatGPT) through Nexus tools. It must pass a self-test before this shows as ready.';
export const nexusLabService={
  ...base,
  async overview(owner){
    const [o,ready]=await Promise.all([base.overview(owner),nexusLabAgentTasks.readiness(owner)]);
    return {...o,capabilities:o.capabilities.map(c=>AGENT.has(c.id)?{...c,status:ready[c.id]?.passed?'ready':'needs_connection',mode:'agent',requires:AGENT_NOTE,score:ready[c.id]?.best_score??null,runs:ready[c.id]?.runs??0}:c)};
  },
  async run(owner,input,options){
    if(AGENT.has(input?.capability))throw Object.assign(new Error('Create a task for your connected AI instead.'),{status:409});
    return base.run(owner,input,options);
  },
};
