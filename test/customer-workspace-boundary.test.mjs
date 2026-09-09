import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const login = await readFile(new URL('../public/room-login.html',import.meta.url),'utf8');
const builder = await readFile(new URL('../public/room.html',import.meta.url),'utf8');
const story = await readFile(new URL('../public/story-studio.html',import.meta.url),'utf8');

test('customer login has no operator shell or dashboard navigation', () => {
  assert.doesNotMatch(login,/nexus-shell\.js/);
  assert.doesNotMatch(login,/nexus-stark\.css/);
  assert.doesNotMatch(login,/Return to Dashboard/i);
  assert.doesNotMatch(login,/Nexus Labs|Mission Control|operator-chip/);
});

test('post-login redirects are restricted to customer workspaces', () => {
  assert.match(login,/new Set\(\['\/room\.html', '\/story-studio\.html'\]\)/);
  assert.match(login,/customerWorkspaces\.has\(requested\)/);
  assert.doesNotMatch(login,/requested\.startsWith\('\/'\)/);
});

test('customer workspaces do not expose links back into the operator space', () => {
  assert.doesNotMatch(builder,/returnLink|← Dashboard|href\s*=\s*['"]\/['"]/);
  assert.doesNotMatch(story,/Venture Factory|href="\/nexus-space\.html/);
});
