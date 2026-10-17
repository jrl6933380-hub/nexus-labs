#!/usr/bin/env node
// Render a vocabulary (v2) ad to MP4. Drives the stock player one frame at a time through its
// capture barrier, checks every frame's acknowledgement, pipes the PNG frames into ffmpeg, and
// writes a manifest next to the video. The concept badge is part of the player, so it is baked in.
//
// Needs: Node 20+, Chromium via Playwright (@playwright/test, playwright or playwright-core),
// and ffmpeg on PATH. It makes no network requests (the page blocks everything except file:/data:).
//
//   node scripts/export-ad-mp4.mjs --project ad.json --out ad.mp4 [--fps 30] [--scale 2] [--crf 18]
//        [--audio music.mp3] [--chromium /path/to/chrome]
//
// --project is a v2 project or a saved ad record (anything with .project); use - to read stdin.
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  planExport, projectFromInput, seedPlayerHtml, ffmpegArgs, frameTimeMs, verifyCaptureInfo,
  verifyFrameAck, pngSize, sha256Hex, framesFingerprint, buildManifest, defaultExportName,
} from '../lib/adExport.js';

const PLAYER = fileURLToPath(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url));
const USAGE = `Usage: node scripts/export-ad-mp4.mjs --project <file|-> --out <file.mp4> [--fps 24|30|60] [--scale 1|2|3] [--crf 12-28] [--audio <file>] [--chromium <path>]`;

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

// ffmpeg reads PNG frames from stdin. Writes respect backpressure and fail fast if ffmpeg dies.
function startFfmpeg(args) {
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '', failure = null, exitCode = null;
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  child.on('error', (e) => { failure = e.code === 'ENOENT' ? new Error('ffmpeg was not found on PATH.') : e; });
  child.stdin.on('error', (e) => { failure ||= e; });
  const closed = new Promise((res) => child.on('close', (code) => { exitCode = code; res(code); }));
  const check = () => {
    if (exitCode !== null && exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}: ${stderr.trim()}`);
    if (failure && !(failure.code === 'EPIPE' && exitCode === 0)) throw failure;
  };
  return {
    async write(buf) {
      check();
      if (!child.stdin.write(buf)) {
        await Promise.race([new Promise((r) => child.stdin.once('drain', r)), closed]);
        check();
      }
    },
    async finish() {
      child.stdin.end();
      await closed;
      check();
      if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}: ${stderr.trim()}`);
    },
    kill() { child.kill('SIGKILL'); },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.project || !args.out) throw new Error(USAGE);

  const project = projectFromInput(JSON.parse(await readInput(args.project)));
  const plan = planExport(project, { fps: args.fps, scale: args.scale, crf: args.crf, audio: args.audio });
  if (plan.audio) await access(plan.audio).catch(() => { throw new Error(`Audio file not found: ${plan.audio}`); });
  const outPath = resolve(args.out);
  const manifestPath = `${outPath.replace(/\.mp4$/i, '')}.manifest.json`;

  const workDir = await mkdtemp(join(tmpdir(), 'nexus-ad-export-'));
  let browser = null, ff = null, finished = false;
  try {
    const playerFile = join(workDir, 'player.html');
    await writeFile(playerFile, seedPlayerHtml(await readFile(PLAYER, 'utf8'), project));

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

    await page.goto(`${pathToFileURL(playerFile).href}?capture=1`);
    await page.waitForFunction(() => typeof window.__capture === 'function' && typeof window.__captureInfo === 'function');
    await page.evaluate(() => document.fonts.ready.then(() => true));
    verifyCaptureInfo(await page.evaluate(() => window.__captureInfo()), plan);

    ff = startFfmpeg(ffmpegArgs(plan, outPath));
    const hashes = [];
    let frameBytes = 0, nextReport = 0.1;
    for (let i = 0; i < plan.frames; i++) {
      const timeMs = frameTimeMs(plan, i);
      const result = await page.evaluate(async (ms) => {
        const ack = await window.__capture(ms);
        const stamp = document.getElementById('stage').dataset;
        return { ack, stampSeq: stamp.frameSeq, stampMs: stamp.frameMs };
      }, timeMs);
      verifyFrameAck(result, { index: i, timeMs });
      const png = await page.screenshot({ type: 'png' });
      if (i === 0) {
        const size = pngSize(png);
        if (size.width !== plan.width || size.height !== plan.height) throw new Error(`Screenshots are ${size.width}x${size.height}, expected ${plan.width}x${plan.height}.`);
        if (plan.concept && !(await page.evaluate(() => { const b = document.querySelector('.badge'); return !!b && !b.hidden; }))) {
          throw new Error('This is a concept ad, but its concept badge is not visible. Refusing to export.');
        }
      }
      hashes.push(sha256Hex(png));
      frameBytes += png.length;
      await ff.write(png);
      if ((i + 1) / plan.frames >= nextReport) { process.stderr.write(`  ${Math.round(((i + 1) / plan.frames) * 100)}% (${i + 1}/${plan.frames} frames)\n`); nextReport += 0.1; }
    }
    const finalInfo = await page.evaluate(() => window.__captureInfo());
    if (finalInfo.errors.length || pageErrors.length) throw new Error(`The page logged errors: ${[...finalInfo.errors, ...pageErrors].slice(0, 3).join(' | ')}`);
    await ff.finish();
    finished = true;

    const manifest = buildManifest(plan, project, { framesSha256: framesFingerprint(hashes), frameBytes });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, out: outPath, manifest: manifestPath, suggestedName: defaultExportName(project, plan), ...manifest }));
  } finally {
    if (ff && !finished) { ff.kill(); await rm(outPath, { force: true }); } // never leave a half-written video
    if (browser) await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(`export failed: ${e.message}`); process.exitCode = 1; });
