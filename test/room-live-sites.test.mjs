import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://live-sites-test.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const hashes = new Map();
global.fetch = async (_url, options) => {
  const [command, key, field, value] = JSON.parse(options.body);
  const hash = hashes.get(key) || new Map();
  hashes.set(key, hash);
  let result;
  if (command === 'HSET') { hash.set(field, value); result = 1; }
  else if (command === 'HGET') { result = hash.has(field) ? hash.get(field) : null; }
  else if (command === 'HDEL') { result = hash.delete(field) ? 1 : 0; }
  else if (command === 'HGETALL') { result = []; for (const [f, v] of hash) result.push(f, v); }
  else throw new Error(`Unexpected command ${command}`);
  return { ok: true, json: async () => ({ result }) };
};

const {
  liveSiteLimit, listLiveSites, recordLiveSite, removeLiveSite,
  checkLiveSiteAllowance, LIVE_SITE_LIMITS,
} = await import('../lib/roomLiveSites.js');

test('each plan gets its configured number of live sites', () => {
  assert.equal(liveSiteLimit('free'), 0);
  assert.equal(liveSiteLimit('hosted'), 1);
  assert.equal(liveSiteLimit('growth'), 5);
  assert.equal(liveSiteLimit('unlimited'), Infinity);
});

test('an unknown or missing plan fails closed rather than open', () => {
  // Same posture as canExport: a plan we don't recognise must not become
  // an accidental unlimited-deployments account.
  assert.equal(liveSiteLimit('enterprise-typo'), 0);
  assert.equal(liveSiteLimit(undefined), 0);
  assert.equal(liveSiteLimit(null), 0);
});

test('a hosted account can take one project live, but not a second', async () => {
  const user = 'hosted-user';
  let allowance = await checkLiveSiteAllowance({ userId: user, projectId: 'p1', plan: 'hosted' });
  assert.equal(allowance.allowed, true);
  await recordLiveSite(user, 'p1', { url: 'https://p1.example', deploymentId: 'dpl_1' });

  allowance = await checkLiveSiteAllowance({ userId: user, projectId: 'p2', plan: 'hosted' });
  assert.equal(allowance.allowed, false, 'a second project exceeds the plan');
  assert.equal(allowance.limit, 1);
  assert.equal(allowance.used, 1);
});

test('republishing an already-live project is always allowed and takes no extra slot', async () => {
  // Publishing uses a per-project slug, so this updates the same site.
  // Blocking it would mean a hosted customer could never edit their one
  // live site again — the cap must only ever stop a NEW site going live.
  const user = 'republish-user';
  await recordLiveSite(user, 'p1', { url: 'https://p1.example' });
  const allowance = await checkLiveSiteAllowance({ userId: user, projectId: 'p1', plan: 'hosted' });
  assert.equal(allowance.allowed, true);
  assert.equal(allowance.updating, true);
  assert.equal((await listLiveSites(user)).length, 1, 'still one live site');
});

test('an unlimited plan is never blocked and does not need a lookup', async () => {
  const allowance = await checkLiveSiteAllowance({ userId: 'whale', projectId: 'anything', plan: 'unlimited' });
  assert.equal(allowance.allowed, true);
  assert.equal(allowance.unlimited, true);
});

test('a growth account fills its five slots then stops', async () => {
  const user = 'growth-user';
  for (let i = 1; i <= 5; i += 1) {
    const allowance = await checkLiveSiteAllowance({ userId: user, projectId: `p${i}`, plan: 'growth' });
    assert.equal(allowance.allowed, true, `slot ${i} should be available`);
    await recordLiveSite(user, `p${i}`, { url: `https://p${i}.example` });
  }
  const sixth = await checkLiveSiteAllowance({ userId: user, projectId: 'p6', plan: 'growth' });
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.used, 5);
});

test('taking a site down frees the slot', async () => {
  // Without this a customer on a one-site plan would be permanently stuck
  // after their first publish.
  const user = 'freeing-user';
  await recordLiveSite(user, 'p1', { url: 'https://p1.example' });
  assert.equal((await checkLiveSiteAllowance({ userId: user, projectId: 'p2', plan: 'hosted' })).allowed, false);

  const removal = await removeLiveSite(user, 'p1');
  assert.equal(removal.removed, 1);
  assert.equal((await checkLiveSiteAllowance({ userId: user, projectId: 'p2', plan: 'hosted' })).allowed, true);
});

test('live sites are listed per account with their urls', async () => {
  const user = 'listing-user';
  await recordLiveSite(user, 'alpha', { url: 'https://alpha.example' });
  await recordLiveSite(user, 'beta', { url: 'https://beta.example' });
  const sites = await listLiveSites(user);
  assert.equal(sites.length, 2);
  // Not asserting order: both records can land in the same millisecond, so
  // publishedAt ties are arbitrary. What matters is that each site is
  // present with its url and scoped to this account.
  const byId = Object.fromEntries(sites.map((s) => [s.projectId, s.url]));
  assert.deepEqual(byId, { alpha: 'https://alpha.example', beta: 'https://beta.example' });
  assert.deepEqual(await listLiveSites('nobody-else'), [], "another account's sites must not appear");
});

test('removing a site that was never live is a no-op', async () => {
  assert.deepEqual(await removeLiveSite('listing-user', 'never-published'), { removed: 0 });
  assert.deepEqual(await removeLiveSite(), { removed: 0 });
});

test('the limits table covers every known plan', () => {
  // A plan added without a row here would silently fail closed to 0 rather
  // than getting the tier the customer paid for.
  for (const plan of ['free', 'hosted', 'growth', 'unlimited']) {
    assert.ok(plan in LIVE_SITE_LIMITS, `${plan} needs a live-site limit`);
  }
});
