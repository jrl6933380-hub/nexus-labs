import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const authApi = await readFile(new URL('../api/room-auth.js', import.meta.url), 'utf8');

process.env.NEXUS_OPERATOR_USERNAMES = 'Mrlopez, BackupAdmin';
const { isOperatorUser } = await import('../lib/roomAuth.js?test=operator-role');

test('operator identity is resolved server-side and case-insensitively', () => {
  assert.equal(isOperatorUser('Mrlopez'), true);
  assert.equal(isOperatorUser('mrLOPEZ'), true);
  assert.equal(isOperatorUser('BackupAdmin'), true);
  assert.equal(isOperatorUser('customer-one'), false);
  assert.equal(isOperatorUser(''), false);
});

test('room auth returns only its server-derived operator capability', () => {
  assert.match(authApi, /operator: isOperatorUser\(username\)/);
  assert.match(authApi, /operator: isOperatorUser\(user\.username\)/);
  assert.doesNotMatch(authApi, /req\.body[^\n]*operator/);
});

// The Room Builder operator-dock test was removed with public/room.html, which
// now only forwards to /forge.html.
