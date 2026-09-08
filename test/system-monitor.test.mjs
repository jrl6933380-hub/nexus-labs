import test from 'node:test';
import assert from 'node:assert/strict';

const { createSystemMonitor } = await import('../lib/systemMonitor.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('maybeCheck triggers a sweep and returns null before it resolves', () => {
  let invocations = 0;
  const monitor = createSystemMonitor({
    sweep: () => {
      invocations += 1;
      return new Promise((resolve) => setTimeout(() => resolve({ has_findings: false }), 10));
    },
    intervalMs: 1000,
  });
  const result = monitor.maybeCheck();
  assert.equal(result, null);
  assert.equal(invocations, 1);
});

test('maybeCheck does not re-trigger while a sweep is in flight or within the throttle window', async () => {
  let invocations = 0;
  const monitor = createSystemMonitor({
    sweep: () => {
      invocations += 1;
      return new Promise((resolve) => setTimeout(() => resolve({ has_findings: false }), 30));
    },
    intervalMs: 1000,
  });
  monitor.maybeCheck();
  monitor.maybeCheck();
  monitor.maybeCheck();
  assert.equal(invocations, 1);
  await wait(50);
  monitor.maybeCheck();
  assert.equal(invocations, 1);
});

test('getLast reflects the most recent completed sweep', async () => {
  let invocations = 0;
  const monitor = createSystemMonitor({
    sweep: () => { invocations += 1; return Promise.resolve({ has_findings: true, n: invocations }); },
    intervalMs: 20,
  });
  monitor.maybeCheck();
  await wait(5);
  assert.deepEqual(monitor.getLast(), { has_findings: true, n: 1 });
});

test('a new check fires again once the throttle window has elapsed', async () => {
  let invocations = 0;
  const monitor = createSystemMonitor({
    sweep: () => { invocations += 1; return Promise.resolve({ has_findings: false }); },
    intervalMs: 20,
  });
  monitor.maybeCheck();
  await wait(5);
  await wait(30);
  monitor.maybeCheck();
  await wait(5);
  assert.equal(invocations, 2);
});

test('a failed sweep does not throw and preserves the last known status', async () => {
  let attempt = 0;
  const monitor = createSystemMonitor({
    sweep: () => {
      attempt += 1;
      if (attempt === 1) return Promise.resolve({ has_findings: false, ok: true });
      return Promise.reject(new Error('github hiccup'));
    },
    intervalMs: 10,
  });
  monitor.maybeCheck();
  await wait(5);
  assert.deepEqual(monitor.getLast(), { has_findings: false, ok: true });

  await wait(15);
  assert.doesNotThrow(() => monitor.maybeCheck());
  await wait(5);
  assert.deepEqual(monitor.getLast(), { has_findings: false, ok: true });
});

test('createSystemMonitor throws without a sweep function', () => {
  assert.throws(() => createSystemMonitor({}), /sweep is required/);
});
