// Pure helpers for exporting a vocabulary (v2) ad to MP4. No browser, no ffmpeg, no network here:
// scripts/export-ad-mp4.mjs drives them. Frames come from the stock player's capture barrier
// (window.__captureInfo / window.__capture in public/ad-designs/vocabulary-player.html), which is
// what makes every frame deterministic and acknowledged before it is screenshotted.
import { createHash } from 'node:crypto';
import { FORMATS, VOCABULARY_VERSION, validateProjectV2 } from '../public/ad-vocabulary.mjs';

export const EXPORT_LIMITS = Object.freeze({
  fps: Object.freeze([24, 30, 60]),
  scale: Object.freeze([1, 2, 3]),
  crfMin: 12,
  crfMax: 28,
  maxFrames: 1800,
});

const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// CLI strings or numbers in, validated numbers out. Throws a plain Error naming the bad option.
export function normalizeExportOptions(input = {}) {
  const o = { fps: 30, scale: 2, crf: 18, audio: null, ...clean(input) };
  const fps = Number(o.fps), scale = Number(o.scale), crf = Number(o.crf);
  if (!EXPORT_LIMITS.fps.includes(fps)) throw new Error(`fps must be one of ${EXPORT_LIMITS.fps.join(', ')}`);
  if (!EXPORT_LIMITS.scale.includes(scale)) throw new Error(`scale must be one of ${EXPORT_LIMITS.scale.join(', ')}`);
  if (!Number.isInteger(crf) || crf < EXPORT_LIMITS.crfMin || crf > EXPORT_LIMITS.crfMax) throw new Error(`crf must be a whole number from ${EXPORT_LIMITS.crfMin} to ${EXPORT_LIMITS.crfMax}`);
  if (o.audio !== null && (typeof o.audio !== 'string' || !o.audio.trim())) throw new Error('audio must be a file path');
  return { fps, scale, crf, audio: o.audio === null ? null : String(o.audio) };
}

// Accepts a bare v2 project or any object that carries one under `.project` (a read_nexus_ad result,
// a saved record). Always runs the strict v2 validator, so legacy ads and malformed input are refused.
export function projectFromInput(raw) {
  const candidate = raw && typeof raw === 'object' && raw.project && typeof raw.project === 'object' ? raw.project : raw;
  const checked = validateProjectV2(candidate);
  if (!checked.ok) throw new Error(`Not a valid vocabulary (v2) ad: ${checked.errors.slice(0, 5).join('; ')}`);
  return checked.value;
}

// Same expression the player uses for its own total, so both sides agree to the last bit.
export const projectTotalMs = (project) => project.scenes.reduce((n, s) => n + s.duration * 1000, 0);

export function planExport(project, options = {}) {
  const { fps, scale, crf, audio } = normalizeExportOptions(options);
  const format = FORMATS.find((f) => f.id === project.platform.format);
  if (!format) throw new Error(`Unknown format: ${project.platform.format}`);
  const totalMs = projectTotalMs(project);
  const frames = Math.max(1, Math.round((totalMs / 1000) * fps));
  if (frames > EXPORT_LIMITS.maxFrames) throw new Error(`${frames} frames exceeds the ${EXPORT_LIMITS.maxFrames}-frame limit`);
  return {
    fps, scale, crf, audio,
    format: format.id,
    logicalWidth: format.width,
    logicalHeight: format.height,
    width: format.width * scale,
    height: format.height * scale,
    totalMs,
    sceneCount: project.scenes.length,
    frames,
    durationSec: frames / fps,
    concept: project.concept === true,
    vocabularyVersion: VOCABULARY_VERSION,
  };
}

// Frame i is shown at i/fps seconds. The last frame is always before the end of the ad.
export const frameTimeMs = (plan, index) => (index * 1000) / plan.fps;

const STAGE = '<div id="stage"></div>';

// Seeds the stock player with the project as inert JSON data, exactly like lib/adPreview.js does for
// the board, so an export renders what the board shows. "<" is escaped so text can never close the tag.
export function seedPlayerHtml(playerHtml, project) {
  if (playerHtml.split(STAGE).length !== 2) throw new Error('The player must contain exactly one stage element.');
  const json = JSON.stringify(project).replace(/</g, '\\u003c');
  return playerHtml.replace(STAGE, () => `${STAGE}<script id="ad-project" type="application/json">${json}</script>`);
}

