import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoom, listRooms } from '../lib/rooms.js';

test('built-in Nexus rooms stay available without the remote registry', async () => {
  const rooms = await listRooms({ fetchRemote: false });
  assert.deepEqual(rooms.map((room) => room.slug), [
    'life', 'reminders', 'schedule', 'command-center', 'conference-room', 'room-builder', 'forge-field', 'forge-ops',
    'story-studio', 'memory-archive', 'approval-queue', 'connector-bay', 'tenant-hub',
  ]);
});

test('room lookup accepts friendly names, slugs, and spoken aliases', async () => {
  assert.equal((await getRoom('life calendar', {fetchRemote:false})).url, '/workspace.html?view=life');
  assert.equal((await getRoom('my reminders', {fetchRemote:false})).url, '/workspace.html?view=reminders');
  assert.equal((await getRoom('calendar', {fetchRemote:false})).url, '/workspace.html?view=planner');
  const conference = await getRoom('conference room', { fetchRemote: false });
  assert.equal(conference.url, '/workspace.html?view=agents');
  assert.deepEqual(await getRoom('war room', { fetchRemote: false }), conference);
  assert.equal((await getRoom('board', { fetchRemote: false })).url, '/workspace.html?view=deck');
  assert.equal((await getRoom('builder', { fetchRemote: false })).url, '/forge.html');
  assert.equal((await getRoom('comic builder', { fetchRemote: false })).url, '/story-studio.html');
  assert.equal((await getRoom('memories', { fetchRemote: false })).url, '/workspace.html?view=memory');
  assert.equal((await getRoom('approvals', { fetchRemote: false })).url, '/workspace.html?view=approvals');
  assert.equal((await getRoom('integrations', { fetchRemote: false })).url, '/workspace.html?view=skills');
  assert.equal((await getRoom('workspaces', { fetchRemote: false })).url, '/workspace.html?view=forge');
});

test('every built-in room has one direct isolated destination', async () => {
  const rooms = await listRooms({ fetchRemote: false });
  const destinations = Object.fromEntries(rooms.map(({ slug, url }) => [slug, url]));
  assert.deepEqual(destinations, {
    life: '/workspace.html?view=life',
    reminders: '/workspace.html?view=reminders',
    schedule: '/workspace.html?view=planner',
    'command-center': '/workspace.html?view=deck',
    'conference-room': '/workspace.html?view=agents',
    'room-builder': '/forge.html',
    'forge-field': '/forge-caller.html',
    'forge-ops': '/forge-dashboard.html',
    'story-studio': '/story-studio.html',
    'memory-archive': '/workspace.html?view=memory',
    'approval-queue': '/workspace.html?view=approvals',
    'connector-bay': '/workspace.html?view=skills',
    'tenant-hub': '/workspace.html?view=forge',
  });
  assert.equal(Object.values(destinations).filter((url) => url === '/forge.html').length, 1);
  assert.equal(Object.values(destinations).some((url) => url.startsWith('/nexus-space.html#')), false);
});

test('room lookup fails closed for an unknown room', async () => {
  assert.equal(await getRoom('made up room', { fetchRemote: false }), null);
});
