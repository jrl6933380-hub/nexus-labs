import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import { listAllNexSkills } from '../lib/nexSkills.js';
import { TOOL_REGISTRY } from '../lib/nexBrain.js';
import { NEX_TOOL_CATEGORIES } from '../lib/nex/toolCategories.js';
import { toolRegistryManifest } from '../lib/nexToolRegistry.js';

export const OWNER_COMMANDS = Object.freeze([
  { name:'@agent task', description:'Call a named specialist into the current conversation and give it a task.', example:'@Maya research the best options for this.' },
  { name:'@team task', description:'Assign work to the available specialists in the current group.', example:'@team research this, then have the builder make the page.' },
  { name:'Nex engage', description:'Put Nex back in charge after a direct Claude handoff.', example:'Nex engage' },
  { name:'Nex disengage', description:'Pause Nex and open the direct Claude handoff flow.', example:'Nex disengage' },
  { name:'Open a Nexus space', description:'Move to a connected space using its exact name.', example:'Open Schedule' },
]);

export async function ownerCapabilityCatalog({ listSkills = listAllNexSkills } = {}) {
  const tools = toolRegistryManifest(TOOL_REGISTRY).map((tool) => ({
    ...tool,
    description: String(TOOL_REGISTRY.get(tool.name)?.schema?.description || ''),
    category_label: tool.category ? NEX_TOOL_CATEGORIES[tool.category]?.label || tool.category : 'Always available',
  }));
  const skills = (await listSkills()).map(({ name, description, triggers }) => ({ name, description, triggers }));
  return { tools, skills, commands: OWNER_COMMANDS };
}

export function createOwnerCapabilitiesHandler({ getOwner = getNexusOwner, catalog = ownerCapabilityCatalog } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error:'Method not allowed' });
    }
    const owner = await getOwner(req).catch(() => null);
    if (!owner) return res.status(401).json({ error:'Nexus owner authentication required.' });
    try { return res.status(200).json(await catalog()); }
    catch (error) {
      console.error('GET /api/owner-capabilities failed:', error.message);
      return res.status(500).json({ error:'Could not load owner capabilities.' });
    }
  };
}

export default createOwnerCapabilitiesHandler();
