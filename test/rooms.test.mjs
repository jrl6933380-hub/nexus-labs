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
  assert.equal(conference.url, '/conference-room.html');
  assert.deepEqual(await getRoom('war room', { fetchRemote: false }), conference);

  assert.equal((await getRoom('board', { fetchRemote: false })).url, '/');
  assert.equal((await getRoom('builder', { fetchRemote: false })).url, '/room.html');
  assert.equal((await getRoom('memories', { fetchRemote: false })).url, '/memory.html');
  assert.equal((await getRoom('approvals', { fetchRemote: false })).url, '/queue.html');
  assert.equal((await getRoom('integrations', { fetchRemote: false })).url, '/connectors.html');
  assert.equal((await getRoom('workspaces', { fetchRemote: false })).url, '/tenants.html');
});

test('room lookup fails closed for an unknown room', async () => {
  assert.equal(await getRoom('made up room', { fetchRemote: false }), null);
});
