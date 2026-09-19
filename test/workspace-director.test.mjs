import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceDirector, interpretWorkspaceCommand } from '../public/workspace-director.js';

test('routine movement commands are handled without sending ambiguous work to the system', () => {
  assert.deepEqual(interpretWorkspaceCommand('Open Forge'), { handled: true, command: { type: 'navigate', view: 'forge' } });
  assert.deepEqual(interpretWorkspaceCommand('show deployments'), { handled: true, command: { type: 'focus', view: 'operations', section: 'Deployments' } });
  assert.deepEqual(interpretWorkspaceCommand('go back'), { handled: true, command: { type: 'back' } });
  assert.equal(interpretWorkspaceCommand('Show me Forge broken down into sections and suggest upgrades').handled, false);
});

test('the Director moves and focuses the workspace through shared controls', async () => {
  const calls = [];
  const workspace = {
    showView(view) { calls.push(['show', view]); this.view = view; },
    focusSection(section) { calls.push(['focus', section]); this.section = section; return true; },
    showLatestVisual() { return true; },
    back() { return false; },
    forward() { return false; },
    getState() { return { view: this.view || 'overview', section: this.section || null }; },
    labelForView(view) { return view === 'operations' ? 'Command Deck' : 'Nexus Forge'; },
    async getLiveState() { return { telemetry: { total_tasks: 7, completed_tasks: 4, active_agents: 2, needs_approval: 1 } }; },
  };
  const director = createWorkspaceDirector({ workspace });
  assert.deepEqual(await director.handle('show deployments'), { handled: true, reply: 'Deployments is in focus.' });
  assert.deepEqual(calls, [['show', 'operations'], ['focus', 'Deployments']]);
  assert.equal((await director.handle('status')).reply, 'System live: 3 open tasks, 2 active agents, and 1 approval waiting.');
});

test('saved layouts restore without an AI call', async () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const workspace = {
    view: 'story', section: 'Scene Composer',
    showView(view) { this.view = view; }, focusSection(section) { this.section = section; return true; },
    showLatestVisual() { return false; }, back() { return false; }, forward() { return false; },
    getState() { return { view: this.view, section: this.section }; },
    labelForView: (view) => view === 'story' ? 'Story Studio' : 'Thoughtspace',
    getLiveState: async () => ({ telemetry: {} }),
  };
  const director = createWorkspaceDirector({ workspace, storage });
  await director.handle('save this layout');
  workspace.view = 'overview'; workspace.section = null;
  assert.equal((await director.handle('restore my layout')).reply, 'Story Studio restored.');
  assert.deepEqual(workspace.getState(), { view: 'story', section: 'Scene Composer' });
});
