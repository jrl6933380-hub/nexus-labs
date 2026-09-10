import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLiveWorkspaceContext } from '../lib/nexBrain.js';

test('live workspace context includes the active view, rooms, and bounded board state', () => {
  const context = formatLiveWorkspaceContext({
    clientContext: { active_view: '/conference-room.html', screen:{story_project_id:'story-42'} },
    rooms: [{ name: 'Conference Room', url: '/conference-room.html' }],
    board: {
      agents: [{ id: 'nex', display_name: 'Nex', status: 'online' }],
      tasks: [
        { title: 'Completed task', status: 'complete' },
        { title: 'Open room navigation', status: 'building', owner: 'chatgpt' },
      ],
    },
  });
  assert.match(context, /current dashboard view: \/conference-room\.html/);
  assert.match(context, /Conference Room \(\/conference-room\.html\)/);
  assert.match(context, /Open room navigation \[building, chatgpt\]/);
  assert.match(context, /Active Story Studio project id: story-42/);
  assert.doesNotMatch(context, /Completed task/);
});

test('live workspace context rejects protocol-relative client views', () => {
  const context = formatLiveWorkspaceContext({
    clientContext: { active_view: '//not-a-safe-route' },
    board: {},
    rooms: [],
  });
  assert.match(context, /current dashboard view: not reported/);
  assert.doesNotMatch(context, /not-a-safe-route/);
});
