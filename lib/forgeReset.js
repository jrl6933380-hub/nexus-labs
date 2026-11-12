// Owner-only "start fresh" for Forge test data in Redis: saved leads, lead search/build jobs (with results),
// the mission list, and research import receipts. It never touches accounts, logins, settings, the Forge
// roadmap or brief, model routes, or the Supabase caller/client/commission database.
import { teamCommand } from './teamRuns.js';

export const CONFIRM = 'RESET FORGE';
export const PATTERNS = ['nexus:forge-lead-jobs:v1:*', 'nexus:forge-missions:v1:*', 'nexus:forge:research:receipts:*'];
const LEADS_KEY = 'nexus:forge:leads';

async function keysFor(command, match) {
  const found = new Set();
  let cursor = '0', guard = 0;
  do {
    const [next, batch] = await command(['SCAN', cursor, 'MATCH', match, 'COUNT', 500]);
    for (const k of batch || []) found.add(k);
    cursor = String(next);
  } while (cursor !== '0' && ++guard < 200);
  return [...found];
}

export async function resetForge({ confirm }, { command = teamCommand } = {}) {
  if (confirm !== CONFIRM) throw Object.assign(new Error(`Type ${CONFIRM} to confirm.`), { status: 400 });
  const leads = Number(await command(['HLEN', LEADS_KEY])) || 0;
  if (leads) await command(['DEL', LEADS_KEY]);
  let others = 0;
  for (const pattern of PATTERNS) {
    const keys = await keysFor(command, pattern);
    for (let i = 0; i < keys.length; i += 100) others += Number(await command(['DEL', ...keys.slice(i, i + 100)])) || 0;
  }
  return { cleared: { leads, jobsMissionsAndReceipts: others } };
}
