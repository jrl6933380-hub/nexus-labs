import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/conference-room.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/conference-workshop.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/conference-workshop.css', import.meta.url), 'utf8');

test('conference room is an operational workshop with focus and project benches', () => {
  assert.match(html, /JUSTIN \+ NEX WORKSHOP/);
  assert.match(html, /id="focusTitle"/);
  assert.match(html, /id="benches"/);
  assert.match(html, /id="agentRoster"/);
  assert.match(html, /Create a real Board task/);
});

test('every project bench opens a live maintenance workbench', () => {
  assert.match(html, /id="maintenanceDialog"/);
  assert.match(html, /Actual checklist/);
  assert.match(html, /Just Nex/);
  assert.match(html, /Bring in build team/);
  assert.match(js, /data-action="maintain"/);
  assert.match(js, /openMaintenance\(id\)/);
});

test('maintenance items and notes use real shared Board state', () => {
  assert.match(js, /\[maintenance:\$\{root\.id\}\]/);
  assert.match(js, /action:'create_task'/);
  assert.match(js, /action:'post_message'/);
  assert.match(js, /startMaintenanceBtn/);
  assert.doesNotMatch(js, /fakeChecklist|demoMaintenance/i);
});

test('workshop mutations use real Board and dispatcher endpoints', () => {
  assert.match(js, /post\('\/api\/board'.*action:'create_task'/s);
  assert.match(js, /post\('\/api\/board'.*action:'claim_task'/s);
  assert.match(js, /post\('\/api\/dispatch'.*action:'dispatch'/s);
  assert.match(js, /preferred_agent/);
  assert.doesNotMatch(js, /mock|fakeTask|demoTasks/i);
});

test('workshop exposes explicit approval and merge safety boundaries', () => {
  assert.match(html, /Medium\/high-risk actions stop for explicit approval/);
  assert.match(html, /Merges, live changes, and destructive actions remain gated/);
  assert.match(js, /pending_approval/);
  assert.match(js, /waiting_for_justin/);
});

test('workshop is responsive and keeps task controls usable on phone screens', () => {
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /\.benches\{grid-template-columns:1fr/);
  assert.match(css, /\.task-controls\{display:grid/);
  assert.match(css, /@media\(max-width:700px\).*\.maintenance-grid\{grid-template-columns:1fr/s);
});

test('untrusted Board fields are escaped before HTML rendering', () => {
  assert.match(js, /safeText\(task\.title\)/);
  assert.match(js, /safeText\(task\.last_note\|\|task\.blocked_reason/);
  assert.match(js, /safeText\(agent\.display_name\|\|visual\.label\)/);
});
