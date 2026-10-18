#!/usr/bin/env node
// Render a contact sheet of the graphic engine demos (lib/adGraphicDemos.js): several frames of each demo
// in one PNG, so a person can review everything the engine can do at a glance. Frames come from the stock
// player's capture barrier, exactly like the exporters. Needs Node 20+ and Chromium via Playwright.
//
//   node scripts/ad-review-sheet.mjs --out sheet.png [--demo fight] [--scale 1] [--chromium /path/to/chrome]
//
// With --project <file> it renders that one project instead (shots at 10%, 40%, 70% and 95% of the ad).
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planExport, projectFromInput, seedPlayerHtml, verifyCaptureInfo, verifyFrameAck } from '../lib/adExport.js';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const PLAYER = fileURLToPath(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url));
const USAGE = 'Usage: node scripts/ad-review-sheet.mjs --out <file.png> [--demo <name> | --project <file>] [--scale 1|2] [--chromium <path>]';
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
    try {
      const mod = await import(name);
      const chromium = mod.chromium || (mod.default && mod.default.chromium);
      if (chromium) return chromium;
    } catch { /* next */ }
  }
  throw new Error('Playwright was not found. Run npm install (it is a dev dependency) or install playwright-core.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.out) throw new Error(USAGE);
  const scale = Number(args.scale || 1);
  let demos;
  if (args.project) {
    const project = projectFromInput(JSON.parse(await readFile(args.project, 'utf8')));
    const total = project.scenes.reduce((n, s) => n + s.duration * 1000, 0);
    demos = [['project', { title: project.name, project, shots: [0.1, 0.4, 0.7, 0.95].map((f) => Math.round(total * f)) }]];
  } else if (args.demo) {
    if (!GRAPHIC_DEMOS[args.demo]) throw new Error(`Unknown demo "${args.demo}". Demos: ${Object.keys(GRAPHIC_DEMOS).join(', ')}`);
    demos = [[args.demo, GRAPHIC_DEMOS[args.demo]]];
  } else demos = Object.entries(GRAPHIC_DEMOS);

  const workDir = await mkdtemp(join(tmpdir(), 'nexus-ad-sheet-'));
  let browser = null;
  try {
    const chromium = await loadChromium();
    const executablePath = args.chromium || process.env.CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(executablePath ? { executablePath } : {}) });
    const player = await readFile(PLAYER, 'utf8');
    const rows = [];
    for (const [name, demo] of demos) {
      const plan = planExport(demo.project, { scale });
      const file = join(workDir, `${name}.html`);
      await writeFile(file, seedPlayerHtml(player, demo.project));
      const context = await browser.newContext({ viewport: { width: plan.logicalWidth, height: plan.logicalHeight }, deviceScaleFactor: plan.scale });
      await context.route('**/*', (r) => (r.request().url().startsWith('file:') || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
      await page.goto(`${pathToFileURL(file).href}?capture=1`);
      await page.waitForFunction(() => typeof window.__capture === 'function');
      verifyCaptureInfo(await page.evaluate(() => window.__captureInfo()), plan);
      const frames = [];
      let seq = 0;
      for (const ms of demo.shots) {
        const result = await page.evaluate(async (t) => { const ack = await window.__capture(t); const d = document.getElementById('stage').dataset; return { ack, stampSeq: d.frameSeq, stampMs: d.frameMs }; }, ms);
        verifyFrameAck(result, { index: seq++, timeMs: ms });
        frames.push({ ms, src: `data:image/png;base64,${(await page.screenshot({ type: 'png' })).toString('base64')}` });
      }
      if (errors.length) throw new Error(`Demo ${name} logged page errors: ${errors.slice(0, 3).join(' | ')}`);
      await context.close();
      rows.push({ name, title: demo.title, w: plan.logicalWidth, h: plan.logicalHeight, frames });
    }

    const cell = (r, f) => `<figure><img src="${f.src}" width="${Math.round(r.w * 0.5)}"><figcaption>${(f.ms / 1000).toFixed(2)}s</figcaption></figure>`;
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#0b0d12;color:#e8ecf4;font:14px system-ui}h2{margin:18px 0 8px;font-size:16px}.row{display:flex;gap:10px;flex-wrap:wrap}figure{margin:0}img{display:block;border-radius:6px}figcaption{opacity:.6;font-size:12px;padding:3px 0}</style><body>${rows.map((r) => `<h2>${esc(r.title)} <small style="opacity:.5">(${esc(r.name)})</small></h2><div class="row">${r.frames.map((f) => cell(r, f)).join('')}</div>`).join('')}</body>`;
    const sheetFile = join(workDir, 'sheet.html');
    await writeFile(sheetFile, html);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 800 }, deviceScaleFactor: 1 });
    const sheet = await ctx.newPage();
    await sheet.goto(pathToFileURL(sheetFile).href);
    await sheet.waitForLoadState('load');
    const png = await sheet.screenshot({ type: 'png', fullPage: true });
    await writeFile(resolve(args.out), png);
    console.log(JSON.stringify({ ok: true, out: resolve(args.out), demos: rows.map((r) => r.name), frames: rows.reduce((n, r) => n + r.frames.length, 0), bytes: png.length }));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(`review sheet failed: ${e.message}`); process.exitCode = 1; });
