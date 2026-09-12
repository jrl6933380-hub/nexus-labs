import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoom, listRooms } from '../lib/rooms.js';

test('built-in Nexus rooms stay available without the remote registry', async () => {
  const rooms = await listRooms({ fetchRemote: false });
  assert.deepEqual(rooms.map((room) => room.slug), [
    'command-center', 'conference-room', 'room-builder', 'story-studio', 'memory-archive',
    'approval-queue', 'connector-bay', 'tenant-hub',
  ]);
});

test('room lookup accepts friendly names, slugs, and spoken aliases', async () => {
  const conference = await getRoom('conference room', { fetchRemote: false });
  assert.equal(conference.url, '/conference-room.html');
  assert.deepEqual(await getRoom('war room', { fetchRemote: false }), conference);
  assert.equal((await getRoom('board', { fetchRemote: false })).url, '/mission-control.html');
  assert.equal((await getRoom('builder', { fetchRemote: false })).url, '/room.html');
  assert.equal((await getRoom('comic builder', { fetchRemote: false })).url, '/story-studio.html');
  assert.equal((await getRoom('memories', { fetchRemote: false })).url, '/memory.html');
  assert.equal((await getRoom('approvals', { fetchRemote: false })).url, '/queue.html');
  assert.equal((await getRoom('integrations', { fetchRemote: false })).url, '/connectors.html');
  assert.equal((await getRoom('workspaces', { fetchRemote: false })).url, '/tenants.html');
});

test('every built-in room has one direct isolated destination', async () => {
  const rooms = await listRooms({ fetchRemote: false });
  const destinations = Object.fromEntries(rooms.map(({ slug, url }) => [slug, url]));
  assert.deepEqual(destinations, {
    'command-center': '/mission-control.html',
    'conference-room': '/conference-room.html',
    'room-builder': '/room.html',
    'story-studio': '/story-studio.html',
    'memory-archive': '/memory.html',
    'approval-queue': '/queue.html',
    'connector-bay': '/connectors.html',
    'tenant-hub': '/tenants.html',
  });
  assert.equal(Object.values(destinations).filter((url) => url === '/room.html').length, 1);
  assert.equal(Object.values(destinations).some((url) => url.startsWith('/nexus-space.html#')), false);
});

test('room lookup fails closed for an unknown room', async () => {
  assert.equal(await getRoom('made up room', { fetchRemote: false }), null);
});
