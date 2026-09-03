import test from 'node:test';
import assert from 'node:assert/strict';
import { startExecution, finishExecution, checkpointExecution, getExecutionResume, listExecutionEvents } from '../lib/executionLedger.js';

const calls = [];
global.fetch = async (_url, options) => {
  const command = JSON.parse(options.body);
  calls.push(command);
  let result = null;
  if (command[0] === 'HGET') result = calls.resume || null;
  if (command[0] === 'LRANGE') result = calls.events || [];
  if (command[0] === 'HSET') calls.resume = command[3];
  if (command[0] === 'LPUSH') {
    calls.events ||= [];
    calls.events.unshift(command[2]);
  }
  return { ok: true, async json() { return { result }; } };
};

test('records a safe lifecycle and resume pointer', async () => {
  const started = await startExecution({ agent: 'chatgpt', tool: 'create_file', purpose: 'write test artifact', target: 'repo:file', run_id: 'run-test' });
  assert.equal(started.run_id, 'run-test');
  await finishExecution({ run_id: 'run-test', agent: 'chatgpt', tool: 'create_file', result_summary: 'commit complete', artifact_refs: ['commit:abc'], next_action: 'run tests' });
  const pointer = await checkpointExecution({ run_id: 'run-test', agent: 'chatgpt', state: 'paused', last_completed_tool: 'create_file', last_result: 'commit complete', next_safe_action: 'run tests', working_branch: 'test/execution-ledger', files_touched: ['EXECUTION_LEDGER.md'] });
  assert.equal(pointer.next_safe_action, 'run tests');
  assert.equal((await getExecutionResume('run-test')).working_branch, 'test/execution-ledger');
  assert.equal((await listExecutionEvents('run-test')).length, 3);
});

test('redacts secrets from stored event data', async () => {
  await finishExecution({ run_id: 'run-secret', agent: 'chatgpt', tool: 'read_file', result_summary: 'token=ghp_NOT_REAL', next_action: 'stop' });
  assert.equal(calls.events[0].includes('ghp_NOT_REAL'), false);
});
