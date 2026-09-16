import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://forge-accounts-test.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

// Minimal fake of the Upstash REST shape used by roomAuth/forgeRoles.
const users = new Map();
global.fetch = async (_url, options) => {
  const [command, key, field, value] = JSON.parse(options.body);
  let result;
  if (command === 'HGET') result = users.get(`${key}:${field}`) ?? null;
  else if (command === 'HSET') { users.set(`${key}:${field}`, value); result = 1; }
  else if (command === 'HSETNX') {
    const storedKey = `${key}:${field}`;
    if (users.has(storedKey)) result = 0;
    else { users.set(storedKey, value); result = 1; }
  } else throw new Error(`Unexpected command ${command}`);
  return { ok: true, json: async () => ({ result }) };
};

const { provisionForgeAccount, findForgeAccount, listForgeAccounts } = await import('../lib/forgeAccounts.js');
const { getForgeRole, FORGE_ROLES } = await import('../lib/forgeRoles.js');
const { verifyUser, getUserPlan, PLANS } = await import('../lib/roomAuth.js');

test('a worker account is created, seated, and usable with the returned password', async () => {
  const account = await provisionForgeAccount({ username: 'worker-one', kind: 'worker' });
  assert.equal(account.username, 'worker-one');
  assert.equal(account.role, FORGE_ROLES.WORKER);
  assert.equal(account.generatedPassword, true);
  assert.ok(account.password.length >= 16, 'a generated password should be long');
  assert.equal(await getForgeRole('worker-one'), FORGE_ROLES.WORKER);
  assert.ok(await verifyUser('worker-one', account.password), 'the returned password must actually work');
});

test('a manager account gets the manager role', async () => {
  const account = await provisionForgeAccount({ username: 'manager-one', kind: 'manager' });
  assert.equal(account.role, FORGE_ROLES.MANAGER);
  assert.equal(await getForgeRole('manager-one'), FORGE_ROLES.MANAGER);
});

test('a customer/test account gets no Forge role and stays on the free tier', async () => {
  const account = await provisionForgeAccount({ username: 'test-account' });
  assert.equal(account.kind, 'customer');
  assert.equal(account.role, null);
  assert.equal(account.plan, PLANS.FREE);
  assert.equal(await getForgeRole('test-account'), null);
});

test('a caller-supplied password is used as given', async () => {
  const account = await provisionForgeAccount({ username: 'chosen-pw', password: 'hunter2hunter2' });
  assert.equal(account.password, 'hunter2hunter2');
  assert.equal(account.generatedPassword, false);
  assert.ok(await verifyUser('chosen-pw', 'hunter2hunter2'));
});

test('an explicit plan is applied', async () => {
  await provisionForgeAccount({ username: 'paid-tester', plan: PLANS.HOSTED });
  assert.equal(await getUserPlan('paid-tester'), PLANS.HOSTED);
});

test('creating an existing username is refused rather than replacing the account', async () => {
  await provisionForgeAccount({ username: 'taken-name', password: 'originalpass1' });
  await assert.rejects(
    () => provisionForgeAccount({ username: 'taken-name', password: 'attackerpass1' }),
    /already taken/,
  );
  // The original credentials must survive the failed second attempt.
  assert.ok(await verifyUser('taken-name', 'originalpass1'));
  assert.equal(await verifyUser('taken-name', 'attackerpass1'), null);
});

test('invalid kinds, plans, and short passwords are rejected', async () => {
  await assert.rejects(() => provisionForgeAccount({ username: 'bad-kind', kind: 'operator' }), /kind must be one of/);
  await assert.rejects(() => provisionForgeAccount({ username: 'bad-plan', plan: 'platinum' }), /plan must be one of/);
  await assert.rejects(() => provisionForgeAccount({ username: 'bad-pw', password: 'short' }), /at least 8/);
});

test('there is no way to provision an operator account', async () => {
  // Operator status comes from NEXUS_OPERATOR_USERNAMES and is not writable
  // at runtime. This is the ceiling that stops any agent or compromised
  // session from escalating an account; if someone adds an 'operator' kind,
  // this test should fail and the change should be reconsidered.
  await assert.rejects(() => provisionForgeAccount({ username: 'wannabe', kind: 'operator' }), /kind must be one of/);
  const account = await provisionForgeAccount({ username: 'ordinary-user', kind: 'manager' });
  assert.notEqual(account.role, 'operator');
});

test('a free account is findable even though it is not a billing customer', async () => {
  // The bug this prevents: list_forge_customers covers only paid/Stripe
  // accounts, so a free test account is invisible there. An empty customer
  // list was once read as "the account does not exist" when it existed fine.
  const created = await provisionForgeAccount({ username: 'free-tester' });
  const found = await findForgeAccount('free-tester');
  assert.equal(found.exists, true);
  assert.equal(found.account.plan, PLANS.FREE);
  assert.equal(found.account.forgeRole, null);
  assert.equal(found.account.hasBillingOnRecord, false, 'a free account has no billing, and must still be findable');
  assert.equal(created.username, found.account.username);
});

test('lookup is case-insensitive and reports a genuine miss as not found', async () => {
  await provisionForgeAccount({ username: 'CaseTest' });
  assert.equal((await findForgeAccount('casetest')).exists, true);
  assert.equal((await findForgeAccount('nobody-here')).exists, false);
  assert.equal((await findForgeAccount('nobody-here')).account, null);
});

test('account lookups never return credentials', async () => {
  await provisionForgeAccount({ username: 'secret-holder', password: 'supersecret123' });
  const found = await findForgeAccount('secret-holder');
  const serialized = JSON.stringify(found);
  assert.doesNotMatch(serialized, /supersecret123/);
  for (const field of ['password', 'passwordHash', 'salt', 'securityAnswerHash', 'answerSalt']) {
    assert.equal(found.account[field], undefined, `${field} must never be exposed`);
  }
});

test('accounts can be listed and filtered by role and plan', async () => {
  await provisionForgeAccount({ username: 'filter-worker', kind: 'worker' });
  await provisionForgeAccount({ username: 'filter-manager', kind: 'manager' });
  await provisionForgeAccount({ username: 'filter-paid', plan: PLANS.HOSTED });

  const workers = await listForgeAccounts({ role: FORGE_ROLES.WORKER });
  assert.ok(workers.some((a) => a.username === 'filter-worker'));
  assert.ok(!workers.some((a) => a.username === 'filter-manager'), 'role filter must exclude other roles');

  const hosted = await listForgeAccounts({ plan: PLANS.HOSTED });
  assert.ok(hosted.some((a) => a.username === 'filter-paid'));
  assert.ok(hosted.every((a) => a.plan === PLANS.HOSTED));

  const all = await listForgeAccounts();
  assert.ok(all.length >= 3, 'an unfiltered list includes free accounts too');
});
