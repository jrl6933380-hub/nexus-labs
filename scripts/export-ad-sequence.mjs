#!/usr/bin/env node
// Render a time range of a vocabulary (v2) ad as a numbered PNG sequence (frame-000001.png ...), optionally with real alpha.
// Same capture barrier as the MP4 and still exporters, so a frame here is byte-identical to the same moment in the MP4.
// Writes <out>/sequence.manifest.json with every frame's time and SHA-256.
//
//   node scripts/export-ad-sequence.mjs --project ad.json --out frames-dir [--from 0] [--to 2] [--fps 24] [--scale 1]
//        [--transparent 1] [--images images.json] [--chromium /path/to/chrome]
//
// Concept ads keep their visible concept badge (it is part of the player), transparent or not.
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planSequence, sequenceFrameMs, projectFromInput, seedPlayerHtml, verifyCaptureInfo, verifyFrameAck, pngSize, sha256Hex, framesFingerprint } from '../lib/adExport.js';

const PLAYER = fileURLToPath(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url));
const USAGE = 'Usage: node scripts/export-ad-sequence.mjs --project <file|-> --out <dir> [--from s] [--to s] [--fps 24|30|60] [--scale 1|2|3] [--transparent 1] [--images <file>] [--chromium <path>]';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`${a} needs a value`);
    out[a.slice(2)] = v;
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
    try { const mod = await import(name); const c = mod.chromium || (mod.default && mod.default.chromium); if (c) return c; } catch { /* next */ }
  }
  throw new Error('Playwright was not found. Run npm install or install playwright-core.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.project || !args.out) throw new Error(USAGE);
  const project = projectFromInput(JSON.parse(await readInput(args.project)));
  const transparent = args.transparent === '1' || args.transparent === 'true';
  const plan = planSequence(project, { from: args.from, to: args.to, fps: args.fps, scale: args.scale });
  const outDir = resolve(args.out);
  await mkdir(outDir, { recursive: true });

  const workDir = await mkdtemp(join(tmpdir(), 'nexus-ad-seq-'));
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
    await context.route('**/*', (route) => { const url = route.request().url(); return url.startsWith('file:') || url.startsWith('data:') ? route.continue() : route.abort(); });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
    await page.goto(`${pathToFileURL(playerFile).href}?capture=1${transparent ? '&transparent=1' : ''}`);
    await page.waitForFunction(() => typeof window.__capture === 'function' && typeof window.__captureInfo === 'function');
    await page.evaluate(() => document.fonts.ready.then(() => true));
    verifyCaptureInfo(await page.evaluate(() => window.__captureInfo()), plan);

    const frames = [], hashes = [];
    let bytes = 0, nextReport = 0.1;
    for (let i = 0; i < plan.frames; i++) {
      const timeMs = sequenceFrameMs(plan, i);
      const result = await page.evaluate(async (ms) => {
        const ack = await window.__capture(ms);
        const stamp = document.getElementById('stage').dataset;
        return { ack, stampSeq: stamp.frameSeq, stampMs: stamp.frameMs };
      }, timeMs);
      verifyFrameAck(result, { index: i, timeMs });
      const png = await page.screenshot({ type: 'png', omitBackground: transparent });
      if (i === 0) {
        const size = pngSize(png);
        if (size.width !== plan.width || size.height !== plan.height) throw new Error(`Screenshots are ${size.width}x${size.height}, expected ${plan.width}x${plan.height}.`);
        if (plan.concept && !(await page.evaluate(() => { const b = document.querySelector('.badge'); return !!b && !b.hidden; }))) throw new Error('This is a concept ad, but its concept badge is not visible. Refusing to export.');
      }
      const name = `frame-${String(i + 1).padStart(6, '0')}.png`;
      await writeFile(join(outDir, name), png);
      const sha = sha256Hex(png);
      frames.push({ file: name, timeMs: Math.round(timeMs * 1000) / 1000, sha256: sha }); hashes.push(sha); bytes += png.length;
      if ((i + 1) / plan.frames >= nextReport) { process.stderr.write(`  ${Math.round(((i + 1) / plan.frames) * 100)}% (${i + 1}/${plan.frames} frames)\n`); nextReport += 0.1; }
    }
    const finalInfo = await page.evaluate(() => window.__captureInfo());
    if (finalInfo.errors.length || pageErrors.length) throw new Error(`The page logged errors: ${[...finalInfo.errors, ...pageErrors].slice(0, 3).join(' | ')}`);
    const manifest = {
      tool: 'scripts/export-ad-sequence.mjs', vocabularyVersion: plan.vocabularyVersion, name: project.name, format: plan.format, concept: plan.concept,
      transparent, fps: plan.fps, scale: plan.scale, width: plan.width, height: plan.height, from: plan.startMs / 1000, to: plan.endMs / 1000,
      frameCount: plan.frames, frameBytes: bytes, projectSha256: sha256Hex(JSON.stringify(project)), framesSha256: framesFingerprint(hashes), frames,
    };
    await writeFile(join(outDir, 'sequence.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, out: outDir, manifest: join(outDir, 'sequence.manifest.json'), frameCount: plan.frames, framesSha256: manifest.framesSha256 }));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(`export failed: ${e.message}`); process.exitCode = 1; });
