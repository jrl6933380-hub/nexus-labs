import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const authApi = await readFile(new URL('../api/room-auth.js', import.meta.url), 'utf8');
const room = await readFile(new URL('../public/room.html', import.meta.url), 'utf8');

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

test('Room Builder mounts the portable Nex dock only for an operator session', () => {
  assert.match(room, /if \(data\.operator === true\) mountOperatorNexDock\(\)/);
  assert.match(room, /script\.src = '\/nex-chat-bar\.js'/);
  assert.match(room, /script\.dataset\.operatorNexDock = 'true'/);
  assert.doesNotMatch(room, /data\.username\s*===\s*['"]Mrlopez['"]/i);
});
