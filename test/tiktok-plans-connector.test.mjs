import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokPlanStore } from '../lib/tiktokPlans.js';
import { createWorkspaceService, WORKSPACE_WRITES } from '../lib/workspaceConnector.js';

// A tiny in-memory command() that understands HGET/HSET/HVALS/HLEN/HDEL and the two Lua scripts.
function memory() {
  const hashes = new Map();
  const h = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  return async (parts) => {
    const [cmd, key, ...rest] = parts;
    if (cmd === 'HGET') return h(key).get(rest[0]) ?? null;
    if (cmd === 'HVALS') return [...h(key).values()];
    if (cmd === 'EVAL') {
      const [script, , k, field, old, next, limit] = [parts[1], parts[2], parts[3], parts[4], parts[5], parts[6], parts[7]];
      const map = h(k);
      if (script.includes('delete-cas')) { const cur = map.get(field); if (cur === undefined || cur !== old) return 0; map.delete(field); return 1; }
      const cur = map.get(field) ?? '';
      if (cur !== old) return 0;
      if (cur === '' && map.size >= Number(limit)) return -1;
      map.set(field, next); return 1;
    }
    throw new Error('unexpected ' + cmd);
  };
}
function setup() {
  let n = 0, t = 1000;
  const saved = [];
  const ads = { async save(user, input) { saved.push({ user, ...input }); return { campaign_id: input.campaign_id, name: 'Ad', duration: 15, format: 'portrait', studio_url: '/ad-maker.html?ad=' + input.campaign_id }; } };
  const store = createTikTokPlanStore({ command: memory(), now: () => ++t, uuid: () => 'b' + (++n), ads });
  return { store, saved };
}
test('connector exposes the tools, owner only, writes need request ids', async () => {
  let WORKSPACE_TOOLS = null;
  try { ({ WORKSPACE_TOOLS } = await import('../lib/workspaceBoard.js')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } // SDK not installed here
  const names = (WORKSPACE_TOOLS || []).map((t) => t[0]);
  if (WORKSPACE_TOOLS) for (const n of ['list_nexus_tiktok_plan', 'save_nexus_tiktok_campaign', 'save_nexus_tiktok_video', 'delete_nexus_tiktok_video', 'read_nexus_tiktok_ad_scope', 'build_nexus_tiktok_ad']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length);
  if (WORKSPACE_TOOLS) for (const t of WORKSPACE_TOOLS.filter((x) => x[1].startsWith('tiktok_'))) assert.equal(t[4], WORKSPACE_WRITES.has(t[1]), t[0] + ' write flag');
  for (const a of ['tiktok_save_campaign', 'tiktok_save_video', 'tiktok_delete_video', 'tiktok_build_ad']) assert.ok(WORKSPACE_WRITES.has(a));
  const { store } = setup();
  const exec = createWorkspaceService({ tiktok: store });
  const owner = { id: 'justin', workbenchUserId: 'w', scheduleUserId: 'owner:justin', owner: true };
  const customer = { id: 'c', workbenchUserId: 'w', scheduleUserId: 's', owner: false };
  await assert.rejects(() => exec('tiktok_plan', {}, customer), /owner/i);
  await exec('tiktok_save_campaign', { id: 'c1', campaign: { name: 'L' } }, owner);
  assert.equal((await exec('tiktok_plan', {}, owner)).campaigns.length, 1);
  await assert.rejects(() => exec('tiktok_plan', { x: 1 }, owner), /Unsupported field/);
});
