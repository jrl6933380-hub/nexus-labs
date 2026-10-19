#!/usr/bin/env node
// Render one frame of a vocabulary (v2) ad to a PNG (poster, thumbnail, preview). Uses the same
// capture barrier and checks as scripts/export-ad-mp4.mjs, so the still is exactly the frame the video
// would show at that time. The concept badge is part of the player, so it is baked in.
//
// Needs: Node 20+ and Chromium via Playwright (@playwright/test, playwright or playwright-core).
// No ffmpeg. It makes no network requests (the page blocks everything except file:/data:).
//
//   node scripts/export-ad-still.mjs --project ad.json --out still.png [--at 3.5 | --scene hook [--progress 0.85]]
//        [--scale 2] [--images images.json] [--chromium /path/to/chrome]
//        [--view selection]   a flat-colour layer-ID map (graphic scenes) plus <out>.selection.json: id, colour, area and position of every layer
//
// --project is a v2 project or a saved ad record (anything with .project); use - to read stdin.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  planStill, projectFromInput, seedPlayerHtml, verifyCaptureInfo, verifyFrameAck, pngSize, sha256Hex,
  defaultStillName,
} from '../lib/adExport.js';
import { selectionReport } from '../lib/adSelect.js';

const PLAYER = fileURLToPath(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url));
const USAGE = `Usage: node scripts/export-ad-still.mjs --project <file|-> --out <file.png> [--at <seconds> | --scene <id> [--progress 0-1]] [--scale 1|2|3] [--images <file>] [--view selection] [--chromium <path>]`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${a} needs a value`);
    out[a.slice(2)] = value;
  }
  return out;
}

async function readInput(path) {
  if (path !== '-') return readFile(path, 'utf8');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function loadChromium() {
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    try {
      const mod = await import(name);
      const chromium = mod.chromium || (mod.default && mod.default.chromium);
      if (chromium) return chromium;
    } catch { /* try the next package */ }
  }
  throw new Error('Playwright was not found. Run npm install (it is a dev dependency) or install playwright-core.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.project || !args.out) throw new Error(USAGE);

  const project = projectFromInput(JSON.parse(await readInput(args.project)));
  const selection = args.view === 'selection';
  if (args.view !== undefined && !selection) throw new Error('--view must be "selection"');
  const plan = planStill(project, { at: args.at, scene: args.scene, progress: args.progress, scale: selection ? 1 : args.scale });
  const outPath = resolve(args.out);
  const manifestPath = `${outPath.replace(/\.png$/i, '')}.manifest.json`;

  const workDir = await mkdtemp(join(tmpdir(), 'nexus-ad-still-'));
  let browser = null;
  try {
    const playerFile = join(workDir, 'player.html');
    let images = {};
    if (args.images) {
      const raw = JSON.parse(await readFile(args.images, 'utf8'));
      images = Array.isArray(raw) ? Object.fromEntries(raw.map((r) => [r.image_id, { src: r.data || r.src, source: r.source }])) : raw;
    }
    await writeFile(playerFile, seedPlayerHtml(await readFile(PLAYER, 'utf8'), project, images));

    const chromium = await loadChromium();
    const executablePath = args.chromium || process.env.CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: plan.logicalWidth, height: plan.logicalHeight }, deviceScaleFactor: plan.scale });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith('file:') || url.startsWith('data:') ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

    await page.goto(`${pathToFileURL(playerFile).href}?capture=1${selection ? '&select=1' : ''}`);
    await page.waitForFunction(() => typeof window.__capture === 'function' && typeof window.__captureInfo === 'function');
    await page.evaluate(() => document.fonts.ready.then(() => true));
    verifyCaptureInfo(await page.evaluate(() => window.__captureInfo()), plan);

    const result = await page.evaluate(async (ms) => {
      const ack = await window.__capture(ms);
      const stamp = document.getElementById('stage').dataset;
      return { ack, stampSeq: stamp.frameSeq, stampMs: stamp.frameMs };
    }, plan.timeMs);
    verifyFrameAck(result, { index: 0, timeMs: plan.timeMs });
    if (plan.concept && !(await page.evaluate(() => { const b = document.querySelector('.badge'); return !!b && !b.hidden; }))) {
      throw new Error('This is a concept ad, but its concept badge is not visible. Refusing to export.');
    }
    const png = await page.screenshot({ type: 'png' });
    const size = pngSize(png);
    if (size.width !== plan.width || size.height !== plan.height) throw new Error(`Screenshot is ${size.width}x${size.height}, expected ${plan.width}x${plan.height}.`);
    const finalInfo = await page.evaluate(() => window.__captureInfo());
    if (finalInfo.errors.length || pageErrors.length) throw new Error(`The page logged errors: ${[...finalInfo.errors, ...pageErrors].slice(0, 3).join(' | ')}`);

    let selectionFile = null;
    if (selection) {
      const sel = await page.evaluate(() => window.__sel || null);
      if (!sel) throw new Error('This moment is not in a graphic scene, so there is no selection map. Selection maps cover graphic scenes only.');
      const report = selectionReport(png, sel.layers);
      selectionFile = `${outPath.replace(/\.png$/i, '')}.selection.json`;
      await writeFile(selectionFile, `${JSON.stringify({ tool: 'scripts/export-ad-still.mjs --view selection', version: sel.version, sceneId: sel.sceneId, timeMs: plan.timeMs, note: 'Colours identify layers only. They are not artwork and not alpha. Anonymous layers (no id) are listed as #index and cannot be patched until given an id.', ...report }, null, 2)}\n`);
    }
    const manifest = {
      tool: 'scripts/export-ad-still.mjs',
      ...(selection ? { view: 'selection', selectionFile } : {}),
      vocabularyVersion: plan.vocabularyVersion,
      name: project.name,
      format: plan.format,
      concept: plan.concept,
      timeMs: plan.timeMs,
      scale: plan.scale,
      width: plan.width,
      height: plan.height,
      projectSha256: sha256Hex(JSON.stringify(project)),
      pngSha256: sha256Hex(png),
      bytes: png.length,
    };
    await writeFile(outPath, png);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, out: outPath, manifest: manifestPath, suggestedName: defaultStillName(project, plan), ...manifest }));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(`export failed: ${e.message}`); process.exitCode = 1; });
