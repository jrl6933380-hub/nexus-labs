import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import { listAllNexSkills } from '../lib/nexSkills.js';
import { TOOL_REGISTRY } from '../lib/nexBrain.js';
import { NEX_TOOL_CATEGORIES } from '../lib/nex/toolCategories.js';
import { toolRegistryManifest } from '../lib/nexToolRegistry.js';
import { nexCommandChainStore } from '../lib/nexCommandChains.js';

export const OWNER_COMMANDS = Object.freeze([
  { name:'@agent task', description:'Call a named specialist into the current conversation and give it a task.', example:'@Maya research the best options for this.' },
  { name:'@team task', description:'Assign work to the available specialists in the current group.', example:'@team research this, then have the builder make the page.' },
  { name:'Nex engage', description:'Put Nex back in charge after a direct Claude handoff.', example:'Nex engage' },
  { name:'Nex disengage', description:'Pause Nex and open the direct Claude handoff flow.', example:'Nex disengage' },
  { name:'Open a Nexus space', description:'Move to a connected space using its exact name.', example:'Open Schedule' },
]);

export async function ownerCapabilityCatalog({ owner = null, listSkills = listAllNexSkills, commandStore = nexCommandChainStore } = {}) {
  const tools = toolRegistryManifest(TOOL_REGISTRY).map((tool) => ({
    ...tool,
    description: String(TOOL_REGISTRY.get(tool.name)?.schema?.description || ''),
    input_schema: TOOL_REGISTRY.get(tool.name)?.schema?.input_schema || {type:'object',properties:{}},
    category_label: tool.category ? NEX_TOOL_CATEGORIES[tool.category]?.label || tool.category : 'Always available',
  }));
  const skills = (await listSkills()).map(({ name, description, triggers, instructions, sourcePath }) => ({ name, description, triggers, instructions,source:sourcePath ? String(sourcePath).split('/').slice(-2).join('/') : '' }));
  const saved = owner ? await commandStore.list(owner) : [];
  return { tools, skills, commands: [...OWNER_COMMANDS.map(command=>({...command,type:'built_in'})),...saved.map(command=>({...command,type:'saved'}))] };
}

export function createOwnerCapabilitiesHandler({ getOwner = getNexusOwner, catalog = ownerCapabilityCatalog, commandStore = nexCommandChainStore } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET','POST','DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).json({ error:'Method not allowed' });
    }
    const owner = await getOwner(req).catch(() => null);
    if (!owner) return res.status(401).json({ error:'Nexus owner authentication required.' });
    try {
      if(req.method==='POST'){
        if(req.body?.action!=='create_command')return res.status(400).json({error:'Choose a supported owner capability action.'});
        const command=await commandStore.create(owner.id,req.body, new Set(TOOL_REGISTRY.keys()));
        return res.status(201).json({command});
      }
      if(req.method==='DELETE'){
        if(req.body?.action!=='delete_command')return res.status(400).json({error:'Choose a supported owner capability action.'});
        await commandStore.remove(owner.id,req.body.command_id);return res.status(200).json({deleted:true});
      }
      return res.status(200).json(await catalog({owner:owner.id,commandStore}));
    }
    catch (error) {
      console.error(`${req.method} /api/owner-capabilities failed:`, error.message);
      const validation=/^(Give|Describe|Choose|You have reached)/u.test(error.message);
      const safe=validation?error.message:req.method==='GET'?'Could not load owner capabilities.':'Owner capabilities could not be updated.';
      return res.status(validation?400:500).json({ error:safe });
    }
  };
}

export default createOwnerCapabilitiesHandler();
