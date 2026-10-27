import {createNexusLab} from './nexusLab.js';
import {createNexusLabUnderstand} from './nexusLabUnderstand.js';
import {nexusLabAssets} from './nexusLabAssets.js';
import {ownerCapabilityCatalog} from '../api/owner-capabilities.js';
import {listVaultItems} from './codeVault.js';
async function catalog(owner){
  const [installed,vault]=await Promise.all([ownerCapabilityCatalog({owner:owner.id}),listVaultItems()]);
  return [...installed.tools.map(t=>({id:`tool:${t.name}`,name:t.name,text:t.description||'',source:'Installed tool'})),...installed.skills.map(s=>({id:`skill:${s.name}`,name:s.name,text:s.description||'',source:s.source||'Installed skill'})),...(Array.isArray(vault)?vault:[]).map(v=>({id:`vault:${v.id||v.name}`,name:v.name,text:[v.purpose,v.when_to_use,...(v.tags||[])].filter(Boolean).join(' '),source:v.source||'Vault reference'}))];
}
export const nexusLabService=createNexusLab({catalog,assets:nexusLabAssets,understand:createNexusLabUnderstand({assets:nexusLabAssets})});
