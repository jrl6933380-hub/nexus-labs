import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://room-auth-test.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.ROOM_INVITE_CODE = 'invite-only';

const users = new Map();
global.fetch = async (_url, options) => {
  const [command, key, field, value] = JSON.parse(options.body);
  let result;
  if (command === 'HGET') result = users.get(`${key}:${field}`) ?? null;
  else if (command === 'HSETNX') {
    const storedKey = `${key}:${field}`;
    if (users.has(storedKey)) result = 0;
    else {
      users.set(storedKey, value);
      result = 1;
    }
  } else {
    throw new Error(`Unexpected command ${command}`);
  }
  return { ok: true, json: async () => ({ result }) };
};

const { createUser, verifyUser, SECURITY_QUESTIONS } = await import('../lib/roomAuth.js?test=atomic-signup');

// createUser's signature is (username, password, email, securityQuestion,
// securityAnswer). This test used to pass an invite code as the third
// argument, which made BOTH concurrent attempts fail validation before they
// ever reached the HSETNX race it is meant to exercise — so it was not
// actually testing the atomic guard at all.
const signup = (username, password) => createUser(
  username,
  password,
  `${username}@example.test`,
  SECURITY_QUESTIONS[0],
  'a security answer',
);

test('concurrent signups cannot replace the same Room account', async () => {
  const attempts = await Promise.allSettled([
    signup('same-account', 'first-password'),
    signup('same-account', 'second-password'),
  ]);

  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
  assert.match(attempts.find((attempt) => attempt.status === 'rejected').reason.message, /already taken/);

  const firstWorks = await verifyUser('same-account', 'first-password');
  const secondWorks = await verifyUser('same-account', 'second-password');
  assert.equal(Boolean(firstWorks) !== Boolean(secondWorks), true);
});
