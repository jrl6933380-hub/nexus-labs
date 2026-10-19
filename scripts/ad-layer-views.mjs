#!/usr/bin/env node
// Layer review pack for one moment of a graphic scene: the final frame, the colour-coded selection map (+ legend json), and for
// each keyed layer the original / foreground (over a checkerboard) / matte views, tied together in one labelled sheet.png.
// Built on scripts/export-ad-still.mjs, so every view is exactly what the export would draw.
//
//   node scripts/ad-layer-views.mjs --project ad.json --out dir [--scene s1 [--progress 0.85] | --at 3.5] [--scale 1|2]
//        [--layers id1,id2] [--images images.json] [--chromium /path]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { projectFromInput } from '../lib/adExport.js';
import { keyViews } from '../lib/adLayers.js';

const STILL = fileURLToPath(new URL('./export-ad-still.mjs', import.meta.url));
const USAGE = 'Usage: node scripts/ad-layer-views.mjs --project <file> --out <dir> [--scene <id> [--progress 0-1] | --at <sec>] [--scale 1|2] [--layers a,b] [--images <file>] [--chromium <path>]';
const MAX_KEYED = 4;

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--help') { o.help = true; continue; } if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`); const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); o[a.slice(2)] = v; }
  return o;
}
function still(args, projectFile, out, extra) {
  return new Promise((res, rej) => {
    const argv = [STILL, '--project', projectFile, '--out', out, '--scale', String(args.scale || 1), ...(args.images ? ['--images', args.images] : []), ...(args.chromium ? ['--chromium', args.chromium] : []), ...extra];
    const c = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; c.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    c.on('error', rej);
    c.on('close', (code) => code === 0 ? res() : rej(new Error(`export-ad-still failed (exit ${code}). ${(err.trim().split('\n').pop() || '').slice(0, 300)}`)));
  });
}
async function loadChromium() {
  for (const n of ['@playwright/test', 'playwright', 'playwright-core']) { try { const m = await import(n); const c = m.chromium || (m.default && m.default.chromium); if (c) return c; } catch { /* next */ } }
  throw new Error('Playwright was not found.');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.project || !args.out) throw new Error(USAGE);
  const project = projectFromInput(JSON.parse(await readFile(args.project, 'utf8')));
  const scene = args.scene ? project.scenes.find((s) => s.id === args.scene) : project.scenes.find((s) => s.type === 'graphic');
  if (!scene || scene.type !== 'graphic') throw new Error(`No graphic scene${args.scene ? ` "${args.scene}"` : ''} in this ad. Layer views cover graphic scenes only.`);
  const when = args.at !== undefined ? ['--at', String(args.at)] : ['--scene', scene.id, '--progress', String(args.progress ?? 0.85)];
  const dir = resolve(args.out); await mkdir(dir, { recursive: true });
  const work = join(dir, '_work'); await mkdir(work, { recursive: true });
  const tiles = [];
  const write = (name, obj) => writeFile(join(work, name), JSON.stringify(obj));

  await still(args, args.project, join(dir, 'final.png'), when); tiles.push({ file: 'final.png', label: 'Final' });
  await still(args, args.project, join(dir, 'selection.png'), [...when, '--view', 'selection']);
  tiles.push({ file: 'selection.png', label: 'Selection map (colour = layer id)' });
  const sel = JSON.parse(await readFile(join(dir, 'selection.selection.json'), 'utf8'));
  await writeFile(join(dir, 'selection.json'), JSON.stringify(sel, null, 2));

  const layers = scene.params.layers || [];
  const wanted = args.layers ? args.layers.split(',').filter(Boolean) : layers.filter((l) => l.id && l.key).map((l) => l.id);
  const keyed = []; const skipped = [];
  for (const id of wanted) {
    if (keyed.length >= MAX_KEYED) { skipped.push({ id, reason: `only ${MAX_KEYED} keyed layers per pack` }); continue; }
    const r = keyViews(project, { sceneId: scene.id, layerId: id });
    if (!r.ok) { skipped.push({ id, reason: r.error }); continue; }
    for (const v of ['original', 'foreground', 'matte']) {
      const pf = `view-${id}-${v}.json`; await write(pf, r.views[v]);
      const name = `key-${id}-${v}.png`;
      await still(args, join(work, pf), join(dir, name), when);
      tiles.push({ file: name, label: `${id}: ${v}` });
    }
    keyed.push(id);
  }
  // Labelled contact sheet.
  const imgs = await Promise.all(tiles.map(async (t) => ({ ...t, src: `data:image/png;base64,${(await readFile(join(dir, t.file))).toString('base64')}` })));
  const html = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#111;color:#eee;font:14px system-ui}.g{display:grid;grid-template-columns:repeat(3,420px);gap:10px;padding:10px;width:1290px}.t{background:#1b1b1b;padding:6px}.t img{width:408px;display:block;background:#444}.t b{display:block;padding:4px 2px}</style><div class=g>${imgs.map((t) => `<div class=t><b>${esc(t.label)}</b><img src="${t.src}"></div>`).join('')}</div>`;
  const hp = join(work, 'sheet.html'); await writeFile(hp, html);
  const chromium = await loadChromium();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], ...((args.chromium || process.env.CHROMIUM_PATH) ? { executablePath: args.chromium || process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1290, height: 600 } })).newPage();
    await page.goto(pathToFileURL(hp).href); await page.waitForLoadState('load');
    await page.screenshot({ path: join(dir, 'sheet.png'), fullPage: true });
  } finally { await browser.close(); }
  const report = { scene_id: scene.id, views: tiles.map((t) => t.file), keyed_layers: keyed, skipped, selection: { layers: (sel.layers || []).slice(0, 200), truncated: (sel.layers || []).length > 200, unmatched: sel.unmatched, legend_note: sel.note } };
  await writeFile(join(dir, 'views.json'), JSON.stringify(report, null, 2));
  console.error('(1/1 frames)');
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
