import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {understandOutput} from './nexusLabUnderstand.js';

// Agent tasks: a connected AI (Claude/ChatGPT) does the model work through tools.
// The server never calls an outside provider. It validates the answer and scores it.
export const AGENT_CAPABILITIES = Object.freeze(['understand', 'detect', 'cutout', 'video']);
export const PASS_SCORE = 0.6;
const LEASE_MS = 10 * 60 * 1000, KEEP = 200;
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v, max, label = 'text') => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw fail(`Invalid ${label}.`, 422); return v.trim(); };
const limits = v => { if (v === undefined) return []; if (!Array.isArray(v) || v.length > 12) throw fail('Invalid limitations.', 422); return v.map(x => str(x, 500, 'limitation')); };
const imageIds = media => new Set(media.filter(m => m.kind === 'image').map(m => m.asset_id));

// ---------- validators (each returns a clean output or throws a 422) ----------
export function detectOutput(raw, media) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.detections) || raw.detections.length > 100) throw fail('detections must be an array of at most 100 boxes.', 422);
  const ids = imageIds(media);
  const detections = raw.detections.map(d => {
    if (!d || !ids.has(d.asset_id)) throw fail('A detection references an unknown image.', 422);
    const b = d.box;
    if (!b || !['x', 'y', 'w', 'h'].every(k => num(b[k], 0, 1)) || b.w <= 0 || b.h <= 0 || b.x + b.w > 1.0001 || b.y + b.h > 1.0001) throw fail('Each box needs x, y, w, h as 0–1 fractions of the image, inside its bounds.', 422);
    if (d.confidence !== undefined && !num(d.confidence, 0, 1)) throw fail('confidence must be 0–1.', 422);
    return {asset_id: d.asset_id, label: str(d.label, 80, 'label'), box: {x: b.x, y: b.y, w: b.w, h: b.h}, ...(d.confidence !== undefined ? {confidence: d.confidence} : {})};
  });
  return {detections, limitations: limits(raw.limitations)};
}
export const polygonArea = p => Math.abs(p.reduce((s, [x1, y1], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + (x1 * y2 - x2 * y1); }, 0)) / 2;
export function cutoutOutput(raw, media) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cutouts) || !raw.cutouts.length || raw.cutouts.length > 20) throw fail('cutouts must be 1–20 outlines.', 422);
  const ids = imageIds(media);
  const cutouts = raw.cutouts.map(c => {
    if (!c || !ids.has(c.asset_id)) throw fail('A cutout references an unknown image.', 422);
    const p = c.polygon;
    if (!Array.isArray(p) || p.length < 3 || p.length > 200 || p.some(pt => !Array.isArray(pt) || pt.length !== 2 || !num(pt[0], 0, 1) || !num(pt[1], 0, 1))) throw fail('polygon needs 3–200 [x,y] points as 0–1 fractions of the image.', 422);
    const area = polygonArea(p);
    if (area < 0.0005) throw fail('That outline is too small or flat to be a subject.', 422);
    return {asset_id: c.asset_id, label: str(c.label, 80, 'label'), polygon: p.map(([x, y]) => [x, y]), area};
  });
  return {cutouts, limitations: limits(raw.limitations)};
}
export function videoOutput(raw, media) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.scenes) || !raw.scenes.length || raw.scenes.length > 12) throw fail('scenes must be a plan of 1–12 scenes.', 422);
  const ids = new Set(media.map(m => m.asset_id));
  let total = 0;
  const scenes = raw.scenes.map(s => {
    if (!s || !num(s.seconds, 0.5, 15)) throw fail('Each scene needs seconds between 0.5 and 15.', 422);
    if (s.asset_id !== undefined && !ids.has(s.asset_id)) throw fail('A scene references an unknown asset.', 422);
    total += s.seconds;
    return {seconds: s.seconds, text: str(s.text, 200, 'scene text'), ...(s.asset_id ? {asset_id: s.asset_id} : {}), ...(typeof s.motion === 'string' ? {motion: s.motion.slice(0, 40)} : {})};
  });
  if (total > 60) throw fail('The plan runs longer than 60 seconds.', 422);
  return {scenes, total_seconds: total, limitations: limits(raw.limitations)};
}
const VALIDATE = {understand: understandOutput, detect: detectOutput, cutout: cutoutOutput, video: videoOutput};

