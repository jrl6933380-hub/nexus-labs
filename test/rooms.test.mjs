import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoom, listRooms } from '../lib/rooms.js';

test('built-in Nexus rooms stay available without the remote registry', async () => {
  const rooms = await listRooms({ fetchRemote: false });
  assert.deepEqual(rooms.map((room) => room.slug), [
    'command-center',
    'conference-room',
    'room-builder',
    'memory-archive',
    'approval-queue',
    'connector-bay',
    'tenant-hub',
  ]);
});

test('room lookup accepts friendly names, slugs, and spoken aliases', async () => {
  const conference = await getRoom('conference room', { fetchRemote: false });
  assert.equal(conference.url, '/#conference');
  assert.deepEqual(await getRoom('war room', { fetchRemote: false }), conference);

  assert.equal((await getRoom('board', { fetchRemote: false })).url, '/#command');
  assert.equal((await getRoom('builder', { fetchRemote: false })).url, '/#builder');
  assert.equal((await getRoom('memories', { fetchRemote: false })).url, '/#memory');
  assert.equal((await getRoom('approvals', { fetchRemote: false })).url, '/#queue');
  assert.equal((await getRoom('integrations', { fetchRemote: false })).url, '/#connectors');
  assert.equal((await getRoom('workspaces', { fetchRemote: false })).url, '/#tenants');
});

test('room lookup fails closed for an unknown room', async () => {
  assert.equal(await getRoom('made up room', { fetchRemote: false }), null);
});
