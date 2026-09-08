import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripLiveEditWidget } from '../api/room-chat.js';

test('legacy generated-page chat is removed so Room Builder has one conversation surface', () => {
  const legacy = `<!doctype html><html><body><main>Project</main>
<!-- NEXUS_LIVE_EDIT_WIDGET_START --><div>Old chat</div><!-- NEXUS_LIVE_EDIT_WIDGET_END -->
</body></html>`;
  const cleaned = stripLiveEditWidget(legacy);
  assert.match(cleaned, /<main>Project<\/main>/);
  assert.doesNotMatch(cleaned, /Old chat|NEXUS_LIVE_EDIT_WIDGET/);
});

test('Room Builder mounts one locked workspace with one movable chat dock', async () => {
  const source = await readFile(new URL('../public/room.html', import.meta.url), 'utf8');
  assert.equal((source.match(/class="chat-panel"/g) || []).length, 1);
  assert.match(source, /addPanel\(\{[^}]*locked: true/);
  assert.match(source, /chatToolbar\.addEventListener\('pointermove'/);
  assert.match(source, /nexus-room-chat-position-v2/);
  assert.doesNotMatch(source, /nexus-live-edit-widget|Live-edit widget bridge/i);
});
