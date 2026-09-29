import test from 'node:test';
import assert from 'node:assert/strict';
import { fromPodChatResponse, toPodChatRequest } from '../lib/podMessageAdapter.js';

test('Nex tool definitions and tool results round-trip through the pod adapter', () => {
  const request = toPodChatRequest({
    system: [{ type: 'text', text: 'You are Nex.' }],
    tools: [{ name: 'read_board', description: 'Read it', input_schema: { type: 'object', properties: {} } }],
    messages: [
      { role: 'user', content: 'Check the board' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'read_board', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'clear' }] },
    ],
  });

  assert.equal(request.messages[0].role, 'system');
  assert.equal(request.tools[0].function.name, 'read_board');
  assert.equal(request.messages[2].tool_calls[0].function.name, 'read_board');
  assert.deepEqual(request.messages[3], { role: 'tool', tool_call_id: 'tool-1', content: 'clear' });
  assert.equal(request.tool_choice, 'auto');
});

test('pod tool calls become the Anthropic-shaped blocks Nex already executes', () => {
  const result = fromPodChatResponse({
    id: 'one', model: 'nex-base', usage: { prompt_tokens: 10, completion_tokens: 4 },
    choices: [{ finish_reason: 'tool_calls', message: {
      content: null,
      tool_calls: [{ id: 'call-7', function: { name: 'read_board', arguments: '{"limit":5}' } }],
    } }],
  });
  assert.equal(result.stop_reason, 'tool_use');
  assert.deepEqual(result.content[0], { type: 'tool_use', id: 'call-7', name: 'read_board', input: { limit: 5 } });
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 4 });
});
