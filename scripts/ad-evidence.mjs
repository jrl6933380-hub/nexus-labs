#!/usr/bin/env node
// Review evidence for one ad: a labelled frame for every scene, transition, call to action and the loop seam
// (lib/adEvidence.js picks them), plus one contact sheet. Frames come from the stock player's capture barrier, exactly
// like the MP4 export. Needs Node 20+ and Chromium via Playwright.
//
//   node scripts/ad-evidence.mjs --project ad.json --out evidence-dir [--max-frames 32] [--scale 1] [--images images.json] [--chromium /path]
//
// Writes <out>/frames/NN.png, <out>/sheet.png and <out>/evidence.json (shot list, coverage, frame hashes).
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planExport, projectFromInput, seedPlayerHtml, verifyCaptureInfo, verifyFrameAck, sha256Hex } from '../lib/adExport.js';
import { evidencePlan } from '../lib/adEvidence.js';

const PLAYER = fileURLToPath(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url));
const USAGE = 'Usage: node scripts/ad-evidence.mjs --project <file> --out <dir> [--max-frames 8-48] [--scale 1|2] [--images <file>] [--chromium <path>]';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  const project = projectFromInput(JSON.parse(await readFile(args.project, 'utf8')));
  const scale = Number(args.scale || 1);
  const plan = planExport(project, { scale, fps: 30 });
  const ev = evidencePlan(project, { maxFrames: args['max-frames'] === undefined ? undefined : Number(args['max-frames']) });
  const outDir = resolve(args.out);
  await mkdir(join(outDir, 'frames'), { recursive: true });
  let images = {};
  if (args.images) {
    const raw = JSON.parse(await readFile(args.images, 'utf8'));
    images = Array.isArray(raw) ? Object.fromEntries(raw.map((r) => [r.image_id, { src: r.data || r.src, source: r.source }])) : raw;
  }
  const workDir = await mkdtemp(join(tmpdir(), 'nexus-ad-evidence-'));
  let browser = null;
  try {
    const file = join(workDir, 'player.html');
    await writeFile(file, seedPlayerHtml(await readFile(PLAYER, 'utf8'), project, images));
    const chromium = await loadChromium();
    const executablePath = args.chromium || process.env.CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: plan.logicalWidth, height: plan.logicalHeight }, deviceScaleFactor: plan.scale });
    await context.route('**/*', (r) => (r.request().url().startsWith('file:') || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.goto(`${pathToFileURL(file).href}?capture=1`);
    await page.waitForFunction(() => typeof window.__capture === 'function');
    await page.evaluate(() => document.fonts.ready.then(() => true));
    verifyCaptureInfo(await page.evaluate(() => window.__captureInfo()), plan);
    const done = [];
    let prevSha = null;
    for (let i = 0; i < ev.shots.length; i++) {
      const shot = ev.shots[i];
      const result = await page.evaluate(async (t) => { const ack = await window.__capture(t); const d = document.getElementById('stage').dataset; return { ack, stampSeq: d.frameSeq, stampMs: d.frameMs }; }, shot.t_ms);
      verifyFrameAck(result, { index: i, timeMs: shot.t_ms });
      const png = await page.screenshot({ type: 'png' });
      const name = `frames/${String(i + 1).padStart(2, '0')}.png`;
      await writeFile(join(outDir, name), png);
      const sha256 = sha256Hex(png);
      done.push({ ...shot, file: name, sha256, bytes: png.length, same_as_previous: sha256 === prevSha, src: `data:image/png;base64,${png.toString('base64')}` });
      prevSha = sha256;
      process.stderr.write(`  ${Math.round(((i + 1) / ev.shots.length) * 100)}% (${i + 1}/${ev.shots.length} frames)\n`);
    }
    const finalInfo = await page.evaluate(() => window.__captureInfo());
    if (finalInfo.errors.length || errors.length) throw new Error(`The page logged errors: ${[...finalInfo.errors, ...errors].slice(0, 3).join(' | ')}`);
    const w = Math.round(plan.logicalWidth * 0.4);
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#0b0d12;color:#e8ecf4;font:12px system-ui}h1{font-size:15px;margin:0 0 10px}.g{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;width:${w}px}img{display:block;border-radius:6px;border:1px solid #2a3040}figcaption{margin-top:4px;line-height:1.3;color:#aab3c5}b{color:#fff}</style><h1>${esc(project.name)} — ${ev.shots.length} frames, ${(ev.totalMs / 1000).toFixed(1)}s</h1><div class="g">${done.map((s, i) => `<figure><img src="${s.src}" width="${w}"><figcaption><b>${i + 1}. ${(s.t_ms / 1000).toFixed(2)}s</b><br>${esc(s.label)}</figcaption></figure>`).join('')}</div>`;
    const sheetFile = join(workDir, 'sheet.html');
    await writeFile(sheetFile, html);
    const cols = Math.min(done.length, 8), width = Math.max(600, cols * (w + 10) + 32);
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
    const sheet = await ctx.newPage();
    await sheet.goto(pathToFileURL(sheetFile).href);
    await sheet.waitForLoadState('load');
    const sheetPng = await sheet.screenshot({ type: 'png', fullPage: true });
    await writeFile(join(outDir, 'sheet.png'), sheetPng);
    const report = { ok: true, project: project.name, format: plan.format, total_ms: ev.totalMs, coverage: ev.coverage,
      sheet: { file: 'sheet.png', bytes: sheetPng.length, sha256: sha256Hex(sheetPng) },
      shots: done.map(({ src, ...s }) => s) };
    await writeFile(join(outDir, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, out: outDir, frames: done.length, coverage: ev.coverage, sheet: report.sheet }));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(`evidence failed: ${e.message}`); process.exitCode = 1; });
