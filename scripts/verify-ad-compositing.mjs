#!/usr/bin/env node
// Stage 4c: real Chromium pixel checks and measured capacity; no account or network.
// node scripts/verify-ad-compositing.mjs --out test-results/compositing [--chromium /path]
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus } from 'node:os';
import { chromium } from '@playwright/test';
import { seedPlayerHtml, projectFromInput, sha256Hex } from '../lib/adExport.js';
import { decodePng } from '../lib/adBenchmark.js';
import { selectionReport } from '../lib/adSelect.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { capacityCases, calibrationSvg, keyedSubjectProject, nestedMaskProject } from '../lib/adCompositingCases.js';

const exec = promisify(execFile), args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--out', '--chromium'].includes(process.argv[i]) || !process.argv[i + 1]) throw Error('Use --out <dir> [--chromium <path>]');
  args[process.argv[i].slice(2)] = process.argv[i + 1];
}
const out = resolve(args.out || 'test-results/compositing');
await mkdir(out, { recursive: true });
const player = await readFile(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...((args.chromium || process.env.CHROMIUM_PATH) ? { executablePath: args.chromium || process.env.CHROMIUM_PATH } : {}) });
const checks = [], capacity = [], images = {}, runtimeErrors = [];
const report = { source: 'Stage 4c synthetic calibration, NOT camera footage', at: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, browser: browser.version(), viewport: '560x560', scale: 1 }, checks, capacity };
const json = async (file, value) => writeFile(join(out, file), JSON.stringify(value, null, 2) + '\n');
const check = async (name, fn) => {
  try { const evidence = await fn(); checks.push({ name, pass: true, ...evidence }); }
  catch (e) { checks.push({ name, pass: false, error: e.message }); }
  console.log(JSON.stringify(checks.at(-1)));
};
const pixel = (img, x, y) => [...img.data.subarray((Math.floor(y * img.height / 100) * img.width + Math.floor(x * img.width / 100)) * img.channels,
  (Math.floor(y * img.height / 100) * img.width + Math.floor(x * img.width / 100)) * img.channels + img.channels)];
const alpha = (img, x, y) => img.channels === 4 ? pixel(img, x, y)[3] : 255;
const exact = (a, b) => {
  const A = decodePng(a), B = decodePng(b);
  assert.equal(A.width, B.width); assert.equal(A.height, B.height); assert.equal(A.channels, B.channels);
  assert.ok(A.data.equals(B.data), 'decoded frame pixels differ');
};
async function pageFor(project, name, query = '') {
  projectFromInput(project);
  const file = join(out, `${name}.html`);
  await writeFile(file, seedPlayerHtml(player, project, images));
  const ctx = await browser.newContext({ viewport: { width: 560, height: 560 }, deviceScaleFactor: 1 });
  await ctx.route('**/*', route => /^(file|data):/.test(route.request().url()) ? route.continue() : route.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => runtimeErrors.push(e.message));
  await page.goto(`${pathToFileURL(file).href}?capture=1${query}`);
  await page.waitForFunction(() => typeof window.__capture === 'function');
  return { ctx, page };
}
async function frame(page, ms, file, transparent = false) {
  await page.evaluate(ms => window.__capture(ms), ms);
  const png = await page.screenshot({ type: 'png', omitBackground: transparent });
  if (file) await writeFile(join(out, file), png);
  return png;
}
const cli = async (script, options) => {
  const r = await exec(process.execPath, [script, ...options, ...(args.chromium ? ['--chromium', args.chromium] : [])], { maxBuffer: 2e6 });
  return r.stdout;
};

