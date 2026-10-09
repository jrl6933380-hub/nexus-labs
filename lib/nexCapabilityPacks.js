import fs from 'node:fs/promises';
import path from 'node:path';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ROLES = new Set(['nex', 'research', 'build', 'life', 'review', 'custom']);
const FORBIDDEN = /(?:bypass|disable|ignore|override)\s+(?:an?\s+)?(?:approval|permission|policy|safety)|grant\s+(?:itself|yourself)\s+(?:access|permission|tools?)/iu;

function text(value, limit = 1200) {
  return String(value || '').replace(/\r\n/gu, '\n').trim().slice(0, limit);
}

function stringList(value, limit = 20) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 100)).filter(Boolean))].slice(0, limit);
}

function namedItems(value, kind, limit = 12) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((item, index) => {
    const id = text(item?.id || `${kind}-${index + 1}`, 80);
    const name = text(item?.name, 100);
    const description = text(item?.description, 500);
    const steps = stringList(item?.steps, 12);
    if (!ID.test(id) || !name || !description) throw new Error(`${kind} entries require a valid id, name, and description`);
    if (FORBIDDEN.test(`${description}\n${steps.join('\n')}`)) throw new Error(`${kind} attempts to weaken runtime authority`);
    return Object.freeze({ id, name, description, steps });
  });
}

export function parseNexCapabilityPack(source, sourcePath = 'CAPABILITY.json') {
  let raw;
  try { raw = JSON.parse(String(source || '')); } catch { throw new Error(`${sourcePath}: invalid JSON`); }
  const id = text(raw.id, 80);
  const name = text(raw.name, 100);
  const description = text(raw.description, 600);
  const roles = stringList(raw.roles, 8);
  const guidance = text(raw.guidance, 4000);
  if (!ID.test(id)) throw new Error(`${sourcePath}: invalid capability pack id`);
  if (!name || !description || !roles.length) throw new Error(`${sourcePath}: name, description, and roles are required`);
  if (roles.some((role) => !ROLES.has(role))) throw new Error(`${sourcePath}: unsupported agent role`);
  if (FORBIDDEN.test(guidance)) throw new Error(`${sourcePath}: capability pack attempts to weaken runtime authority`);
  return Object.freeze({
    id, name, description, roles, guidance,
    skills: stringList(raw.skills),
    toolCategories: stringList(raw.tool_categories),
    preloadToolCategories: stringList(raw.preload_tool_categories, 4),
    workflows: namedItems(raw.workflows, 'workflow'),
    commands: namedItems(raw.commands, 'command'),
    evaluations: stringList(raw.evaluations, 16),
    sourcePath,
  });
}

export async function listAllNexCapabilityPacks({ rootDir = path.join(process.cwd(), 'nex-capabilities') } = {}) {
  let entries;
  try { entries = await fs.readdir(rootDir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const packs = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const sourcePath = path.join(rootDir, entry.name, 'CAPABILITY.json');
    try { packs.push(parseNexCapabilityPack(await fs.readFile(sourcePath, 'utf8'), sourcePath)); }
    catch (error) { console.error('Skipping invalid Nex capability pack:', error.message); }
  }
  return packs;
}

export function conversationCapabilityRoles(conversation) {
  if (conversation?.kind === 'specialist') return [conversation.role || 'custom'];
  if (conversation?.kind === 'group') {
    const roles = (conversation.members || []).map((member) => member?.role).filter(Boolean);
    if (conversation.include_nex !== false) roles.push('nex');
    return [...new Set(roles.length ? roles : ['custom'])];
  }
  return ['nex'];
}

export function selectNexCapabilityPacks(packs, conversation) {
  const roles = new Set(conversationCapabilityRoles(conversation));
  const assigned = new Set([
    ...(Array.isArray(conversation?.capability_pack_ids) ? conversation.capability_pack_ids : []),
    ...(conversation?.kind === 'group' ? (conversation.members || []).flatMap((member) => Array.isArray(member?.capability_pack_ids) ? member.capability_pack_ids : []) : []),
  ]);
  return (Array.isArray(packs) ? packs : []).filter((pack) => assigned.has(pack.id) || pack.roles.some((role) => roles.has(role)));
}

export async function loadNexCapabilityPacks(conversation, options = {}) {
  return selectNexCapabilityPacks(await listAllNexCapabilityPacks(options), conversation);
}

export function capabilityPackManifest(pack) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    roles: [...pack.roles],
    skills: [...pack.skills],
    tool_categories: [...pack.toolCategories],
    workflows: pack.workflows.map(({ id, name, description, steps }) => ({ id, name, description, steps: [...steps] })),
    commands: pack.commands.map(({ id, name, description }) => ({ id, name, description })),
    evaluations: [...pack.evaluations],
    source: pack.sourcePath ? String(pack.sourcePath).split('/').slice(-2).join('/') : '',
  };
}

export function formatNexCapabilityPacks(packs = []) {
  if (!packs.length) return '';
  return packs.map((pack) => [
    `#### Capability pack: ${pack.name} (${pack.id})`,
    pack.description,
    pack.guidance ? `Guidance: ${pack.guidance}` : '',
    pack.workflows.length ? `Available workflows:\n${pack.workflows.map((workflow) => `- ${workflow.name}: ${workflow.description}${workflow.steps.length ? ` Steps: ${workflow.steps.join(' → ')}` : ''}`).join('\n')}` : '',
    pack.commands.length ? `Useful commands:\n${pack.commands.map((command) => `- ${command.name}: ${command.description}`).join('\n')}` : '',
    pack.evaluations.length ? `Completion checks:\n${pack.evaluations.map((check) => `- ${check}`).join('\n')}` : '',
    'This pack prioritizes guidance and tool discovery only. It never expands the current conversation permissions, approvals, or safety policy.',
  ].filter(Boolean).join('\n')).join('\n\n');
}
