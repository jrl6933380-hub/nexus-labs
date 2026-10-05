// public/liveCodeStream.js
//
// Paces build output onto the canvas so it reads like code being written
// rather than a wall of HTML appearing at once.
//
// The content is always the real model output. Only its *pace* is ours:
// deltas arrive bursty (a provider can emit several hundred characters in
// one chunk and then nothing for a second), and rendering them the instant
// they land looks like stuttering, not typing. A queue between arrival and
// render fixes that without inventing any content.
//
// Deliberately NOT a replay-after-completion animation. Draining starts on
// the first delta, so what is on screen is genuinely being generated a
// fraction of a second earlier — if generation stalls, the cursor stalls
// too, because there is nothing buffered to show. Faking motion during a
// real stall is how a progress indicator stops meaning anything.
//
// ESM, no DOM dependency: the caller supplies render callbacks, so this is
// unit-testable in Node and reusable by any surface (Room Builder canvas,
// Thoughtspace) rather than welded to one page's element IDs.

/** Phases a build passes through. Exported for callers keying UI off them. */
export const PHASES = Object.freeze({
  IDLE: 'idle',            // nothing started
  THINKING: 'thinking',    // request open, no output yet
  STREAMING: 'streaming',  // characters actively rendering
  STALLED: 'stalled',      // buffer dry mid-build; provider hasn't sent more
  FINISHING: 'finishing',  // upstream done, buffer still draining
  DONE: 'done',            // drained
  FAILED: 'failed',
});

/**
 * Releases queued text at a steady rate.
 *
 * Arrival rate and display rate are fully decoupled. If the queue grows far
 * beyond what a viewer could read, the drain accelerates instead of falling
 * minutes behind — being slightly behind live is the point, being a
 * different build ago is not.
 */
export class PacedBuffer {
  /**
   * @param {(text: string) => void} onText   receives each released chunk
   * @param {object} [opts]
   * @param {number} [opts.charsPerTick=3]
   * @param {number} [opts.tickMs=16]         ~60fps
   * @param {number} [opts.catchUpAbove=2000] queue length that triggers catch-up
   * @param {() => void} [opts.onStall]       buffer emptied while still receiving
   * @param {() => void} [opts.onResume]      text arrived after a stall
   * @param {() => void} [opts.onDrained]     buffer emptied after finish()
   * @param {(fn: Function, ms: number) => any} [opts.setIntervalFn]  injectable for tests
   * @param {(id: any) => void} [opts.clearIntervalFn]
   */
  constructor(onText, opts = {}) {
    if (typeof onText !== 'function') {
      throw new TypeError('PacedBuffer requires an onText callback');
    }
    this.onText = onText;
    this.charsPerTick = Math.max(1, opts.charsPerTick ?? 3);
    this.tickMs = Math.max(1, opts.tickMs ?? 16);
    this.catchUpAbove = opts.catchUpAbove ?? 2000;
    this.onStall = opts.onStall ?? (() => {});
    this.onResume = opts.onResume ?? (() => {});
    this.onDrained = opts.onDrained ?? (() => {});
    this._setInterval = opts.setIntervalFn ?? setInterval;
    this._clearInterval = opts.clearIntervalFn ?? clearInterval;

    this.queue = '';
    this.timer = null;
    this.finished = false;
    this.stalled = false;
    this.released = 0;
  }

  /** Queue newly-arrived text. */
  push(text) {
    if (!text) return;
    if (this.finished) return; // late delta after finish(); ignore rather than reopen
    if (this.stalled) {
      this.stalled = false;
      this.onResume();
    }
    this.queue += text;
    this._start();
  }

  /** Upstream is complete. Keeps draining what's queued, then onDrained. */
  finish() {
    if (this.finished) return;
    this.finished = true;
    if (!this.queue.length) {
      this._stop();
      this.onDrained();
      return;
    }
    this._start();
  }

  /** Release everything now — backs a "skip animation" control. */
  flush() {
    if (this.queue.length) {
      const rest = this.queue;
      this.queue = '';
      this.released += rest.length;
      this.onText(rest);
    }
    this._stop();
    if (this.finished) this.onDrained();
  }

  /** Abandon without draining (navigation away, build error). */
  stop() {
    this._stop();
    this.queue = '';
  }

  get pending() {
    return this.queue.length;
  }

  _start() {
    if (this.timer !== null) return;
    this.timer = this._setInterval(() => this._tick(), this.tickMs);
  }

