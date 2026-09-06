import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoom, listRooms } from '../lib/rooms.js';

test('Conference Room is always available through the safe fallback', async () => {
  const rooms = await listRooms({ fetchRemote: false });
  assert.deepEqual(rooms, [{
    slug: 'conference-room',
    name: 'Conference Room',
    description: 'Live round-table view of Nex and the available agents.',
    url: '/conference-room.html',
  }]);
});

test('room lookup accepts the friendly name and slug', async () => {
  const byName = await getRoom('conference room', { fetchRemote: false });
  const bySlug = await getRoom('conference-room', { fetchRemote: false });
  assert.equal(byName.url, '/conference-room.html');
  assert.deepEqual(bySlug, byName);
});

test('room lookup fails closed for an unknown room', async () => {
  assert.equal(await getRoom('made up room', { fetchRemote: false }), null);
});
