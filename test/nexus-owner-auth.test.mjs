import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://nexus-owner-auth-test.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.NEXUS_OWNER_ID = 'justin';

const store = new Map();
global.fetch = async (_url, options) => {
  const command = JSON.parse(options.body);
  const [name, key, value, option] = command;
  let result;
  if (name === 'GET') result = store.get(key) ?? null;
  else if (name === 'GETDEL') { result = store.get(key) ?? null; store.delete(key); }
  else if (name === 'SET') {
    if (option === 'NX' && store.has(key)) result = null;
    else { store.set(key, value); result = 'OK'; }
  } else if (name === 'DEL') result = store.delete(key) ? 1 : 0;
  else if (name === 'KEYS') {
    const prefix = key.replace(/\*$/u, '');
    result = [...store.keys()].filter((storedKey) => storedKey.startsWith(prefix));
  } else if (name === 'INCR') {
    result = Number(store.get(key) || 0) + 1;
    store.set(key, String(result));
  } else if (name === 'EXPIRE') result = store.has(key) ? 1 : 0;
  else throw new Error(`Unexpected command ${name}`);
  return { ok: true, json: async () => ({ result }) };
};

const auth = await import('../lib/nexusOwnerAuth.js');
const { getRequestUser } = await import('../lib/roomAuth.js');

test('Nexus owner password and cookie are independent from Forge auth', async () => {
  assert.equal(auth.NEXUS_OWNER_COOKIE, 'nexus_owner_session');
  assert.doesNotMatch(auth.serializeOwnerCookie('abc'), /nexus_room_session/u);
  assert.equal(await auth.ownerPasswordIsSet(), false);

  const issued = await auth.issueOwnerSetupTicket();
  assert.equal(issued.mode, 'setup');
  assert.deepEqual(await auth.setOwnerPasswordWithTicket(issued.ticket, 'a dedicated nexus password'), { id: 'justin' });
  assert.equal(await auth.ownerPasswordIsSet(), true);
  assert.equal((await auth.verifyOwnerPassword('a dedicated nexus password')).id, 'justin');
  assert.equal(await auth.verifyOwnerPassword('wrong password'), null);
});

test('setup tickets are single-use', async () => {
  const issued = await auth.issueOwnerSetupTicket();
  assert.equal(issued.mode, 'reset');
  await auth.setOwnerPasswordWithTicket(issued.ticket, 'replacement nexus password');
  await assert.rejects(
    () => auth.setOwnerPasswordWithTicket(issued.ticket, 'another replacement password'),
    /invalid or expired/u,
  );
});

test('owner sessions resolve only from the dedicated cookie', async () => {
  const token = await auth.createOwnerSession();
  assert.deepEqual(await auth.getNexusOwner({ headers: { cookie: `nexus_owner_session=${token}` } }), { id: 'justin' });
  assert.equal(await auth.getNexusOwner({ headers: { cookie: `nexus_room_session=${token}` } }), null);
  await auth.destroyOwnerSession(token);
  assert.equal(await auth.getNexusOwner({ headers: { cookie: `nexus_owner_session=${token}` } }), null);
});

test('password policy rejects short credentials before consuming a ticket', async () => {
  const issued = await auth.issueOwnerSetupTicket();
  await assert.rejects(() => auth.setOwnerPasswordWithTicket(issued.ticket, 'too-short'), /at least 12/u);
  await auth.setOwnerPasswordWithTicket(issued.ticket, 'long enough replacement');
});

test('four-digit owner code needs the trusted device cookie and limits guesses', async () => {
  const device = await auth.trustOwnerDevice('0427');
  const trusted = { headers: { cookie: `nexus_owner_device=${device}` } };
  assert.equal(await auth.deviceHasOwnerPin(trusted), true);
  assert.equal(await auth.deviceHasOwnerPin({ headers: {} }), false);
  assert.equal(await auth.verifyOwnerPin({ headers: {} }, '0427'), null);
  assert.equal((await auth.verifyOwnerPin(trusted, '0427'))?.id, 'justin');
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(await auth.verifyOwnerPin(trusted, '0000'), null);
  assert.deepEqual(await auth.verifyOwnerPin(trusted, '0427'), { locked: true });
  assert.doesNotMatch(auth.serializeDeviceCookie(device), /nexus_room_session/u);
  await auth.forgetOwnerDevice(trusted);
  assert.equal(await auth.deviceHasOwnerPin(trusted), false);
});

test('a valid Nexus owner session opens Forge under the owner identity without a Forge login', async () => {
  const token = await auth.createOwnerSession();
  assert.equal(await getRequestUser({ headers: { cookie: `nexus_owner_session=${token}` } }), 'Mrlopez');
  assert.equal(await getRequestUser({ headers: { cookie: 'nexus_owner_session=not-a-session' } }), null);
  assert.equal(await getRequestUser({ headers: {} }), null);
  await auth.destroyOwnerSession(token);
});