// ---------- scorers (0–1 against known truth) ----------
export function iou(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)), i = w * h, u = a.w * a.h + b.w * b.h - i;
  return u > 0 ? i / u : 0;
}
const inside = (poly, px, py) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; };
export function maskIou(p, q, n = 48) {
  let i = 0, u = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = inside(p, (x + .5) / n, (y + .5) / n), b = inside(q, (x + .5) / n, (y + .5) / n); if (a && b) i++; if (a || b) u++; }
  return u ? i / u : 0;
}
const rectPoly = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
function matchScore(items, truth, sim) {
  const used = new Set(); let sum = 0;
  for (const t of truth) {
    let best = -1, bi = 0;
    items.forEach((it, i) => { if (used.has(i) || !it.label.toLowerCase().includes(t.label.toLowerCase())) return; const s = sim(it, t); if (s > bi) { bi = s; best = i; } });
    if (best >= 0) { used.add(best); sum += bi; }
  }
  return sum / Math.max(truth.length, items.length, 1);
}
export function scoreOutput(capability, output, truth) {
  if (!truth) return null;
  if (capability === 'detect') return matchScore(output.detections, truth.boxes, (d, t) => iou(d.box, t.box));
  if (capability === 'cutout') return matchScore(output.cutouts, truth.boxes, (c, t) => maskIou(c.polygon, rectPoly(t.box)));
  if (capability === 'understand') { const text = JSON.stringify([output.summary, output.observations]).toLowerCase(); return truth.terms.filter(t => text.includes(t)).length / truth.terms.length; }
  if (capability === 'video') return output.scenes.length === truth.scenes && Math.abs(output.total_seconds - truth.seconds) <= truth.seconds * 0.25 ? 1 : 0;
  return null;
}

