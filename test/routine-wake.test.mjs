import test from 'node:test';
import assert from 'node:assert/strict';

const { fireClaudeRoutine, createMemoryWakeLedger } = await import('../lib/routineWake.js');

const FAKE_TOKEN = 'test-trigger-token-abc123';
const VALID_URL = 'https://example.invalid/fire';

function envelope(overrides = {}) {
  return {
    task_id: 'task-1',
    trace_id: 'trace-1',
    idempotency_key: 'idem-1',
    ...overrides,
  };
}

test('fires once and returns a session record on success', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url, VALID_URL);
    assert.equal(options.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
    return {
      ok: true,
      async json() { return { claude_code_session_id: 'sess-1', claude_code_session_url: 'https://claude.ai/code/sess-1' }; },
    };
  };

  const result = await fireClaudeRoutine(envelope(), {
    ledger: createMemoryWakeLedger(),
    fetchImpl,
    fireUrl: VALID_URL,
    triggerToken: FAKE_TOKEN,
  });

  assert.equal(calls, 1);
  assert.equal(result.session_id, 'sess-1');
  assert.equal(result.session_url, 'https://claude.ai/code/sess-1');
  assert.equal(result.replayed, false);
});

test('a replayed idempotency_key returns the prior session without firing again', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, async json() { return { claude_code_session_id: 'sess-1' }; } };
  };
  const ledger = createMemoryWakeLedger();
  const env = envelope();

  const first = await fireClaudeRoutine(env, { ledger, fetchImpl, fireUrl: VALID_URL, triggerToken: FAKE_TOKEN });
  const second = await fireClaudeRoutine(env, { ledger, fetchImpl, fireUrl: VALID_URL, triggerToken: FAKE_TOKEN });

  assert.equal(calls, 1, 'fetch should only be called once — the second call is a replay');
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.session_id, 'sess-1');
});

test('two different idempotency_keys fire independently', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, async json() { return { claude_code_session_id: `sess-${calls}` }; } };
  };
  const ledger = createMemoryWakeLedger();

  const a = await fireClaudeRoutine(envelope({ idempotency_key: 'idem-a' }), { ledger, fetchImpl, fireUrl: VALID_URL, triggerToken: FAKE_TOKEN });
  const b = await fireClaudeRoutine(envelope({ idempotency_key: 'idem-b' }), { ledger, fetchImpl, fireUrl: VALID_URL, triggerToken: FAKE_TOKEN });

  assert.equal(calls, 2);
  assert.notEqual(a.session_id, b.session_id);
});

// Regression test for the actual production incident: a misconfigured
// CLAUDE_ROUTINE_FIRE_URL (holding the token instead of a URL) must fail
// with a clean error that never echoes the invalid value back — that's
// exactly how the token leaked onto the board previously.
test('a malformed fireUrl fails safely without echoing the invalid value', async () => {
  const secretLookingValue = 'sk-this-looks-like-a-token-not-a-url-zzz999';
  await assert.rejects(
    () => fireClaudeRoutine(envelope(), {
      ledger: createMemoryWakeLedger(),
      fetchImpl: async () => { throw new Error('fetch should never be called with an invalid URL'); },
      fireUrl: secretLookingValue,
      triggerToken: FAKE_TOKEN,
    }),
    (err) => {
      assert.match(err.message, /not a valid URL/);
      assert.ok(!err.message.includes(secretLookingValue), 'error must not echo the invalid fireUrl value');
      return true;
    },
  );
});

test('rejects a non-http(s) fireUrl', async () => {
  await assert.rejects(
    () => fireClaudeRoutine(envelope(), {
      ledger: createMemoryWakeLedger(),
      fetchImpl: async () => { throw new Error('should not be called'); },
      fireUrl: 'ftp://example.invalid/fire',
      triggerToken: FAKE_TOKEN,
    }),
    /must be an http\(s\) URL/,
  );
});

