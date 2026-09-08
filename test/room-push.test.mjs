import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNexusHomePush } from '../api/room-push.js';

const imported = `<!doctype html><html><body>
<!-- NEXUS_SAFETY_SHIM_START --><div>SAFE COPY</div><!-- NEXUS_SAFETY_SHIM_END -->
<main>Real Nexus design</main>
<!-- NEXUS_LIVE_EDIT_WIDGET_START --><div>Builder controls</div><!-- NEXUS_LIVE_EDIT_WIDGET_END -->
</body></html>`;

test('homepage push accepts an imported Nexus copy and removes builder-only controls', () => {
  const cleaned = prepareNexusHomePush(imported);
  assert.match(cleaned, /Real Nexus design/);
  assert.doesNotMatch(cleaned, /SAFE COPY|NEXUS_SAFETY_SHIM/);
  assert.doesNotMatch(cleaned, /Builder controls|NEXUS_LIVE_EDIT_WIDGET/);
});

test('homepage push rejects an ordinary generated customer project', () => {
  assert.throws(
    () => prepareNexusHomePush('<!doctype html><html><body>Customer site</body></html>'),
    /Import the Nexus homepage/,
  );
});