  _stop() {
    if (this.timer !== null) this._clearInterval(this.timer);
    this.timer = null;
  }

  _tick() {
    if (!this.queue.length) {
      this._stop();
      if (this.finished) {
        this.onDrained();
      } else if (!this.stalled) {
        this.stalled = true;
        this.onStall();
      }
      return;
    }

    let take = this.charsPerTick;

    // Far behind: accelerate rather than accumulate an ever-growing lag.
    if (this.queue.length > this.catchUpAbove) {
      take = Math.max(take, Math.ceil(this.queue.length / 60));
    }

    // Prefer to land on a line boundary when one is close — partial lines
    // reflowing mid-render is the main thing that reads as janky.
    const nl = this.queue.indexOf('\n', take);
    if (nl !== -1 && nl - take < 16) take = nl + 1;

    const chunk = this.queue.slice(0, take);
    this.queue = this.queue.slice(take);
    this.released += chunk.length;
    this.onText(chunk);
  }
}

/**
 * Phase tracker. Status text is always tied to something that is actually
 * happening — no decorative strings for states the build is not in.
 */
export class BuildPhase {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.phase = PHASES.IDLE;
    this.detail = null;
  }

  set(phase, detail = null) {
    if (this.phase === phase && this.detail === detail) return;
    this.phase = phase;
    this.detail = detail;
    this.onChange(phase, { detail, status: statusFor(phase, detail) });
  }
}

export function statusFor(phase, detail) {
  switch (phase) {
    case PHASES.THINKING:   return detail || 'Working out the approach…';
    case PHASES.STREAMING:  return detail || 'Writing it out…';
    // Honest about a real pause instead of pretending progress continues.
    case PHASES.STALLED:    return detail || 'Still generating…';
    case PHASES.FINISHING:  return detail || 'Finishing up…';
    case PHASES.DONE:       return detail || 'Done';
    case PHASES.FAILED:     return detail || 'That attempt did not finish';
    default:                return detail || '';
  }
}

/**
 * Wires the room-chat SSE event stream to a paced renderer.
 *
 * Consumes the additive `code_delta` action. A client that ignores this and
 * waits for the final `html` action still works exactly as before — that is
 * why `code_delta` was added alongside the existing actions rather than
 * replacing them.
 *
 * @param {object} handlers
 * @param {(text: string) => void} handlers.onCode   append rendered code
 * @param {(phase: string, meta: object) => void} [handlers.onPhase]
 * @param {() => void} [handlers.onReset]            clear before a new build
 * @param {object} [opts] forwarded to PacedBuffer
 */
export function createLiveCodeRenderer({ onCode, onPhase, onReset } = {}, opts = {}) {
  if (typeof onCode !== 'function') {
    throw new TypeError('createLiveCodeRenderer requires an onCode callback');
  }
  const phase = new BuildPhase(onPhase);
  let buffer = null;
  let started = false;

  const openBuffer = () => {
    buffer = new PacedBuffer(onCode, {
      ...opts,
      onStall: () => phase.set(PHASES.STALLED),
      onResume: () => phase.set(PHASES.STREAMING),
      onDrained: () => phase.set(PHASES.DONE),
    });
  };

  return {
    /** Feed one parsed SSE payload from /api/room-chat. */
    handle(event) {
      if (!event || typeof event !== 'object') return;
      switch (event.action) {
        case 'progress':
          if (!started) phase.set(PHASES.THINKING, event.message);
          break;

        case 'code_delta':
          if (!started) {
            started = true;
            onReset?.();
            openBuffer();
            phase.set(PHASES.STREAMING);
          }
          buffer.push(event.text || '');
          break;

        case 'html':
          // Upstream finished. The buffer keeps draining; DONE fires when
          // the viewer has actually seen all of it, not when it arrived.
          if (buffer) {
            phase.set(PHASES.FINISHING);
            buffer.finish();
          } else {
            phase.set(PHASES.DONE);
          }
          break;

        case 'error':
          buffer?.stop();
          phase.set(PHASES.FAILED, event.message);
          break;

        default:
          break;
      }
    },

    /** Reveal the rest immediately. */
    skip() {
      buffer?.flush();
    },

    destroy() {
      buffer?.stop();
      buffer = null;
    },

    get phase() {
      return phase.phase;
    },

    get pending() {
      return buffer ? buffer.pending : 0;
    },
  };
}
