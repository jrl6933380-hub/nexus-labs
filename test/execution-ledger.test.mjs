import test from 'node:test';
import assert from 'node:assert/strict';
process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const { startExecution, finishExecution, checkpointExecution, getExecutionResume, listExecutionEvents } = await import('../lib/executionLedger.js');
const { default: boardHandler } = await import('../api/board.js');

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

test('a failed write that may have landed forces re-read before retry', async () => {
  const event = await finishExecution({
    run_id: 'run-timeout',
    agent: 'nex',
    tool: 'update_repo_file',
    status: 'timed_out',
    error_code: 'ETIMEDOUT',
    may_have_written: true,
    next_action: 'retry immediately',
  });
  assert.equal(event.type, 'tool_failed');
  assert.match(event.next_action, /Re-read the target/);
  const pointer = await getExecutionResume('run-timeout');
  assert.equal(pointer.state, 'blocked');
  assert.match(pointer.next_safe_action, /compare its current SHA\/state/);
});

test('rejects malformed lifecycle records instead of storing ambiguous events', async () => {
  await assert.rejects(
    startExecution({ agent: '', tool: 'read_repo_file', purpose: 'test' }),
    /Missing agent/,
  );
  await assert.rejects(
    finishExecution({ run_id: 'run-bad', agent: 'nex', tool: 'read_repo_file', status: 'maybe' }),
    /Invalid terminal status/,
  );
});

test('the consolidated Board endpoint exposes ledger start and resume actions', async () => {
  async function post(body) {
    let statusCode = 0;
    let payload;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        payload = value;
        return value;
      },
    };
    await boardHandler({ method: 'POST', url: '/api/board', body }, res);
    assert.equal(statusCode, 200);
    return payload;
  }

  await post({
    action: 'start_execution',
    run_id: 'run-board-api',
    agent: 'chatgpt',
    tool: 'read_repo_file',
    purpose: 'verify route wiring',
  });
  await post({
    action: 'checkpoint_execution',
    run_id: 'run-board-api',
    agent: 'chatgpt',
    next_safe_action: 'open the pull request',
    working_branch: 'test/execution-ledger',
  });
  const response = await post({ action: 'get_execution_resume', run_id: 'run-board-api' });
  assert.equal(response.pointer.next_safe_action, 'open the pull request');
});
