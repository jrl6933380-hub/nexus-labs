// Shot metadata and footage layers. A shot is a trimmed piece of a library clip plus what it shows, so an agent can plan,
// reorder and review footage without watching it. Captions and logos are always `fixed` layers, so camera moves never touch them.
const ID = /^[a-z0-9-]{3,40}$/;
export const FRAMINGS = Object.freeze(['wide', 'medium', 'close', 'detail']);
export const SHOT_LIMITS = Object.freeze({ maxShots: 8, maxSeconds: 30 });
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function validateShot(shot) {
  const errors = [];
  if (!shot || typeof shot !== 'object') return { ok: false, errors: ['shot must be an object'], value: null };
  if (!ID.test(String(shot.mediaId || ''))) errors.push('mediaId: a media library id');
  const trimIn = num(shot.trimIn, 0), trimOut = shot.trimOut == null ? null : num(shot.trimOut, NaN);
  if (!(trimIn >= 0)) errors.push('trimIn: seconds >= 0');
  if (trimOut != null && !(trimOut > trimIn)) errors.push('trimOut: must be after trimIn');
  const rate = num(shot.rate, 1);
  if (!(rate >= 0.25 && rate <= 4)) errors.push('rate: 0.25 to 4');
  const framing = shot.framing || 'medium';
  if (!FRAMINGS.includes(framing)) errors.push('framing: ' + FRAMINGS.join(', '));
  const f = { x: num(shot.focus && shot.focus.x, 50), y: num(shot.focus && shot.focus.y, 50) };
  if (f.x < 0 || f.x > 100 || f.y < 0 || f.y > 100) errors.push('focus: x and y 0 to 100');
  const seconds = shot.seconds == null ? (trimOut != null ? (trimOut - trimIn) / rate : 3) : num(shot.seconds, NaN);
  if (!(seconds > 0 && seconds <= SHOT_LIMITS.maxSeconds)) errors.push('seconds: more than 0, at most ' + SHOT_LIMITS.maxSeconds);
  const text = (k, n) => (shot[k] == null ? '' : String(shot[k]).slice(0, n));
  if (errors.length) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: { id: text('id', 24) || 'shot', mediaId: shot.mediaId, trimIn, trimOut, rate, repeat: !!shot.repeat, framing, focus: f, seconds, subject: text('subject', 80), mood: text('mood', 40), caption: text('caption', 90) } };
}
// A footage layer for a shot: full-bleed by default, cropped around the shot's focus point.
export function shotLayer(shot, box = {}) {
  const s = shot.value || shot;
  const layer = { shape: 'video', imageId: s.mediaId, x: box.x ?? 50, y: box.y ?? 50, w: box.w ?? 100, h: box.h ?? 100, fit: box.fit || 'cover', focusX: s.focus.x, focusY: s.focus.y, trimIn: s.trimIn, rate: s.rate };
  if (s.trimOut != null) layer.trimOut = s.trimOut;
  if (s.repeat) layer.repeat = true;
  return layer;
}
// One graphic scene per shot: footage, an optional gentle camera push by framing, and fixed caption/logo layers.
export function shotsToScenes(shots, { logoId = null, captionStyle = {} } = {}) {
  if (!Array.isArray(shots) || !shots.length || shots.length > SHOT_LIMITS.maxShots) throw new Error('shots: 1 to ' + SHOT_LIMITS.maxShots);
  return shots.map((raw, i) => {
    const v = validateShot(raw);
    if (!v.ok) throw new Error(`shot ${i + 1}: ${v.errors.join('; ')}`);
    const s = v.value;
    const push = { wide: 1.06, medium: 1.04, close: 1.02, detail: 1 }[s.framing];
    const layers = [shotLayer(v)];
    if (s.caption) layers.push({ shape: 'text', text: s.caption, x: 50, y: 84, size: 6.5, weight: 900, color: 'white', shadow: 6, maxw: 86, fixed: true, motion: 'slide_up', delay: 0.2, ...captionStyle });
    if (logoId) layers.push({ shape: 'image', imageId: logoId, x: 88, y: 8, w: 14, h: 6, fit: 'contain', fixed: true });
    return { id: `${s.id}-${i + 1}`.slice(0, 24), type: 'graphic', duration: s.seconds, background: 'gradient', params: { layers, camera: [{ t: 0, x: 50, y: 50, zoom: 1 }, { t: s.seconds, x: 50, y: 50, zoom: push }] } };
  });
}
// Review summary for an agent: what plays when, without decoding any video.
export function shotList(shots) {
  let at = 0;
  return shots.map((raw, i) => {
    const v = validateShot(raw);
    if (!v.ok) return { index: i + 1, ok: false, errors: v.errors };
    const s = v.value, row = { index: i + 1, ok: true, startSec: Math.round(at * 100) / 100, seconds: s.seconds, mediaId: s.mediaId, framing: s.framing, subject: s.subject, trim: [s.trimIn, s.trimOut], rate: s.rate, caption: s.caption };
    at += s.seconds;
    return row;
  });
}
