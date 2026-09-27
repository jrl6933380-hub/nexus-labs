import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The customer-journey UI tests in this file covered public/room.html (the old
// Room Builder), which was retired and now only forwards to /forge.html. The
// server-side guarantee below still applies to every build, so it stays.
const apiSource = await readFile(new URL('../api/room-chat.js', import.meta.url), 'utf8');

test('generated projects stay free of Room Builder chrome', () => {
  assert.match(apiSource, /Don't add Room Builder controls/);
  assert.doesNotMatch(apiSource, /a real one is added automatically/);
});
