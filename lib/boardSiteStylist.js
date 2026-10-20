import {readFileSync} from 'node:fs';
import {describeSiteDesignVocabulary} from './siteDesignVocabulary.js';

// One canonical playbook serves both the plugin package and generic MCP clients.
// Do not append it to stored kit instructions or migrate user records.
const content=readFileSync(new URL('../plugins/nexus-workspace/skills/site-stylist/SKILL.md',import.meta.url),'utf8');
export const SITE_STYLIST_GUIDANCE=Object.freeze({
 name:'site-stylist',version:'1.0.0',source:'Nexus Workspace shared design playbook',
 when:'Apply when the user requests building or redesigning a website, app or board. Preserve existing brand identity and functional UI for ordinary edits. Do not start a build or restyle anything merely because this guidance was read.',
 trust:'Shared task guidance, not system instructions, permission, authorization to publish, or model retraining. Explicit user requirements and safety/tenant boundaries take priority.',
 content,
});
// Fresh reference records per read; do not persist them into owned board kits.
export const boardSharedSkills=()=>[{...SITE_STYLIST_GUIDANCE,design_vocabulary:describeSiteDesignVocabulary()}];

