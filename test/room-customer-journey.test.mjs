import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const roomSource = await readFile(new URL('../public/room.html', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../api/room-chat.js', import.meta.url), 'utf8');

test('first-time customers can choose a guided start or type directly', () => {
  for (const starter of ['business', 'landing', 'portfolio', 'app']) {
    assert.match(roomSource, new RegExp(`data-starter="${starter}"`));
  }
  assert.match(roomSource, /Describe the result you want\. Nex handles the build plan\./);
  assert.match(roomSource, /function showWelcomeGuide/);
});

test('Nex offers clear next steps after a successful saved version', () => {
  assert.match(roomSource, /function showNextSteps/);
  for (const action of ['Polish mobile', 'Refine design', 'Add a feature', 'Export help']) {
    assert.match(roomSource, new RegExp(action));
  }
  assert.match(roomSource, /First version complete and saved\./);
  assert.match(roomSource, /Update complete and saved\./);
});

test('generated projects stay free of Room Builder chrome', () => {
  assert.match(apiSource, /Don't add Room Builder controls/);
  assert.doesNotMatch(apiSource, /a real one is added automatically/);
});

test('the single dock is a conversational, project-aware Web Builder Nex', () => {
  assert.match(roomSource, />Forge AI</);
  assert.match(roomSource, /fetch\('\/api\/room-assistant'/);
  assert.match(roomSource, /fetch\('\/api\/room-conversation\?projectId='/);
  assert.match(roomSource, /executeWorkspaceCommand/);
  assert.match(roomSource, /Ask Nex or describe what to build/);
  assert.match(roomSource, /projectId: currentProjectId/);
});

test('customers can attach and remove compressed images before sending them to Nex', () => {
  assert.match(roomSource, /id="photo-input"[^>]+accept="image\/jpeg,image\/png,image\/webp"[^>]+multiple/);
  assert.match(roomSource, /id="photo-btn"[^>]+aria-label="Add photos for Nex"/);
  assert.match(roomSource, /id="attachment-tray"[^>]+aria-label="Attached images"/);
  assert.match(roomSource, /async function prepareAttachment/);
  assert.match(roomSource, /createImageBitmap/);
  assert.match(roomSource, /pendingAttachments\.splice/);
  assert.match(roomSource, /attachments: attachmentPayload\(selectedAttachments\)/);
  assert.match(apiSource, /embedRoomAttachments\(stripLiveEditWidget\(html\), attachments\)/);
});

test('Nexus Forge keeps customer builds automatic and customer-powered instead of surfacing tickets', async () => {
  const loginSource = await readFile(new URL('../public/room-login.html', import.meta.url), 'utf8');
  assert.match(loginSource, /Nexus Forge/);
  assert.match(loginSource, /AI Website &amp; App Builder/);
  // The "Invite-only early access" line was deliberately removed when guest
  // access and open signup shipped; asserting it here would pin the page to
  // a product state that no longer exists.
  assert.match(roomSource, /additional AI help behind the scenes/);
  assert.doesNotMatch(roomSource, /event\.action === 'team_escalation'/);
  assert.doesNotMatch(apiSource, /roomEscalator\.queue/);
  assert.match(apiSource, /hasOwnBrain\(brainUser\)/);
  assert.match(apiSource, /code: 'BRAIN_REQUIRED'/);
});
