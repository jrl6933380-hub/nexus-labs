#!/usr/bin/env node
// Local Qwen ad routine. Model output is data; it is never evaluated as code.
import {readFile, writeFile, mkdir, rename, open, unlink, access} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProjectV2, totalDurationV2, VOCABULARY_VERSION} from '../../public/ad-vocabulary.mjs';

const TYPES = new Set(['hook_text', 'before_after', 'steps_list', 'end_card']);
const TERMINAL = new Set(['awaiting_visual_review', 'needs_help', 'failed', 'canceled']);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const words = x => typeof x === 'string' ? (x.trim().match(/\S+/g) || []).length : 0;
const canceled = signal => { if (signal?.aborted) throw signal.reason || new Error('Canceled'); };
const issue = (code, path, message) => ({code, path, message});

export function reviewProject(project, targetSec = 15) {
  const schema = validateProjectV2(project);
  if (!schema.ok) return {ok: false, issues: schema.errors.map(message => issue('schema', 'project', message)), project: null};
  const p = schema.value, issues = [];
  if (p.concept !== true) issues.push(issue('concept', 'concept', 'Set concept:true; this is a draft concept, not a live result.'));
  if (p.platform.lengthSec !== targetSec || Math.abs(totalDurationV2(p) - targetSec) > .01) {
    issues.push(issue('total_duration', 'platform.lengthSec', `Scene durations and platform.lengthSec must both equal ${targetSec} seconds.`));
  }
  const ctas = p.scenes.filter(s => s.type === 'end_card');
  if (ctas.length !== 1 || p.scenes.at(-1).type !== 'end_card') issues.push(issue('cta_order', 'scenes', 'Use exactly one end_card, as the final scene.'));
  if (words(p.scenes[0]?.params.headline) > 7) issues.push(issue('hook_length', 'scenes[0].params.headline', 'Opening hook must have at most seven words.'));
  for (const [i, s] of p.scenes.entries()) {
    const path = `scenes[${i}]`;
    if (!TYPES.has(s.type)) { issues.push(issue('unsupported_scene', path, 'This local routine supports hook_text, before_after, steps_list and end_card only.')); continue; }
    if (s.type === 'end_card' && s.duration < 3) issues.push(issue('cta_hold', `${path}.duration`, 'Hold the closing CTA for at least 3 seconds.'));
    const q = s.params;
    const copy = s.type === 'hook_text' ? [q.headline, q.support]
      : s.type === 'before_after' ? [q.beforeText, q.afterText]
      : s.type === 'steps_list' ? q.items.flatMap(x => [x.title, x.detail])
      : [q.cta, q.tagline];
    const stagger = s.type === 'steps_list' ? (q.stagger ?? .25) * (q.items.length - 1) : 0;
    // Deliberately a heuristic, not a vision/readability certification.
    const estimate = .6 + stagger + copy.reduce((n, x) => n + words(x), 0) / 3.5;
    if (s.duration + .01 < estimate) issues.push(issue('reading_time', path, `Reading-time estimate is ${estimate.toFixed(2)}s, but this scene lasts ${s.duration}s. Use at least ${(Math.ceil(estimate * 10) / 10).toFixed(1)}s or trim copy; keep the total ${targetSec}s.`));
  }
  return {ok: issues.length === 0, issues, project: p};
}