// ffmpeg arguments: PNG frames on stdin -> H.264 yuv420p MP4, tagged bt709 so players do not shift
// colours. Optional audio is trimmed to the video length and fades out over its last second.
export function ffmpegArgs(plan, outPath) {
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', 'png', '-i', 'pipe:0'];
  if (plan.audio) args.push('-i', plan.audio);
  args.push('-map', '0:v:0');
  if (plan.audio) args.push('-map', '1:a:0');
  args.push(
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(plan.crf),
    '-r', String(plan.fps), '-movflags', '+faststart',
  );
  if (plan.audio) {
    const fadeStart = Math.max(0, plan.durationSec - 1);
    args.push('-c:a', 'aac', '-b:a', '128k', '-af', `afade=t=out:st=${fadeStart}:d=1`, '-t', String(plan.durationSec));
  }
  args.push(outPath);
  return args;
}

// The player must be frozen, at the size and DPR the plan assumes, on the same vocabulary version,
// and have logged no errors. Anything else means the frames would not be reproducible.
export function verifyCaptureInfo(info, plan) {
  if (!info || typeof info !== 'object') throw new Error('Capture setup mismatch: the player did not report its capture info.');
  const problems = [];
  if (info.frozen !== true) problems.push('player is not frozen (open it with ?capture=1)');
  if (info.format !== plan.format) problems.push(`format ${info.format} != ${plan.format}`);
  if (info.logicalWidth !== plan.logicalWidth || info.logicalHeight !== plan.logicalHeight) problems.push(`logical size ${info.logicalWidth}x${info.logicalHeight} != ${plan.logicalWidth}x${plan.logicalHeight}`);
  const v = info.viewport || {};
  if (v.width !== plan.logicalWidth || v.height !== plan.logicalHeight) problems.push(`viewport ${v.width}x${v.height} != ${plan.logicalWidth}x${plan.logicalHeight}`);
  if (info.dpr !== plan.scale) problems.push(`dpr ${info.dpr} != ${plan.scale}`);
  if (info.vocabularyVersion !== plan.vocabularyVersion) problems.push(`vocabulary ${info.vocabularyVersion} != ${plan.vocabularyVersion}`);
  if (typeof info.totalMs !== 'number' || Math.abs(info.totalMs - plan.totalMs) > 1e-6) problems.push(`duration ${info.totalMs}ms != ${plan.totalMs}ms`);
  if (info.sceneCount !== plan.sceneCount) problems.push(`scene count ${info.sceneCount} != ${plan.sceneCount}`);
  if (Array.isArray(info.errors) && info.errors.length) problems.push(`page errors: ${info.errors.slice(0, 3).join(' | ')}`);
  if (problems.length) throw new Error(`Capture setup mismatch: ${problems.join('; ')}`);
}

// One call to window.__capture per frame, so the player's seq must equal index + 1, the returned time
// must be the requested time, and the DOM stamp must agree. `result` is { ack, stampSeq, stampMs }.
export function verifyFrameAck(result, { index, timeMs }) {
  const ack = result && result.ack;
  const problems = [];
  if (!ack || ack.ready !== true) problems.push('frame was not acknowledged as ready');
  else {
    if (ack.seq !== index + 1) problems.push(`seq ${ack.seq} != ${index + 1}`);
    if (typeof ack.timeMs !== 'number' || Math.abs(ack.timeMs - timeMs) > 1e-6) problems.push(`time ${ack.timeMs} != ${timeMs}`);
    if (result.stampSeq !== String(ack.seq)) problems.push(`stamp seq ${result.stampSeq} != ${ack.seq}`);
    if (Number(result.stampMs) !== ack.timeMs) problems.push(`stamp time ${result.stampMs} != ${ack.timeMs}`);
  }
  if (problems.length) throw new Error(`Frame ${index} (${timeMs}ms) failed its capture check: ${problems.join('; ')}`);
}

// Width and height of a PNG from its header, to confirm screenshots are the size the plan expects.
export function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!buf || buf.length < 24 || sig.some((b, i) => buf[i] !== b)) throw new Error('Not a PNG image.');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

// One fingerprint for all frames: identical pixels in identical order give an identical value,
// whatever ffmpeg version or machine encodes them.
export const framesFingerprint = (frameHashes) => sha256Hex(frameHashes.join('\n'));

export function buildManifest(plan, project, { framesSha256, frameBytes, tool = 'scripts/export-ad-mp4.mjs' }) {
  return {
    tool,
    vocabularyVersion: plan.vocabularyVersion,
    name: project.name,
    format: plan.format,
    concept: plan.concept,
    fps: plan.fps,
    scale: plan.scale,
    width: plan.width,
    height: plan.height,
    frames: plan.frames,
    durationSec: plan.durationSec,
    audio: plan.audio ? 'yes' : 'none',
    projectSha256: sha256Hex(JSON.stringify(project)),
    framesSha256,
    frameBytes,
  };
}

export function defaultExportName(project, plan) {
  const slug = String(project.name || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ad';
  return `${slug}-${plan.format}-${plan.fps}fps.mp4`;
}
