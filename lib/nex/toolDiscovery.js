import { NEX_TOOL_CATEGORIES } from './toolCategories.js';

const normalize = value => String(value || '').toLowerCase().replace(/[_\W]+/gu, ' ').trim().replace(/\s+/gu, ' ');
const contains = (text, phrase) => (` ${text} `).includes(` ${normalize(phrase)} `);
const aliases = {
  coding: ['repos', 'repositories', 'branches', 'files', 'patch', 'debug', 'bug', 'broken app', 'build a page', 'build an app', 'build a tool'],
  planner: ['remind', 'rescheduling', 'appointments', 'events', 'next day', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  deploy: ['deployments', 'deployment logs', 'failed to publish'],
  billing: ['money back', 'cancel my plan', 'cancel the plan'],
  collab: ['team', 'teammate', 'handoffs'],
  launch: ['put it live', 'put this live', 'take this site live', 'publish a new site'],
};

// Whole phrases prevent "ask" matching "task" and "app" matching "approve".
// Retain several relevant categories for requests that cross capabilities.
export function matchToolCategories(query) {
  const q = normalize(query);
  if (!q) return [];
  const entries = Object.entries(NEX_TOOL_CATEGORIES);
  const exact = entries.find(([key, cat]) => q === normalize(key) || q === normalize(cat.label));
  if (exact) return [exact[0]];
  const scored = entries.map(([key, cat]) => {
    const names = cat.tools.filter(name => contains(q, name));
    const phrases = [...new Set([key, ...(cat.tags || []), ...(aliases[key] || [])].map(normalize))];
    const hits = phrases.filter(phrase => contains(q, phrase));
    return { key, score: names.length * 10 + hits.length };
  }).filter(entry => entry.score > 0);
  return scored.sort((a, b) => b.score - a.score).slice(0, 4).map(entry => entry.key);
}

export function toolCategoryDirectory(allowedToolNames = null) {
  return Object.entries(NEX_TOOL_CATEGORIES)
    .map(([key, cat]) => [key, cat, cat.tools.filter(name => !allowedToolNames || allowedToolNames.has(name))])
    .filter(([, , tools]) => tools.length)
    .map(([key, cat, tools]) => `${key} — ${cat.label}: ${tools.join(', ')}`)
    .join('\n');
}

export const CAPABILITY_DISCOVERY_POLICY = [
  'Available capability directory (names only; use tool_search with a category key to load its schemas).',
  'Before saying you lack a tool or cannot perform an action, check this directory and search the relevant category. Missing schemas are not missing capabilities.',
  'For multi-step work, search each relevant category. An empty search returns the permitted directory.',
  'A discovered capability never overrides permissions, approvals, or a real tool failure. Report actual blockers accurately.',
  'For repository work, discover and verify the repository owner/name, branch, and file from tool results before writing. Agent names are not GitHub owners. After a missing-file or 404 error, inspect the correct target before trying another write; do not invent paths or repositories.',
].join(' ');
