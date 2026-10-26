import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchStore, resultSchema } from '../lib/researchJobs.js';

test('result accepts competitor pricing fields and still accepts old reports', () => {
  const r = resultSchema.parse({
    summary: 'Buffet chain.', website: 'https://example.com',
    products: [{ name: 'Large pizza', price: '$14.99', url: 'https://example.com/menu' }],
    subscriptions: [{ name: 'Rewards', price: 'Free', billing: 'n/a', includes: '$5 back per $100' }],
    deals: [{ title: 'Take two', details: '2 slices, 2 chicken, 2 sides', ends: '' }],
    fees_and_policies: ['Delivery fee varies'], strengths: ['Arcade'], weaknesses: ['Slow on weekends'], opportunities: ['Beat them on delivery'],
  });
  assert.equal(r.products[0].price, '$14.99');
  assert.deepEqual(resultSchema.parse({ summary: 'old' }).products, []);
  assert.throws(() => resultSchema.parse({ summary: 'x', products: [{ name: 'a', price: '1', url: 'javascript:alert(1)' }] }));
});
import { createWorkspaceService, WORKSPACE_WRITES } from '../lib/workspaceConnector.js';

function memory() {
  const h = new Map();
  return async (parts) => {
    const [cmd, , ...rest] = parts;
    if (cmd === 'HGET') return h.get(rest[0]) ?? null;
    if (cmd === 'HVALS') return [...h.values()];
    if (cmd === 'EVAL') {
      const [field, old, next, limit] = [parts[4], parts[5], parts[6], parts[7]];
      const cur = h.get(field) ?? '';
      if (cur !== old) return 0;
      if (cur === '' && h.size >= Number(limit)) return -1;
      h.set(field, next); return 1;
    }
    throw new Error('unexpected ' + cmd);
  };
}
const setup = () => { let t = 1000; return createResearchStore({ command: memory(), now: () => (t += 10) }); };
const good = { summary: 'They post daily.', hooks: ['Wait for it'], content_ideas: [{ title: 'T', hook: 'H' }], sources: [{ title: 's', url: 'https://example.com/x' }] };

test('link, submit, claim, complete, status end to end', async () => {
  const s = setup();
  const { token, link_id } = await s.createLink({ label: 'Mike', runs: 2 });
  assert.match((await s.listLinks())[0].id, /^[a-f0-9]{10}$/);
  assert.equal(JSON.stringify(await s.listLinks()).includes(token), false);
  const sub = await s.submit(token, { competitor: '  @rival\n co ', goal: 'plumbing' });
  assert.equal(sub.runs_left, 1);
  assert.equal((await s.status(token, { job_id: sub.job_id })).position, 1);
  const c = await s.claim({});
  assert.equal(c.claimed, true); assert.equal(c.competitor, '@rival co');
  assert.equal((await s.claim({})).claimed, false);
  assert.equal((await s.status(token, { job_id: sub.job_id })).status, 'working');
  await assert.rejects(() => s.complete({ job_id: sub.job_id, result: { ...good, extra: 1 } }), (e) => e.name === 'ZodError');
  await s.complete({ job_id: sub.job_id, result: good });
  const st = await s.status(token, { job_id: sub.job_id });
  assert.equal(st.status, 'done'); assert.equal(st.result.hooks[0], 'Wait for it');
  await assert.rejects(() => s.complete({ job_id: sub.job_id, result: good }), /claimed/);
  assert.equal((await s.list({ status: 'done' }))[0].link, 'Mike');
  await s.revokeLink({ link_id });
  await assert.rejects(() => s.submit(token, { competitor: 'x y' }), /not valid/);
});

test('run limit, bad keys, other links cannot read each other, failed jobs, stale lease', async () => {
  let t = 1000; const s = createResearchStore({ command: memory(), now: () => t });
  const a = await s.createLink({ label: 'A', runs: 1 }), b = await s.createLink({ label: 'B', runs: 1 });
  const ja = await s.submit(a.token, { competitor: 'one' });
  await assert.rejects(() => s.submit(a.token, { competitor: 'two' }), /no runs left/);
  await assert.rejects(() => s.status(b.token, { job_id: ja.job_id }), /No such job/);
  await assert.rejects(() => s.submit('nope', { competitor: 'one' }), /not valid/);
  await assert.rejects(() => s.submit(b.token, { competitor: 'x' }), (e) => e.name === 'ZodError');
  await s.claim({ job_id: ja.job_id });
  t += 31 * 60 * 1000;
  assert.equal((await s.claim({})).claimed, true); // lease expired, picked up again
  await s.complete({ job_id: ja.job_id, error: 'site blocked' });
  assert.equal((await s.status(a.token, { job_id: ja.job_id })).status, 'failed');
});

test('connector actions are owner only and writes are flagged', async () => {
  for (const a of ['research_create_link', 'research_revoke_link', 'research_claim', 'research_complete']) assert.ok(WORKSPACE_WRITES.has(a));
  const exec = createWorkspaceService({ research: setup() });
  const owner = { id: 'j', workbenchUserId: 'w', scheduleUserId: 's', owner: true }, other = { ...owner, owner: false };
  await assert.rejects(() => exec('research_list', {}, other), /owner/i);
  assert.equal((await exec('research_claim', {}, owner)).claimed, false);
  assert.ok((await exec('research_create_link', { label: 'x', runs: 3 }, owner)).path.startsWith('/research.html?k='));
});
