import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PHASES,
  PacedBuffer,
  BuildPhase,
  statusFor,
  createLiveCodeRenderer,
} from '../public/liveCodeStream.js';

// A controllable clock, so pacing behaviour is asserted deterministically
// instead of with sleeps that make CI flaky on a slow runner.
function fakeTimer() {
  let nextId = 1;
  const timers = new Map();
  return {
    setIntervalFn(fn) {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearIntervalFn(id) {
      timers.delete(id);
    },
    tick(times = 1) {
      for (let i = 0; i < times; i++) {
        for (const fn of [...timers.values()]) fn();
      }
    },
    get active() {
      return timers.size;
    },
  };
}

function bufferWith(opts = {}) {
  const clock = fakeTimer();
  const out = [];
  const buffer = new PacedBuffer((t) => out.push(t), {
    charsPerTick: 3,
    catchUpAbove: 1000,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    ...opts,
  });
  return { clock, out, buffer, text: () => out.join('') };
}

test('PacedBuffer releases text gradually rather than all at once', () => {
  const { clock, buffer, text, out } = bufferWith();
  buffer.push('abcdefghi');

  clock.tick();
  assert.equal(out.length, 1, 'one tick releases one chunk');
  assert.ok(text().length < 9, 'not everything released on the first tick');

  clock.tick(5);
  assert.equal(text(), 'abcdefghi');
});

test('PacedBuffer preserves content exactly across chunk boundaries', () => {
  const { clock, buffer, text } = bufferWith({ charsPerTick: 2 });
  const source = '<!doctype html>\n<html>\n<body>hello</body>\n</html>';
  // Arrive in awkward pieces, the way real provider deltas do.
  for (const piece of ['<!doctype ', 'html>\n<html>\n<bo', 'dy>hello</body>\n</h', 'tml>']) {
    buffer.push(piece);
  }
  clock.tick(200);
  assert.equal(text(), source, 'no character is dropped, duplicated, or reordered');
});

test('PacedBuffer accelerates instead of falling far behind', () => {
  const { clock, buffer } = bufferWith({ charsPerTick: 1, catchUpAbove: 100 });
  buffer.push('x'.repeat(6000));
  const before = buffer.pending;
  clock.tick();
  const released = before - buffer.pending;
  assert.ok(released > 1, 'catch-up releases more than the base rate when far behind');
});

test('PacedBuffer reports a stall instead of inventing progress', () => {
  const events = [];
  const { clock, buffer } = bufferWith({
    onStall: () => events.push('stall'),
    onResume: () => events.push('resume'),
  });

  buffer.push('abc');
  clock.tick(5);
  assert.deepEqual(events, ['stall'], 'empty queue mid-build reports a stall');

  buffer.push('def');
  assert.deepEqual(events, ['stall', 'resume']);
});

test('PacedBuffer drains fully after finish before reporting done', () => {
  let drained = false;
  const { clock, buffer, text } = bufferWith({ onDrained: () => { drained = true; } });

  buffer.push('abcdefghij');
  buffer.finish();
  assert.equal(drained, false, 'finish alone does not mean the viewer has seen it');

  clock.tick(20);
  assert.equal(text(), 'abcdefghij');
  assert.equal(drained, true);
});

test('PacedBuffer finish on an empty queue completes immediately', () => {
  let drained = false;
  const { buffer } = bufferWith({ onDrained: () => { drained = true; } });
  buffer.finish();
  assert.equal(drained, true);
});

test('PacedBuffer flush reveals the remainder and still reports done', () => {
  let drained = false;
  const { buffer, text } = bufferWith({ onDrained: () => { drained = true; } });
  buffer.push('abcdefghij');
  buffer.finish();
  buffer.flush();
  assert.equal(text(), 'abcdefghij');
  assert.equal(drained, true);
});

test('PacedBuffer stop abandons without emitting the remainder', () => {
  const { clock, buffer, text } = bufferWith();
  buffer.push('abcdefghij');
  buffer.stop();
  clock.tick(20);
  assert.equal(text(), '', 'nothing renders after an abandoned build');
  assert.equal(clock.active, 0, 'no timer is left running');
});

test('PacedBuffer requires a render callback', () => {
  assert.throws(() => new PacedBuffer(), TypeError);
});

test('BuildPhase only reports real transitions', () => {
  const seen = [];
  const phase = new BuildPhase((p) => seen.push(p));
  phase.set(PHASES.THINKING);
  phase.set(PHASES.THINKING);
  phase.set(PHASES.STREAMING);
  assert.deepEqual(seen, [PHASES.THINKING, PHASES.STREAMING]);
});

test('statusFor never describes a phase the build is not in', () => {
  assert.equal(statusFor(PHASES.IDLE), '');
  assert.notEqual(statusFor(PHASES.STALLED), statusFor(PHASES.STREAMING));
  assert.equal(statusFor(PHASES.FAILED, 'build too large'), 'build too large');
});

test('renderer streams code_delta events and finishes on html', () => {
  const clock = fakeTimer();
  const chunks = [];
  const phases = [];
  let resets = 0;

  const renderer = createLiveCodeRenderer(
    {
      onCode: (t) => chunks.push(t),
      onPhase: (p) => phases.push(p),
      onReset: () => { resets++; },
    },
    {
      charsPerTick: 4,
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    }
  );

  renderer.handle({ action: 'progress', message: 'Creating…' });
  assert.equal(renderer.phase, PHASES.THINKING);

  renderer.handle({ action: 'code_delta', text: '<!doctype html>' });
  assert.equal(resets, 1, 'canvas is cleared once, when real output starts');
  assert.equal(renderer.phase, PHASES.STREAMING);

  renderer.handle({ action: 'code_delta', text: '<html></html>' });
  renderer.handle({ action: 'html', html: '<!doctype html><html></html>' });
  assert.equal(renderer.phase, PHASES.FINISHING, 'arrival is not the same as being seen');

  clock.tick(100);
  assert.equal(chunks.join(''), '<!doctype html><html></html>');
  assert.equal(renderer.phase, PHASES.DONE);
  assert.ok(phases.includes(PHASES.FINISHING));
});

test('renderer completes cleanly for a client that gets no deltas', () => {
  const renderer = createLiveCodeRenderer({ onCode: () => {} });
  renderer.handle({ action: 'progress', message: 'Creating…' });
  renderer.handle({ action: 'html', html: '<html></html>' });
  assert.equal(renderer.phase, PHASES.DONE, 'final html alone still ends the build');
});

test('renderer stops rendering on error', () => {
  const clock = fakeTimer();
  const chunks = [];
  const renderer = createLiveCodeRenderer(
    { onCode: (t) => chunks.push(t) },
    { charsPerTick: 1, setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn }
  );

  renderer.handle({ action: 'code_delta', text: 'partial output' });
  renderer.handle({ action: 'error', message: 'builder failed' });
  const atFailure = chunks.join('');

  clock.tick(50);
  assert.equal(chunks.join(''), atFailure, 'a failed build stops mid-render');
  assert.equal(renderer.phase, PHASES.FAILED);
});

test('renderer ignores malformed events', () => {
  const renderer = createLiveCodeRenderer({ onCode: () => {} });
  renderer.handle(null);
  renderer.handle('nope');
  renderer.handle({});
  renderer.handle({ action: 'unknown_future_action' });
  assert.equal(renderer.phase, PHASES.IDLE);
});

test('renderer requires a render callback', () => {
  assert.throws(() => createLiveCodeRenderer({}), TypeError);
});
