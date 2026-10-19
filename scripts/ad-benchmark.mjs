#!/usr/bin/env node
// Visual benchmark runner.
//   node scripts/ad-benchmark.mjs run --label after-fonts --change "Inter 4.0 for headlines" [--baseline before-fonts]
//        [--cases typography,beat] [--formats portrait,square] [--out benchmark/runs] [--chromium /path/to/chrome]
//   node scripts/ad-benchmark.mjs compare --before a --after b [--out benchmark/runs]
// Writes <out>/<label>/{*.png, run.json, report.html} and appends the run to benchmark/history.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { BENCH_CASES, FORMAT_IDS, caseProject, decodePng, pixelStats, pixelDiff, sha256, judgeTechnical, judgeVisual, judgePerformance, recordRun, compareRuns } from '../lib/adBenchmark.js';
import { seedPlayerHtml } from '../lib/adExport.js';

const argv = process.argv.slice(2);
const mode = argv.shift();
const a = {};
for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
const out = resolve(a.out || 'benchmark/runs');
const HISTORY = resolve('benchmark/history.json');
const PLAYER = new URL('../public/ad-designs/vocabulary-player.html', import.meta.url);
const fail = (m) => { console.log(JSON.stringify({ ok: false, error: m })); process.exit(1); };
const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };

async function loadChromium() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return createRequire(import.meta.url)(name).chromium; } catch { /* next */ }
  }
  fail('Playwright was not found. Run npm install or install playwright-core.');
}

if (mode === 'run') {
  if (!a.label || !a.change) fail('--label and --change are required (say what specifically changed)');
  const cases = a.cases ? BENCH_CASES.filter((c) => a.cases.split(',').includes(c.id)) : BENCH_CASES;
  const formats = a.formats ? a.formats.split(',') : FORMAT_IDS;
  if (!cases.length) fail('no matching cases');
  const dir = join(out, a.label);
  await mkdir(dir, { recursive: true });
  const baseline = a.baseline ? await readJson(join(out, a.baseline, 'run.json'), null) : null;
  const player = await readFile(PLAYER, 'utf8');
  const chromium = await loadChromium();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(a.chromium ? { executablePath: a.chromium } : {}) });
  const results = [];
  try {
    for (const c of cases) for (const format of formats) {
      const { project, shots } = caseProject(c, format);
      const html = seedPlayerHtml(player, project, {});
      const file = join(dir, `.${c.id}-${format}.html`);
      await writeFile(file, html);
      const grab = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1, height: 1 } });
        await ctx.route('**/*', (r) => (/^(file|data):/.test(r.request().url()) ? r.continue() : r.abort()));
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e.message || e)));
        await page.goto(`file://${file}?capture=1`);
        await page.waitForFunction(() => typeof window.__capture === 'function');
        const info = await page.evaluate(() => window.__captureInfo());
        await page.setViewportSize({ width: info.logicalWidth, height: info.logicalHeight });
        const frames = [];
        for (const ms of shots) { await page.evaluate((t) => window.__capture(t), ms); frames.push({ ms, png: await page.screenshot({ type: 'png' }) }); }
        errors.push(...(await page.evaluate(() => window.__captureInfo())).errors);
        await ctx.close();
        return { frames, errors };
      };
      const first = await grab();
      const second = await grab();
      const rows = [], stats = [], diffs = [];
      for (const f of first.frames) {
        const name = `${c.id}-${format}-${f.ms}.png`;
        await writeFile(join(dir, name), f.png);
        const img = decodePng(f.png);
        stats.push(pixelStats(img));
        rows.push({ ms: f.ms, file: name, sha256: sha256(f.png) });
        if (baseline) {
          const old = baseline.results.find((r) => r.caseId === c.id && r.format === format);
          const oldShot = old && old.shots.find((s) => s.ms === f.ms);
          if (oldShot) { try { diffs.push(pixelDiff(decodePng(await readFile(join(out, baseline.label, oldShot.file))), img)); } catch { /* baseline image missing */ } }
        }
      }
      results.push({ caseId: c.id, format, category: c.category, shots: rows, stats,
        technical: judgeTechnical({ project, errors: first.errors, hashes: rows.map((r) => r.sha256), repeatHashes: second.frames.map((f) => sha256(f.png)) }),
        visual: judgeVisual(stats, diffs.length ? diffs : null), performance: judgePerformance(project) });
    }
  } finally { await browser.close(); }
  const run = recordRun({ label: a.label, change: a.change, at: new Date().toISOString(), results });
  await writeFile(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  const cmp = baseline ? compareRuns(baseline, run) : null;
  await writeFile(join(dir, 'report.html'), report(run, baseline, cmp));
  const history = await readJson(HISTORY, []);
  history.push({ label: run.label, change: run.change, at: run.at, cases: results.length, technicalFails: results.filter((r) => !r.technical.pass).length, visualFails: results.filter((r) => !r.visual.pass).length, performanceFlags: results.filter((r) => !r.performance.pass).length, vs: baseline ? baseline.label : null, summary: cmp ? cmp.summary : null });
  await mkdir(resolve('benchmark'), { recursive: true });
  await writeFile(HISTORY, JSON.stringify(history, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, dir, cases: results.length, technicalFails: history.at(-1).technicalFails, visualFails: history.at(-1).visualFails, performanceFlags: history.at(-1).performanceFlags, compare: cmp && cmp.summary, coverageGaps: run.coverage.gaps.map((g) => g.category) }));
} else if (mode === 'compare') {
  if (!a.before || !a.after) fail('--before and --after are required');
  const before = await readJson(join(out, a.before, 'run.json'), null), after = await readJson(join(out, a.after, 'run.json'), null);
  if (!before || !after) fail('run.json not found for one of the labels');
  console.log(JSON.stringify(compareRuns(before, after), null, 2));
} else fail('mode: run | compare');

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function report(run, baseline, cmp) {
  const judge = (name, j) => `<span class="${j.pass ? 'ok' : 'bad'}">${name}: ${j.pass ? 'pass' : esc(j.issues[0])}</span>`;
  const rows = run.results.map((r) => {
    const old = baseline && baseline.results.find((x) => x.caseId === r.caseId && x.format === r.format);
    const cells = r.shots.map((s) => `<td>${old && old.shots.find((o) => o.ms === s.ms) ? `<img src="../${esc(baseline.label)}/${esc(old.shots.find((o) => o.ms === s.ms).file)}" height="180"><br>` : ''}<img src="${esc(s.file)}" height="180"><br>${s.ms}ms</td>`).join('');
    return `<tr><th>${esc(r.caseId)}<br>${esc(r.format)}<br>${judge('technical', r.technical)}<br>${judge('visual', r.visual)}<br>${judge('ad structure', r.performance)}</th>${cells}</tr>`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Benchmark ${esc(run.label)}</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:16px}th{text-align:left;vertical-align:top;padding:8px;min-width:200px}td{padding:4px}.ok{color:#6c6}.bad{color:#f77}img{border-radius:4px}</style><h1>${esc(run.label)}</h1><p><b>Change:</b> ${esc(run.change)}</p>${baseline ? `<p>Compared with <b>${esc(baseline.label)}</b>: ${esc(cmp.summary)} (baseline above, new below in each cell)</p>` : ''}<p>Not covered yet: ${run.coverage.gaps.map((g) => esc(g.category) + ' (needs ' + esc(g.needs) + ')').join('; ')}</p><p>"Ad structure" is a rule-of-thumb check on the project, not measured ad performance.</p><table>${rows}</table>`;
}
