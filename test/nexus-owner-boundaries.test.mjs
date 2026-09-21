import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ownerApi, ownerLibrary, dashboard, mission, ventures, forgeRoom, forgeChat] = await Promise.all([
  readFile(new URL('../api/nexus-auth.js', import.meta.url), 'utf8'),
  readFile(new URL('../lib/nexusOwnerAuth.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/mission-control.html', import.meta.url), 'utf8'),
  readFile(new URL('../api/ventures.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/room.html', import.meta.url), 'utf8'),
  readFile(new URL('../api/room-chat.js', import.meta.url), 'utf8'),
]);

test('owner setup links require the existing private agent bearer', () => {
  assert.match(ownerApi, /action === 'issue_setup_link'/u);
  assert.match(ownerApi, /NEXUS_AGENT_API_TOKEN/u);
  assert.match(ownerApi, /internalAgentAuthorized\(req\)/u);
  assert.match(ownerLibrary, /GETDEL/u, 'setup tickets must be atomically single-use');
  assert.match(ownerLibrary, /nexus:owner:credential:v1/u);
  assert.match(ownerLibrary, /nexus_owner_session/u);
  assert.doesNotMatch(ownerLibrary, /import .*roomAuth/u);
});

test('the launch station and owner surfaces use Nexus auth', () => {
  for (const source of [dashboard, mission, ventures]) assert.match(source, /nexus-auth|nexusOwnerAuth/u);
  assert.doesNotMatch(ventures, /roomAuth/u);
  assert.match(dashboard, /nexus-login\.html/u);
  assert.match(mission, /nexus-login\.html/u);
});

test('Forge customer behavior remains independent from owner auth', () => {
  assert.match(forgeRoom, /Exploring as a guest/u);
  assert.match(forgeChat, /getOrCreateAnonId/u);
  assert.match(forgeChat, /hasOwnBrain/u);
  assert.match(forgeChat, /BRAIN_REQUIRED/u);
  assert.doesNotMatch(forgeRoom, /nexus-login\.html/u);
  assert.doesNotMatch(forgeChat, /nexusOwnerAuth/u);
});
