// Animation principles as data. Everything here samples a curve into layer `keys` ({t, x, y, rotate, scale, opacity, ease:'linear'}),
// so the player needs no new code and every frame stays a pure function of time. Sampling is deterministic: no randomness, no clock.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
export const MAX_KEYS = 32;
const PROPS = ['x', 'y', 'rotate', 'scale', 'opacity'];

// ---- curves: u in 0..1 -> progress (may leave 0..1 for overshoot) -----------------------------------
// CSS-style cubic Bezier easing, solved with a fixed number of Newton/bisection steps.
export function bezierEase(x1, y1, x2, y2) {
  if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new Error('bezierEase: x1/x2 must be 0..1');
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0, hi = 1, t = u;
    for (let i = 0; i < 32; i++) { const x = X(t); if (Math.abs(x - u) < 1e-6) break; if (x < u) lo = t; else hi = t; t = (lo + hi) / 2; }
    return Y(t);
  };
}
export const CURVES = Object.freeze({
  linear: (u) => u,
  ease_in: bezierEase(0.42, 0, 1, 1),
  ease_out: bezierEase(0, 0, 0.58, 1),
  ease_in_out: bezierEase(0.42, 0, 0.58, 1),
  snappy: bezierEase(0.16, 1, 0.3, 1),
  back_out: bezierEase(0.34, 1.56, 0.64, 1),
  back_in: bezierEase(0.36, 0, 0.66, -0.56),
});
// Deterministic damped spring toward 1 (analytic, no integration drift). stiffness/damping/mass as in a physical spring.
export function spring({ stiffness = 170, damping = 14, mass = 1 } = {}) {
  const w0 = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
  return (t) => {
    if (t <= 0) return 0;
    if (zeta < 1) { const wd = w0 * Math.sqrt(1 - zeta * zeta); return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t)); }
    if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const s = w0 * Math.sqrt(zeta * zeta - 1), r1 = -zeta * w0 + s, r2 = -zeta * w0 - s;
    return 1 - (r1 * Math.exp(r2 * t) - r2 * Math.exp(r1 * t)) / (r1 - r2);
  };
}
// Time (seconds) until a spring stays within `tol` of 1 for good.
export function springSettle(opts, tol = 0.01) { const f = spring(opts); let last = 0; for (let t = 0; t < 10; t += 0.005) if (Math.abs(f(t) - 1) > tol) last = t; return r3(last + 0.005); }

// ---- sampling ---------------------------------------------------------------------------------------
// props: { x: {from, to, curve}, scale: {from, to, spring: {...}}, ... }; curve is a name in CURVES, a function, or [x1,y1,x2,y2].
// A spring prop runs in real time (its own settle time) and is stretched onto `duration`.
function resolve(spec) {
  if (spec.spring) { const o = spec.spring, T = springSettle(o); const f = spring(o); return (u) => f(u * T); }
  const c = spec.curve ?? 'ease_in_out';
  if (typeof c === 'function') return c;
  if (Array.isArray(c)) return bezierEase(...c);
  if (!CURVES[c]) throw new Error('unknown curve ' + c + ' (' + Object.keys(CURVES).join(', ') + ')');
  return CURVES[c];
}
export function sampleKeys(props, { duration = 1, n = 10, start = 0 } = {}) {
  const names = Object.keys(props);
  for (const k of names) if (!PROPS.includes(k)) throw new Error('unknown property ' + k);
  if (!(duration > 0)) throw new Error('duration must be > 0');
  n = clamp(Math.round(n), 2, MAX_KEYS);
  const fns = Object.fromEntries(names.map((k) => [k, resolve(props[k])]));
  const keys = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), key = { t: r3(start + u * duration), ease: 'linear' };
    for (const k of names) { const { from, to } = props[k]; key[k] = r3(from + (to - from) * fns[k](u)); }
    keys.push(key);
  }
  return keys;
}

// ---- curved movement paths --------------------------------------------------------------------------
// points: [{x,y}] with 2 points = line, 3 = quadratic Bezier, 4 = cubic Bezier. orient true turns the layer along the path.
export function pathPoint(points, u) {
  const m = 1 - u;
  if (points.length === 2) return { x: m * points[0].x + u * points[1].x, y: m * points[0].y + u * points[1].y };
  if (points.length === 3) return { x: m * m * points[0].x + 2 * m * u * points[1].x + u * u * points[2].x, y: m * m * points[0].y + 2 * m * u * points[1].y + u * u * points[2].y };
  if (points.length === 4) return { x: m * m * m * points[0].x + 3 * m * m * u * points[1].x + 3 * m * u * u * points[2].x + u * u * u * points[3].x, y: m * m * m * points[0].y + 3 * m * m * u * points[1].y + 3 * m * u * u * points[2].y + u * u * u * points[3].y };
  throw new Error('path needs 2, 3 or 4 points');
}
export function pathKeys(points, { duration = 1, n = 14, curve = 'ease_in_out', orient = false, rotateOffset = 0, start = 0 } = {}) {
  const f = resolve({ curve });
  n = clamp(Math.round(n), 2, MAX_KEYS);
  const keys = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), p = pathPoint(points, f(u));
    const key = { t: r3(start + u * duration), x: r3(p.x), y: r3(p.y), ease: 'linear' };
    if (orient) { const a = pathPoint(points, clamp(f(u) - 0.01, 0, 1)), b = pathPoint(points, clamp(f(u) + 0.01, 0, 1)); key.rotate = r3(clamp((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + rotateOffset, -720, 720)); }
    keys.push(key);
  }
  return keys;
}