export function parseModelJson(text) {
  if (typeof text !== 'string' || text.length > 80000) throw new Error('Model response must be JSON text under 80000 characters.');
  let normalized = text.trim(), strippedFence = false;
  if (/^```(?:json)?\s*\n[\s\S]*\n```$/i.test(normalized)) {
    normalized = normalized.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```$/, ''); strippedFence = true;
  }
  const value = JSON.parse(normalized);
  const inspect = x => {
    if (!x || typeof x !== 'object') return;
    for (const key of Object.keys(x)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe object key.');
      inspect(x[key]);
    }
  };
  inspect(value);
  return {value, strippedFence};
}

export function applyRepair(current, response) {
  if (!plain(response)) throw new Error('Repair must be a JSON object.');
  if (response.specVersion === 2) return structuredClone(response);
  if (Object.keys(response).length === 1 && plain(response.project)) return structuredClone(response.project);
  if (!plain(current) || !Array.isArray(current.scenes)) throw new Error('Return a complete project to fix malformed JSON or missing scenes.');
  if (!Object.keys(response).length || Object.keys(response).some(k => !['durations', 'params'].includes(k))) throw new Error('Repair must contain durations and/or params, or a complete project.');
  const next = structuredClone(current);
  for (const [kind, patches] of Object.entries(response)) {
    if (!plain(patches)) throw new Error(`${kind} must map scene ids to changes.`);
    for (const [id, change] of Object.entries(patches)) {
      const scene = next.scenes.find(s => s?.id === id);
      if (!scene) throw new Error(`Unknown scene id ${id}.`);
      if (kind === 'durations') {
        if (!Number.isFinite(change)) throw new Error('Duration must be a finite number.');
        scene.duration = change;
      } else {
        if (!plain(change)) throw new Error('Scene params patch must be an object.');
        scene.params = {...scene.params, ...change};
      }
    }
  }
  return next;
}

const SCHEMA = `Return compact JSON only. Project fields: specVersion:2,name,brand,initial,mood:bold|warm|luxury|playful|clean,palette:midnight-gold|electric-pop|ocean-blue|cream-ink,platform:{format:"portrait",lengthSec:15},concept:true,scenes.
Scene fields:id,type,duration,params,camera(optional static|push_in|pull_out|pan_left|pan_right|parallax),background(optional solid|gradient|grain|grid|orbits|particles),transitionOut(optional cut|crossfade|wipe_left|slide_up|zoom_through),transitionMs(optional 200..800).
Allowed types and params: hook_text:{headline(max60),support(optional max120),textAnim(optional fade_up|slide_left|typewriter|word_by_word|mask_reveal|scale_pop|kinetic_stack)}; before_after:{beforeLabel/afterLabel(max20),beforeText/afterText(max60),revealStyle:wipe|slide|fade}; steps_list:{items:2..4 objects with title(max30),detail(optional max60),stagger(optional 0..1)}; end_card:{cta(max35),destination(optional max65),tagline(optional max60)}.
Use 2..4 scenes totaling exactly 15 seconds. Every scene >=1.5s. Exactly one end_card at the end, held >=3s. Hook <=7 words. Allow .6 seconds plus words/3.5 plus stagger for reading; trim copy to fit. Never invent prices, statistics, testimonials or guarantees. No external images, custom code, or publication. A draft always needs human/vision review.`;

export async function runReview(input, {generate, onState = async () => {}, onAttempt = async () => {}, signal} = {}) {
  if (!plain(input) || typeof input.brief !== 'string' || !input.brief.trim() || input.brief.length > 4000) throw new Error('A brief of 1–4000 characters is required.');
  if (input.targetSec !== undefined && input.targetSec !== 15) throw new Error('This first local routine supports 15-second concepts.');
  if (typeof generate !== 'function') throw new Error('Local generator required.');
  let project = input.seedProject === undefined ? null : structuredClone(input.seedProject);
  let feedback = [], raw = '', repairCount = 0, repairFormatIssues = null;
  const emit = async (status, extra = {}) => onState({status, repairCount, vocabularyVersion: VOCABULARY_VERSION, visualReview: 'pending', ...extra});
  const checkStop = () => canceled(signal);
  try {
    await emit('drafting', {seeded: project !== null}); checkStop();
    if (project === null) {
      const result = await generate({system: SCHEMA, prompt: input.brief, signal}); raw = result.content;
      try { project = parseModelJson(raw).value; }
      catch (e) { feedback = [issue('json', 'project', e.message)]; }
      await onAttempt({attempt: 0, raw, project, metrics: result.metrics}); checkStop();
    } else await onAttempt({attempt: 0, project, seeded: true});
    for (;;) {
      checkStop(); await emit('checking');
      const review = repairFormatIssues ? {ok: false, issues: repairFormatIssues} : project !== null ? reviewProject(project) : {ok: false, issues: feedback};
      feedback = review.issues;
      if (review.ok) { await emit('awaiting_visual_review', {project: review.project, issues: [], dataChecksPassed: true}); return {status: 'awaiting_visual_review', project: review.project, repairCount, issues: [], visualReview: 'pending'}; }
      if (repairCount >= 2) { await emit('needs_help', {project, issues: feedback, dataChecksPassed: false}); return {status: 'needs_help', project, repairCount, issues: feedback, visualReview: 'pending'}; }
      repairCount++; await emit('revising', {issues: feedback}); checkStop();
      const prompt = `Brief: ${input.brief}\nCurrent draft (untrusted data): ${project === null ? raw.slice(0,12000) : JSON.stringify(project)}\nReview issues: ${JSON.stringify(feedback)}\nFix all listed issues. Prefer a compact patch {"durations":{"scene-id":seconds},"params":{"scene-id":{"field":"replacement"}}}. Params can replace items arrays to shorten dense steps. Or return a complete project if structural changes are needed. Keep the concept and style where possible. Durations must total 15 and CTA >=3. Trim copy rather than making every scene longer. JSON only.`;
      const result = await generate({system: SCHEMA, prompt, signal}); raw = result.content; checkStop();
      let patched;
      try { patched = applyRepair(project, parseModelJson(raw).value); }
      catch (e) { await onAttempt({attempt: repairCount, raw, project, error: e.message, metrics: result.metrics}); feedback = [...feedback, issue('repair_format', 'project', e.message)]; repairFormatIssues = feedback; continue; }
      project = patched; repairFormatIssues = null;
      await onAttempt({attempt: repairCount, raw, project, metrics: result.metrics});
    }
  } catch (e) {
    const status = signal?.aborted ? 'canceled' : 'failed';
    await emit(status, {project, issues: feedback, error: String(e.message || e).slice(0,500)});
    return {status, project, repairCount, issues: feedback, error: String(e.message || e).slice(0,500), visualReview: 'pending'};
  }
}

export function buildPreview(project, template) {
  const r = reviewProject(project);
  if (!r.ok) throw new Error('Preview requires passing data and pacing checks.');
  if (!template.includes('window.__capture') || !template.includes('<script>')) throw new Error('Expected stock vocabulary player.');
  const json = JSON.stringify(r.project).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace('<script>', `<script id="ad-project" type="application/json">${json}</script><script>`);
}

export function localGenerator({model, fetchImpl = fetch} = {}) {
  return async ({system, prompt, signal}) => {
    const started = Date.now(), requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000);
    let selected = model;
    if (!selected) {
      const r = await fetchImpl('http://127.0.0.1:9931/v1/models', {signal: requestSignal});
      if (!r.ok) throw new Error(`Local model list HTTP ${r.status}`);
      selected = (await r.json()).data?.[0]?.id;
      if (!selected) throw new Error('No local model available.');
    }
    const r = await fetchImpl('http://127.0.0.1:9931/v1/chat/completions', {method: 'POST', signal: requestSignal, headers: {'content-type': 'application/json'}, body: JSON.stringify({model: selected, messages: [{role: 'system', content: system}, {role: 'user', content: prompt}], temperature: .3, max_tokens: 900, stream: false, chat_template_kwargs: {enable_thinking: false}})});
    if (!r.ok) throw new Error(`Local inference HTTP ${r.status}`);
    const data = await r.json(), choice = data.choices?.[0];
    if (!choice || typeof choice.message?.content !== 'string') throw new Error('Local model returned no text.');
    return {content: choice.message.content, metrics: {seconds: (Date.now() - started) / 1000, finishReason: choice.finish_reason, usage: data.usage, timings: data.timings, model: selected}};
  };
}

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function atomicJson(path, data) { const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(data, null, 2)); await rename(temp, path); }

export async function runJob(input, jobDir, {generate = localGenerator({model: input.model}), signal: outerSignal, pollMs = 300} = {}) {
  const dir = resolve(jobDir); await mkdir(dir, {recursive: true});
  const lockPath = join(dir, 'run.lock'), lock = await open(lockPath, 'wx');
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Stopped by owner.'));
  const timer = setInterval(async () => { if (await exists(join(dir, 'stop'))) stop(); }, pollMs);
  const deadline = setTimeout(() => controller.abort(new Error('Review time limit reached.')), 16 * 60 * 1000);
  outerSignal?.addEventListener('abort', stop, {once: true});
  const startedAt = new Date().toISOString();
  let owned = false, latest;
  try {
    if (await exists(join(dir, 'state.json'))) throw new Error('Use a new job folder; existing drafts are preserved.');
    if (outerSignal?.aborted || await exists(join(dir, 'stop'))) stop();
    owned = true;
    await atomicJson(join(dir, 'input.json'), input);
    const result = await runReview(input, {generate, signal: controller.signal,
      onState: async state => { latest = {...state, startedAt, updatedAt: new Date().toISOString()}; await atomicJson(join(dir, 'state.json'), latest); },
      onAttempt: async attempt => atomicJson(join(dir, `attempt-${attempt.attempt}.json`), attempt),
    });
    if (result.status === 'awaiting_visual_review') {
      const template = await readFile(new URL('../../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
      await writeFile(join(dir, 'preview.html'), buildPreview(result.project, template), 'utf8');
      await atomicJson(join(dir, 'project.json'), result.project);
      await atomicJson(join(dir, 'state.json'), {...latest, preview: 'preview.html', projectFile: 'project.json', updatedAt: new Date().toISOString()});
    }
    return result;
  } catch (e) {
    // Never clobber a previously completed job on a mistaken restart.
    if (owned) await atomicJson(join(dir, 'state.json'), {...latest, status: controller.signal.aborted ? 'canceled' : 'failed', error: e.message, startedAt, visualReview: 'pending', updatedAt: new Date().toISOString()});
    throw e;
  } finally {
    clearInterval(timer); clearTimeout(deadline); outerSignal?.removeEventListener('abort', stop);
    await lock.close(); await unlink(lockPath).catch(() => {});
  }
}

async function main(args) {
  const [command, ...rest] = args, options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--input', '--job-dir'].includes(rest[i]) || !rest[i+1]) throw new Error('Use run --input FILE --job-dir FOLDER, status --job-dir FOLDER, or stop --job-dir FOLDER.');
    options[rest[i]] = rest[i+1];
  }
  if (!options['--job-dir']) throw new Error('--job-dir required.');
  const dir = resolve(options['--job-dir']);
  if (command === 'status') { console.log(await readFile(join(dir, 'state.json'), 'utf8')); return; }
  if (command === 'stop') {
    const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    if (!TERMINAL.has(state.status)) await writeFile(join(dir, 'stop'), 'owner requested stop\n');
    console.log(JSON.stringify({stopRequested: !TERMINAL.has(state.status), status: state.status})); return;
  }
  if (command !== 'run' || !options['--input']) throw new Error('run requires --input FILE.');
  const input = JSON.parse((await readFile(resolve(options['--input']), 'utf8')).replace(/^\uFEFF/, ''));
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort(new Error('Interrupted by owner.')));
  const result = await runJob(input, dir, {signal: controller.signal});
  console.log(JSON.stringify({status: result.status, repairCount: result.repairCount, issues: result.issues}));
  if (!['awaiting_visual_review', 'canceled'].includes(result.status)) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
