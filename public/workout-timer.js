// Shared workout-timer core. Kept free of DOM access so the same logic can be
// unit-tested in plain Node and reused by any future timer surfaces.

export function totalWorkoutSeconds(plan = []) {
  return plan.reduce(
    (sum, ex) => sum + (Number(ex?.workoutSeconds) || 0) + (Number(ex?.restSeconds) || 0),
    0
  );
}

export function planSummary(plan = []) {
  const exerciseSeconds = plan.reduce((s, ex) => s + (Number(ex?.workoutSeconds) || 0), 0);
  const restSeconds = plan.reduce((s, ex) => s + (Number(ex?.restSeconds) || 0), 0);
  return {
    exerciseCount: plan.length,
    exerciseSeconds,
    restSeconds,
    totalSeconds: exerciseSeconds + restSeconds,
  };
}

export function nextPhaseTick(plan, index, remaining, phase) {
  const ex = plan[index];
  const current = Math.max(0, Math.ceil(Number(remaining) || 0));
  const next = current - 1;
  if (next > 0) return { index, phase, remaining: next, done: false };
  if (phase === 'workout') {
    if ((Number(ex?.restSeconds) || 0) > 0) {
      return { index, phase: 'rest', remaining: Number(ex.restSeconds), done: false };
    }
    if (index + 1 < plan.length) return { index: index + 1, phase: 'workout', remaining: Number(ex?.workoutSeconds), done: false };
    return { index, phase: 'rest', remaining: 0, done: true };
  }
  if (index + 1 < plan.length) return { index: index + 1, phase: 'workout', remaining: Number(ex?.workoutSeconds), done: false };
  return { index, phase: 'rest', remaining: 0, done: true };
}

export function createCountdown({ initialSeconds, onTick, onDone }) {
  let remaining = Math.max(0, Math.ceil(Number(initialSeconds) || 0));
  let interval = null;
  let finished = false;
  onTick?.(remaining);
  const start = () => {
    if (interval != null) return;
    if (remaining <= 0) { finish(); return; }
    interval = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) { remaining = 0; finish(); return; }
      onTick?.(remaining);
    }, 1000);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    stop();
    onTick?.(0);
    onDone?.();
  };
  const stop = () => {
    if (interval != null) { window.clearInterval(interval); interval = null; }
  };
  const reset = (seconds) => {
    stop();
    finished = false;
    remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
    onTick?.(remaining);
  };
  const skip = (seconds) => {
    stop();
    remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
    onTick?.(remaining);
    if (remaining <= 0) { finish(); return; }
    interval = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) { remaining = 0; finish(); return; }
      onTick?.(remaining);
    }, 1000);
  };
  return {
    start,
    stop,
    reset,
    skip,
    get remaining() { return remaining; },
    get running() { return interval != null; },
    get finished() { return finished; },
  };
}