// ---------- built-in fixtures: a real picture the connected AI must look at ----------
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function makePng(w, h, rects, bg = [235, 235, 235]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const r = rects.find(r => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1), c = r ? r.rgb : bg, o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const COLORS = {red: [220, 40, 40], blue: [40, 80, 220], green: [40, 170, 70], yellow: [235, 200, 30]};
export function fixtureFor(id, capability) {
  const seed = crypto.createHash('sha256').update(id).digest(), n = 128, names = Object.keys(COLORS);
  const a = names[seed[0] % 4], b = names.filter(x => x !== a)[seed[1] % 3];
  const box = (i, lo) => { const w = 20 + seed[i] % 30, h = 20 + seed[i + 1] % 40; return {x0: lo + seed[i + 2] % (60 - w), y0: seed[i + 3] % (n - h), w, h}; };
  const A = box(2, 0), B = box(6, 64), rects = [A, B].map((r, i) => ({x0: r.x0, y0: r.y0, x1: r.x0 + r.w, y1: r.y0 + r.h, rgb: COLORS[i ? b : a]}));
  const truthBoxes = [[a, A], [b, B]].map(([label, r]) => ({label, box: {x: r.x0 / n, y: r.y0 / n, w: r.w / n, h: r.h / n}}));
  const prompts = {
    understand: 'Look at the picture. Describe it, and say which colored shapes you see.',
    detect: 'Find every colored rectangle. Return a box for each, labeled with its color (for example "red rectangle").',
    cutout: 'Outline every colored rectangle as a polygon, labeled with its color.',
  };
  if (capability === 'video') return {prompt: 'Plan a video of exactly 3 scenes totaling about 12 seconds for a lemonade stand ad.', png: null, media: [], truth: {scenes: 3, seconds: 12}};
  const media = [{asset_id: 'fixture-image', name: 'fixture.png', kind: 'image', mime: 'image/png', width: n, height: n, seconds: null}];
  const truth = capability === 'understand' ? {terms: [a, b, 'rectangle']} : {boxes: truthBoxes};
  return {prompt: prompts[capability], png: makePng(n, n, rects), media, truth};
}

// ---------- the task service ----------
export function createAgentTasks({command, now = () => Date.now(), newId = () => crypto.randomUUID()} = {}) {
  const k = (o, name) => { if (!o?.id) throw fail('Owner authentication required.', 401); return `nexus:lab:${encodeURIComponent(o.id)}:${name}:v1`; };
  const hash = t => crypto.createHash('sha256').update(t).digest('hex');
  const load = async (o, id) => { const raw = await command(['HGET', k(o, 'agenttasks'), String(id)]); if (!raw) throw fail('Lab task not found.', 404); return JSON.parse(raw); };
  const save = (o, t) => command(['HSET', k(o, 'agenttasks'), t.id, JSON.stringify(t)]);
  const view = t => { const {claim_hash, truth, png_b64, ...rest} = t; return rest; };
  const expire = async (o, t) => { if (t.status === 'claimed' && t.lease_until < now()) { t.status = 'open'; t.claim_hash = null; t.lease_until = null; await save(o, t); } return t; };
  async function prune(o) {
    const all = (await command(['HVALS', k(o, 'agenttasks')]) || []).map(r => JSON.parse(r)).sort((a, b) => b.created_at - a.created_at);
    const drop = all.slice(KEEP).map(t => t.id); if (drop.length) await command(['HDEL', k(o, 'agenttasks'), ...drop]);
  }
  async function readiness(o) { const raw = await command(['HGET', k(o, 'agentready'), 'all']); return raw ? JSON.parse(raw) : {}; }
  async function create(o, {capability, prompt, media = [], selftest = false, truth = null, png = null, source = null}) {
    k(o, 'x');
    if (!AGENT_CAPABILITIES.includes(capability)) throw fail('Choose understand, detect, cutout, or video.');
    const t = {id: newId(), capability, prompt: str(prompt, 2000, 'prompt'), media, selftest, source, status: 'open', created_at: now(), claim_hash: null, lease_until: null, result: null, score: null, truth, png_b64: png ? png.toString('base64') : null};
    await save(o, t); await prune(o); return view(t);
  }
  return {
    create,
    async createSelfTest(o, capability) {
      if (!AGENT_CAPABILITIES.includes(capability)) throw fail('Choose understand, detect, cutout, or video.');
      const id = newId(), f = fixtureFor(id, capability);
      return create(o, {capability, prompt: f.prompt, media: f.media, selftest: true, truth: f.truth, png: f.png});
    },
    async list(o, {status} = {}) {
      const all = (await command(['HVALS', k(o, 'agenttasks')]) || []).map(r => JSON.parse(r));
      for (const t of all) await expire(o, t);
      return all.filter(t => !status || t.status === status).sort((a, b) => b.created_at - a.created_at).map(view);
    },
    async claim(o, id) {
      const t = await expire(o, await load(o, id));
      if (t.status !== 'open') throw fail('That task is already claimed or finished.', 409);
      const token = crypto.randomBytes(18).toString('hex');
      t.status = 'claimed'; t.claim_hash = hash(token); t.lease_until = now() + LEASE_MS; await save(o, t);
      // The claiming AI looks at the media itself; no provider is called.
      return {task: view(t), claim_token: token, image_png_base64: t.png_b64, expected_output: SHAPES[t.capability], lease_ms: LEASE_MS};
    },
    async complete(o, id, {claim_token, output}) {
      const t = await expire(o, await load(o, id));
      if (t.status !== 'claimed' || typeof claim_token !== 'string' || hash(claim_token) !== t.claim_hash) throw fail('Claim this task first, with its claim token.', 409);
      let clean;
      try { clean = VALIDATE[t.capability](output, t.media); } catch (e) { t.attempts = (t.attempts || 0) + 1; t.last_error = e.message; await save(o, t); throw e; }
      t.result = clean; t.score = scoreOutput(t.capability, clean, t.truth); t.status = 'done'; t.claim_hash = null; t.completed_at = now(); await save(o, t);
      if (t.selftest && t.score !== null) {
        const r = await readiness(o), prev = r[t.capability] || {runs: 0};
        r[t.capability] = {runs: prev.runs + 1, last_score: t.score, best_score: Math.max(prev.best_score ?? 0, t.score), passed: t.score >= PASS_SCORE || prev.passed === true, updated_at: now()};
        await command(['HSET', k(o, 'agentready'), 'all', JSON.stringify(r)]);
      }
      return view(t);
    },
    async readiness(o) { return readiness(o); },
  };
}
export const SHAPES = {
  understand: {summary: 'string', observations: [{asset_id: 'string', text: 'string'}], limitations: ['string (optional)']},
  detect: {detections: [{asset_id: 'string', label: 'string', box: {x: '0-1', y: '0-1', w: '0-1', h: '0-1'}, confidence: '0-1 (optional)'}]},
  cutout: {cutouts: [{asset_id: 'string', label: 'string', polygon: [['x 0-1', 'y 0-1']]}]},
  video: {scenes: [{seconds: '0.5-15', text: 'string', asset_id: 'string (optional)'}]},
};
