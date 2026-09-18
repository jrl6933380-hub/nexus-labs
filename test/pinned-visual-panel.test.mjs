import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSandboxedDocument, roomIdFromLocation } from '../public/pinned-visual-panel.js';

test('room paths and Nexus Space scenes resolve to stable room IDs', () => {
  assert.equal(roomIdFromLocation({ pathname: '/mission-control.html' }), 'command-center');
  assert.equal(roomIdFromLocation({ pathname: '/conference-room.html' }), 'conference-room');
  assert.equal(roomIdFromLocation({ pathname: '/nexus-space.html', hash: '#connectors' }), 'connector-bay');
  assert.equal(roomIdFromLocation({ pathname: '/nexus-space.html', hash: '#tenants' }), 'tenant-hub');
  assert.equal(roomIdFromLocation({ pathname: '/forge-admin.html' }), null);
});

test('rendered widgets receive an isolated no-network document policy', () => {
  const document = buildSandboxedDocument('<script>document.body.dataset.ok = "yes"</script>');
  assert.match(document, /default-src 'none'/u);
  assert.match(document, /connect-src 'none'/u);
  assert.match(document, /frame-src 'none'/u);
  assert.match(document, /form-action 'none'/u);
  assert.doesNotMatch(document, /https:/u);
  assert.match(document, /<script>document\.body\.dataset\.ok/u);
});