try {
  // Produce a declared synthetic greenscreen fixture and a genuinely decoded video,
  // without an external asset download. The PNG and clip are persisted as evidence.
  const assetPage = await browser.newPage();
  for (let i = 0; i < 24; i++) {
    const url = await assetPage.evaluate(async svg => {
      const image = new Image(); image.src = 'data:image/svg+xml,' + encodeURIComponent(svg); await image.decode();
      const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').drawImage(image, 0, 0); return c.toDataURL('image/png');
    }, calibrationSvg(Math.round(Math.sin(i / 24 * 2 * Math.PI) * 8)));
    await writeFile(join(out, `source-${String(i).padStart(2, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    if (!i) images['med-keysubject'] = { src: url, source: 'uploaded' };
  }
  await assetPage.close();
  await exec('ffmpeg', ['-v', 'error', '-y', '-framerate', '24', '-i', join(out, 'source-%02d.png'), '-c:v', 'libvpx-vp9', '-lossless', '1', '-pix_fmt', 'yuv420p', join(out, 'synthetic.webm')]);
  images['med-keyclip1'] = { src: 'data:video/webm;base64,' + (await readFile(join(out, 'synthetic.webm'))).toString('base64'), source: 'uploaded' };
  await json('images.json', images);
  const subject = keyedSubjectProject(), nested = nestedMaskProject();
  await json('keyed-subject.json', subject);
  await check('nested parent keep + animated cut + child keep intersect in pixels', async () => {
    const { page, ctx } = await pageFor(nested, 'nested', '&transparent=1');
    try {
      const before = decodePng(await frame(page, 0, 'nested-before.png', true));
      const after = decodePng(await frame(page, 1000, 'nested-after.png', true));
      assert.equal(alpha(before, 50, 52), 255, 'child was visible before hole moves');
      assert.equal(alpha(after, 50, 52), 0, 'parent cut must hide child');
      assert.equal(alpha(after, 30, 60), 255, 'inside every mask');
      assert.equal(alpha(after, 20, 60), 0, 'outside outer keep');
      assert.equal(alpha(after, 50, 40), 0, 'outside child keep');
      assert.equal(alpha(after, 50, 80), 0, 'outside outer bottom');
      return { probes: 6 };
    } finally { await ctx.close(); }
  });
  for (const [name, project] of [['nested', nested], ['keyed-still', subject], ['keyed-video', keyedSubjectProject(true)]]) {
    await check(`${name}: forward, reverse and shuffled seeks agree`, async () => {
      const { page, ctx } = await pageFor(project, `${name}-seeks`, '&transparent=1');
      try {
        const times = [0, 250, 500, 1000, 1500, 2750], frames = new Map();
        // Warm the compositor across hidden and revealed media states before the
        // exact seek-order comparison. Record cold-start raster variance separately.
        const cold = await frame(page, 0, `${name}-cold.png`, true);
        await frame(page, 2750, null, true);
        const warm = await frame(page, 0, `${name}-warm.png`, true);
        const A = decodePng(cold), B = decodePng(warm);
        let changedPixels = 0, maxChannelDelta = 0;
        for (let i = 0; i < A.data.length; i += A.channels) {
          let changed = false;
          for (let c = 0; c < A.channels; c++) {
            const d = Math.abs(A.data[i + c] - B.data[i + c]);
            if (d) changed = true; maxChannelDelta = Math.max(maxChannelDelta, d);
          }
          if (changed) changedPixels++;
        }
        assert.ok(changedPixels / (A.width * A.height) <= 0.0005 && maxChannelDelta <= 16,
          `cold compositor variance exceeds tolerance: ${changedPixels} pixels, delta ${maxChannelDelta}`);
        for (const ms of times) frames.set(ms, await frame(page, ms, null, true));
        for (const ms of [...times].reverse().concat([1500, 0, 2750, 500, 1000, 250])) exact(frames.get(ms), await frame(page, ms, null, true));
        return { timesMs: times, comparisons: 12, exactAfterWarmup: true,
          coldStart: { changedPixels, maxChannelDelta, tolerance: 'at most 0.05% pixels, at most 16/255 per channel' } };
      } finally { await ctx.close(); }
    });
  }
  await check('keyed output removes green, keeps subject, and keeps real alpha', async () => {
    const p = structuredClone(subject); p.scenes[0].params.layers = p.scenes[0].params.layers.filter(l => l.id === 'subject');
    const { page, ctx } = await pageFor(p, 'alpha-subject', '&transparent=1');
    try {
      const png = await frame(page, 1500, 'transparent.png', true), img = decodePng(png);
      assert.equal(img.channels, 4); assert.equal(alpha(img, 5, 5), 0); assert.equal(alpha(img, 25, 35), 0);
      assert.ok(alpha(img, 50, 55) > 240, 'robot body stays opaque');
      let partial = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0 && img.data[i] < 255) partial++;
      assert.ok(partial > 0, 'antialiased edge alpha');
      return { partialAlphaPixels: partial, sha256: sha256Hex(png) };
    } finally { await ctx.close(); }
  });
  await check('selection colours locate subject and backdrop', async () => {
    const { page, ctx } = await pageFor(subject, 'selection', '&select=1');
    try {
      const png = await frame(page, 1500, 'selection.png');
      const sel = await page.evaluate(() => window.__sel), r = selectionReport(png, sel.layers);
      assert.ok(r.layers.find(l => l.id === 'subject').pixels > 0); assert.ok(r.layers.find(l => l.id === 'backdrop').pixels > 0);
      await json('selection.json', r); return { layers: r.layers.length };
    } finally { await ctx.close(); }
  });
  await check('missing matte image refuses capture instead of exposing an unmasked layer', async () => {
    const p = structuredClone(subject);
    p.scenes[0].params.layers.find(l => l.id === 'subject').matteImage = 'med-missing1';
    await assert.rejects(pageFor(p, 'missing-matte'), /Missing library images: med-missing1/);
    return { refused: true, stage: 'export asset preflight' };
  });
  await check('live preview renderAdFrame matches capture + still + sequence at the same time', async () => {
    const { page, ctx } = await pageFor(subject, 'preview-agreement');
    try {
      await frame(page, 0);
      await page.evaluate(project => window.renderAdFrame({ timeMs: 1500, durationMs: 6000, sceneId: 'composite', sceneProgress: 0.375, sceneIndex: 0, project, width: 560, height: 560, format: 'square' }), subject);
      await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('canvas[data-key]')].map(c => c._k.sync())); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
      const preview = await page.screenshot({ type: 'png' }); await writeFile(join(out, 'preview.png'), preview);
      exact(preview, await frame(page, 1500, 'capture.png'));
      await cli('scripts/export-ad-still.mjs', ['--project', join(out, 'keyed-subject.json'), '--images', join(out, 'images.json'), '--out', join(out, 'still.png'), '--at', '1.5', '--scale', '1']);
      exact(preview, await readFile(join(out, 'still.png')));
      await cli('scripts/export-ad-sequence.mjs', ['--project', join(out, 'keyed-subject.json'), '--images', join(out, 'images.json'), '--out', join(out, 'sequence'), '--from', '1.5', '--to', '1.625', '--fps', '24', '--scale', '1']);
      exact(preview, await readFile(join(out, 'sequence/frame-000001.png')));
      return { comparisons: 3, note: 'Decoded PNG equality; lossy encoded MP4 pixels are not claimed identical.' };
    } finally { await ctx.close(); }
  });
  await check('layer review pack renders final, map, original, foreground and matte', async () => {
    await cli('scripts/ad-layer-views.mjs', ['--project', join(out, 'keyed-subject.json'), '--images', join(out, 'images.json'), '--out', join(out, 'review'), '--scene', 'composite', '--progress', '0.375', '--scale', '1']);
    const r = JSON.parse(await readFile(join(out, 'review/views.json')));
    assert.deepEqual(r.keyed_layers, ['subject']); assert.equal(r.views.length, 5); assert.equal(r.skipped.length, 0);
    return { sheet: 'review/sheet.png', views: r.views };
  });
  await check('encoded MP4 dimensions, duration, codec and sampled frame match within lossy tolerance', async () => {
    await cli('scripts/export-ad-mp4.mjs', ['--project', join(out, 'keyed-subject.json'), '--images', join(out, 'images.json'), '--out', join(out, 'demo.mp4'), '--fps', '24', '--scale', '1', '--crf', '18']);
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(out, 'demo.mp4')]);
    const probe = JSON.parse(stdout), video = probe.streams.find(s => s.codec_type === 'video');
    assert.equal(video.codec_name, 'h264'); assert.equal(video.pix_fmt, 'yuv420p');
    assert.equal(video.width, 560); assert.equal(video.height, 560); assert.equal(video.avg_frame_rate, '24/1');
    assert.ok(Math.abs(Number(probe.format.duration) - 6) < 0.05);
    await exec('ffmpeg', ['-v', 'error', '-y', '-i', join(out, 'demo.mp4'), '-vf', 'select=eq(n\\,36)', '-frames:v', '1', join(out, 'mp4-frame36.png')]);
    const A = decodePng(await readFile(join(out, 'preview.png'))), B = decodePng(await readFile(join(out, 'mp4-frame36.png')));
    let sum = 0; for (let p = 0; p < A.width * A.height; p++) for (let c = 0; c < 3; c++) sum += Math.abs(A.data[p * A.channels + c] - B.data[p * B.channels + c]);
    const meanAbsoluteRgbError = sum / (A.width * A.height * 3);
    assert.ok(meanAbsoluteRgbError < 4, `mean RGB error ${meanAbsoluteRgbError} exceeds 4/255`);
    return { codec: video.codec_name, width: video.width, height: video.height, seconds: Number(probe.format.duration), frame: 36, meanAbsoluteRgbError, tolerance: 'mean absolute RGB error < 4/255, H.264 is lossy' };
  });
  // Capture includes fonts/media sync and two paints, then screenshots. This is
  // end-to-end offline frame latency, not an assertion of live FPS on a phone.
  for (const c of capacityCases()) {
    const errorsBefore = runtimeErrors.length;
    const { page, ctx } = await pageFor(c.project, `capacity-${c.id}`);
    try {
      await frame(page, 0); await frame(page, 100); // warmup
      const samples = [];
      for (let i = 0; i < 7; i++) {
        const start = performance.now(); await frame(page, 150 + i * 125);
        samples.push(performance.now() - start);
      }
      const info = await page.evaluate(() => window.__captureInfo());
      assert.deepEqual(info.errors, []); assert.equal(runtimeErrors.length, errorsBefore);
      samples.sort((a, b) => a - b);
      const row = { id: c.id, layers: c.project.scenes[0].params.layers.length,
        expandedShapes: c.project.scenes[0].params.layers.reduce((n, l) => n + (l.count || l.emit || 1), 0),
        samples: samples.length, medianFrameMs: +samples[3].toFixed(2), p95FrameMs: +samples[6].toFixed(2),
        metric: 'capture barrier + PNG screenshot wall time; warmed; offline; not live FPS' };
      capacity.push(row); console.log(JSON.stringify(row));
    } finally { await ctx.close(); }
  }
  await check('hard capacity limits refuse instead of silently dropping', async () => {
    const plain = capacityCases().find(c => c.id === 'plain-2048').project;
    assert.equal(validateProjectV2(plain).ok, true);
    const tooMany = structuredClone(plain); tooMany.scenes[0].params.layers.push({ id: 'overflow', shape: 'circle', x: 50, y: 50, w: 1 });
    assert.equal(validateProjectV2(tooMany).ok, false);
    const expanded = capacityCases().find(c => c.id === 'expanded-9984').project;
    assert.equal(validateProjectV2(expanded).ok, true);
    expanded.scenes[0].params.layers.push({ id: 'overflow', shape: 'circle', x: 50, y: 50, w: 1, count: 24 });
    assert.equal(validateProjectV2(expanded).ok, false);
    return { layerLimit: 2048, expandedLimit: 10000 };
  });
  await check('browser reports no runtime errors', async () => { assert.deepEqual(runtimeErrors, []); return {}; });
} catch (e) {
  checks.push({ name: 'runner infrastructure', pass: false, error: e.stack || e.message });
} finally {
  await browser.close();
  report.pass = checks.length > 0 && checks.every(c => c.pass) && capacity.length === capacityCases().length;
  await json('report.json', report);
  console.log(JSON.stringify({ pass: report.pass, checks: checks.length, failures: checks.filter(c => !c.pass), report: join(out, 'report.json') }));
  if (!report.pass) process.exitCode = 1;
}
