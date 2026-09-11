import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canSendNexMessage } from '../public/nex-chat-bar.js';

const chatBar = await readFile(new URL('../public/nex-chat-bar.js', import.meta.url), 'utf8');

test('operator Nex dock accepts one validated picture with preview and removal', () => {
  assert.match(chatBar, /accept="image\/jpeg,image\/png,image\/webp"/u);
  assert.match(chatBar, /\['image\/jpeg', 'image\/png', 'image\/webp'\]\.includes\(file\.type\)/u);
  assert.match(chatBar, /file\.size > 12_000_000/u);
  assert.match(chatBar, /id="nexAttachmentPreview" hidden/u);
  assert.match(chatBar, /attachmentRemove\.addEventListener\('click', clearAttachment\)/u);
});

test('attached picture is compressed and takes precedence over a live Vision frame', () => {
  assert.match(chatBar, /Math\.min\(1, 1280 \/ image\.naturalWidth, 1280 \/ image\.naturalHeight\)/u);
  assert.match(chatBar, /canvas\.toDataURL\('image\/jpeg', 0\.8\)/u);
  assert.match(chatBar, /const visualForMessage = attachedVisual \|\| await captureVisualFrame\(\)/u);
  assert.match(chatBar, /visual: visualForMessage/u);
  assert.match(chatBar, /const text = typedText \|\| 'Look at this image\.'/u);
});

test('attachment clears only after Nex returns a successful response', () => {
  const clearIndex = chatBar.indexOf("clearAttachment();\n      addMessage(replyText, 'nex-response')");
  const catchIndex = chatBar.indexOf("} catch (err) {", clearIndex);
  assert.ok(clearIndex > -1);
  assert.ok(catchIndex > clearIndex);
});

test('vision mode still allows a send without typed text or an attachment', () => {
  assert.equal(canSendNexMessage({ typedText: '', attachedVisual: null, visionMode: 'viewport' }), true);
  assert.equal(canSendNexMessage({ typedText: '', attachedVisual: null, visionMode: 'display' }), true);
  assert.equal(canSendNexMessage({ typedText: '', attachedVisual: null, visionMode: null }), false);
});
