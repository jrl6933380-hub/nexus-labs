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

// The "one locked workspace with one movable dock" test covered public/room.html,
// which was retired and now only forwards to /forge.html.