// ---- principles: anticipation, follow-through, holds ------------------------------------------------
// Anticipation: before moving from `from` to `to`, pull back `amount` (fraction of the distance) over `lead` seconds.
export function anticipation(prop, from, to, { amount = 0.15, lead = 0.18, move = 0.45, curve = 'snappy', start = 0, n = 8 } = {}) {
  const back = from - (to - from) * amount;
  const keys = [{ t: r3(start), [prop]: from, ease: 'linear' }, { t: r3(start + lead), [prop]: r3(back), ease: 'smooth' }];
  return keys.concat(sampleKeys({ [prop]: { from: back, to, curve } }, { duration: move, n, start: start + lead }).slice(1));
}
// Follow-through: reach `to`, overshoot and settle with a spring (the end is exactly `to`).
export function followThrough(prop, from, to, { stiffness = 220, damping = 11, duration = 0.9, n = 14, start = 0 } = {}) {
  return sampleKeys({ [prop]: { from, to, spring: { stiffness, damping } } }, { duration, n, start });
}
// Hold: stay still for `seconds` after the last key.
export function hold(keys, seconds) {
  const last = keys[keys.length - 1];
  return keys.concat([{ ...last, t: r3(last.t + seconds) }]);
}
// Concatenate key runs back to back (each run's t restarts at 0 and is shifted after the previous run), merging held values.
export function sequence(...runs) {
  const out = [];
  let offset = 0;
  for (const run of runs) {
    const base = run[0].t;
    for (const k of run) out.push({ ...k, t: r3(offset + k.t - base) });
    offset = out[out.length - 1].t;
  }
  // drop zero-length duplicates at run joins
  const keys = out.filter((k, i) => i === 0 || k.t > out[i - 1].t + 1e-6);
  if (keys.length > MAX_KEYS) throw new Error('sequence has ' + keys.length + ' keys; the limit is ' + MAX_KEYS);
  return keys;
}

// ---- pose presets -----------------------------------------------------------------------------------
// A pose is an offset on a layer's resting x/y/rotate/scale (x/y in percent). Use with poseKeys to key a whole performance.
export const POSES = Object.freeze({
  rest: {},
  squash: { scale: 0.88, y: 0.8 },
  stretch: { scale: 1.12, y: -1.2 },
  crouch: { scale: 0.92, y: 1.4 },
  jump: { scale: 1.06, y: -6 },
  lean_forward: { rotate: 8, x: 1 },
  lean_back: { rotate: -8, x: -1 },
  punch: { rotate: 14, x: 3, scale: 1.08 },
  recoil: { rotate: -10, x: -3, scale: 0.95 },
  bow: { rotate: 18, y: 1 },
  wave_hi: { rotate: -24 },
  wave_lo: { rotate: 24 },
});
// poseKeys({x,y,rotate,scale}, [{pose:'crouch', t:0.2}, {pose:'jump', t:0.5, ease:'bounce'}, ...]) -> keys
export function poseKeys(rest, beats) {
  const r = { x: 0, y: 0, rotate: 0, scale: 1, ...rest };
  const keys = beats.map((b) => {
    const p = typeof b.pose === 'string' ? POSES[b.pose] : b.pose;
    if (!p) throw new Error('unknown pose ' + b.pose);
    const key = { t: r3(b.t), ease: b.ease || 'smooth' };
    if (rest.x !== undefined || p.x !== undefined) key.x = r3(r.x + (p.x ?? 0));
    if (rest.y !== undefined || p.y !== undefined) key.y = r3(r.y + (p.y ?? 0));
    if (rest.rotate !== undefined || p.rotate !== undefined) key.rotate = r3(r.rotate + (p.rotate ?? 0));
    if (rest.scale !== undefined || p.scale !== undefined) key.scale = r3(r.scale * (p.scale ?? 1));
    return key;
  });
  if (keys.length > MAX_KEYS) throw new Error('too many pose beats');
  return keys;
}
// Merge key runs that animate different properties onto one timeline (same t values are combined, later wins).
export function mergeKeys(...runs) {
  const map = new Map();
  for (const run of runs) for (const k of run) { const t = r3(k.t); map.set(t, { ...(map.get(t) || {}), ...k, t }); }
  const keys = [...map.values()].sort((a, b) => a.t - b.t);
  if (keys.length > MAX_KEYS) throw new Error('merged run has ' + keys.length + ' keys; the limit is ' + MAX_KEYS);
  return keys;
}