// Defense-in-depth layer: even a genuine network failure must not leak
// the trigger token or fire URL into the thrown error message.
test('redacts the trigger token and fire URL out of a network failure message', async () => {
  const fetchImpl = async () => {
    throw new Error(`connection failed while calling ${VALID_URL} with token ${FAKE_TOKEN}`);
  };

  await assert.rejects(
    () => fireClaudeRoutine(envelope(), {
      ledger: createMemoryWakeLedger(),
      fetchImpl,
      fireUrl: VALID_URL,
      triggerToken: FAKE_TOKEN,
    }),
    (err) => {
      assert.ok(!err.message.includes(FAKE_TOKEN), 'error must not contain the raw trigger token');
      assert.ok(!err.message.includes(VALID_URL), 'error must not contain the raw fire URL');
      assert.match(err.message, /\[redacted\]/);
      return true;
    },
  );
});

test('redacts the trigger token out of a non-ok HTTP response reason', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    async json() { return { error: { message: `unauthorized token ${FAKE_TOKEN}` } }; },
  });

  await assert.rejects(
    () => fireClaudeRoutine(envelope(), {
      ledger: createMemoryWakeLedger(),
      fetchImpl,
      fireUrl: VALID_URL,
      triggerToken: FAKE_TOKEN,
    }),
    (err) => {
      assert.ok(!err.message.includes(FAKE_TOKEN));
      assert.match(err.message, /\[redacted\]/);
      return true;
    },
  );
});

test('falls back to a generic HTTP status when the error response has no message', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, async json() { return {}; } });
  await assert.rejects(
    () => fireClaudeRoutine(envelope(), {
      ledger: createMemoryWakeLedger(),
      fetchImpl,
      fireUrl: VALID_URL,
      triggerToken: FAKE_TOKEN,
    }),
    /HTTP 500/,
  );
});

test('throws if the response is missing claude_code_session_id', async () => {
  const fetchImpl = async () => ({ ok: true, async json() { return { some_other_field: true }; } });
  await assert.rejects(
    () => fireClaudeRoutine(envelope(), {
      ledger: createMemoryWakeLedger(),
      fetchImpl,
      fireUrl: VALID_URL,
      triggerToken: FAKE_TOKEN,
    }),
    /missing claude_code_session_id/,
  );
});

test('handles a non-JSON response body without crashing', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, async json() { throw new Error('not json'); } });
  await assert.rejects(
    () => fireClaudeRoutine(envelope(), {
      ledger: createMemoryWakeLedger(),
      fetchImpl,
      fireUrl: VALID_URL,
      triggerToken: FAKE_TOKEN,
    }),
    /HTTP 502/,
  );
});

test('createMemoryWakeLedger get/set round-trips a value', async () => {
  const ledger = createMemoryWakeLedger();
  assert.equal(await ledger.get('missing'), null);
  await ledger.set('key-1', { session_id: 'abc' });
  assert.deepEqual(await ledger.get('key-1'), { session_id: 'abc' });
});

test('missing required env vars throw a clear error instead of silently proceeding', async () => {
  const originalFireUrl = process.env.CLAUDE_ROUTINE_FIRE_URL;
  const originalToken = process.env.CLAUDE_ROUTINE_TRIGGER_TOKEN;
  delete process.env.CLAUDE_ROUTINE_FIRE_URL;
  delete process.env.CLAUDE_ROUTINE_TRIGGER_TOKEN;
  try {
    await assert.rejects(
      () => fireClaudeRoutine(envelope(), { ledger: createMemoryWakeLedger() }),
      /Missing required env var: CLAUDE_ROUTINE_FIRE_URL/,
    );
  } finally {
    if (originalFireUrl !== undefined) process.env.CLAUDE_ROUTINE_FIRE_URL = originalFireUrl;
    if (originalToken !== undefined) process.env.CLAUDE_ROUTINE_TRIGGER_TOKEN = originalToken;
  }
});
