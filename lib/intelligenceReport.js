// A self-contained HTML report saved at the end of each run. Everything that came from a web page is escaped:
// page text is untrusted, and the report is meant to be opened and shared.
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeHref = url => /^https:\/\//i.test(String(url)) ? esc(url) : '#';
const short = url => { try { const u = new URL(url); return `${u.hostname.replace(/^www\./,'')}${u.pathname === '/' ? '' : u.pathname}`; } catch { return String(url); } };
const when = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toISOString().replace('T',' ').slice(0,16) + ' UTC' : ''; };
const methodLabel = method => method === 'browser' ? 'Read with a browser' : 'Read from HTML';
const TYPE = {pricing:'Pricing', services:'Services', features:'Features', other:'Page'};

const CSS = `
:root{--bg:#f7f6f3;--card:#fff;--ink:#1d1d1b;--mute:#6b6a65;--line:#e4e2db;--add:#e8f4df;--addi:#2b5a0f;--del:#fbe9e7;--deli:#8a2a1b;--chg:#fdf0d6;--chgi:#7a4b05;--new:#e3eefb;--newi:#154c8a}
@media(prefers-color-scheme:dark){:root{--bg:#161615;--card:#201f1e;--ink:#f1efe8;--mute:#a09e96;--line:#34322f;--add:#1f3314;--addi:#b9e08f;--del:#3b1f1b;--deli:#f3b5aa;--chg:#3a2a0b;--chgi:#f5cf85;--new:#142b47;--newi:#a9cdf5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 40px}h1{font-size:22px;font-weight:600;margin:0 0 2px}h2{font-size:13px;font-weight:600;color:var(--mute);margin:26px 0 10px;letter-spacing:.04em;text-transform:uppercase}
.sub{color:var(--mute);font-size:13px;margin:0 0 18px}.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(min-width:560px){.tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.tile b{display:block;font-size:26px;font-weight:600;line-height:1.15}.tile span{font-size:12px;color:var(--mute)}
.tile.hot b{color:var(--chgi)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 12px}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.head a{color:var(--ink);font-weight:600;text-decoration:none;word-break:break-all}.meta{font-size:12px;color:var(--mute);margin:3px 0 10px}
.badge{font-size:12px;border-radius:8px;padding:2px 9px;white-space:nowrap;font-weight:500}.b-chg{background:var(--chg);color:var(--chgi)}.b-new{background:var(--new);color:var(--newi)}.b-same{background:var(--line);color:var(--mute)}.b-bad{background:var(--del);color:var(--deli)}
.say{margin:0 0 10px}.prices{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.chip{font-size:13px;border-radius:8px;padding:3px 10px}.chip.o{background:var(--del);color:var(--deli);text-decoration:line-through}.chip.n{background:var(--add);color:var(--addi)}
.line{font-size:13px;border-radius:6px;padding:5px 9px;margin:0 0 5px;word-break:break-word}.line.a{background:var(--add);color:var(--addi)}.line.r{background:var(--del);color:var(--deli)}
.row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line);font-size:14px}.row:first-child{border-top:0}.row a{color:var(--ink);text-decoration:none;word-break:break-all}.row small{display:block;color:var(--mute);font-size:12px}
.foot{color:var(--mute);font-size:12px;margin-top:28px}`;

function changedCard(row) {
  const prices = row.priceChanges || {added:[], removed:[]};
  const chips = [...prices.removed.map(p => `<span class="chip o">${esc(p)}</span>`), ...prices.added.map(p => `<span class="chip n">${esc(p)}</span>`)].join('');
  const lines = [...(row.added || []).map(x => `<div class="line a">+ ${esc(x)}</div>`), ...(row.removed || []).map(x => `<div class="line r">&minus; ${esc(x)}</div>`)].join('');
  const counts = row.changeCounts ? `${row.changeCounts.added} added, ${row.changeCounts.removed} removed` : '';
  return `<div class="card"><div class="head"><a href="${safeHref(row.url)}" rel="noopener noreferrer">${esc(short(row.url))}</a><span class="badge b-chg">Changed</span></div>
<div class="meta">${esc(TYPE[row.pageType] || 'Page')} &middot; ${esc(methodLabel(row.captureMethod))} &middot; last seen ${esc(when(row.previousCapturedAt))}</div>
<p class="say">${esc(row.changeSummary)}</p>${chips ? `<div class="prices">${chips}</div>` : ''}${lines}${counts ? `<div class="meta" style="margin:8px 0 0">Showing the first passages. Total: ${esc(counts)}.</div>` : ''}</div>`;
}
const simpleRow = (row, badge, cls, note) => `<div class="row"><div><a href="${safeHref(row.url)}" rel="noopener noreferrer">${esc(short(row.url))}</a><small>${esc(note)}</small></div><span class="badge ${cls}">${badge}</span></div>`;

export function renderReport({summary, rows = [], generatedAt = new Date().toISOString()}) {
  const changed = rows.filter(r => r.status === 'captured' && r.comparison === 'changed');
  const quiet = rows.filter(r => r.status === 'captured' && r.comparison !== 'changed');
  const failed = rows.filter(r => r.status === 'failed');
  const tiles = [['Pages checked', summary.successful, ''], ['Changed', summary.changed, summary.changed ? ' hot' : ''], ['Unchanged', summary.unchanged, ''], ["Couldn't read", failed.length, '']]
    .map(([label, n, cls]) => `<div class="tile${cls}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`).join('');
  const by = Object.entries(summary.byCompetitor || {}).map(([name, v]) =>
    `<div class="row"><div>${esc(name)}<small>${esc(v.pages)} page${v.pages === 1 ? '' : 's'} watched</small></div><span class="badge ${v.changed ? 'b-chg' : 'b-same'}">${v.changed ? `${esc(v.changed)} changed` : 'No changes'}</span></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Competitor page changes</title><style>${CSS}</style></head><body><main>
<h1>Competitor page changes</h1><p class="sub">Checked ${esc(when(generatedAt))}${summary.stoppedForBudget ? ' &middot; stopped early at your cost limit' : ''}</p>
<div class="tiles">${tiles}</div>
${changed.length ? `<h2>What changed</h2>${changed.map(changedCard).join('')}` : `<h2>What changed</h2><div class="card">No changes on any watched page since the last run.</div>`}
${by ? `<h2>By competitor</h2><div class="card" style="padding:4px 14px">${by}</div>` : ''}
${quiet.length ? `<h2>Everything else</h2><div class="card" style="padding:4px 14px">${quiet.map(r => simpleRow(r, r.comparison === 'baseline' ? 'First seen' : 'Unchanged', r.comparison === 'baseline' ? 'b-new' : 'b-same', r.comparison === 'baseline' ? 'Saved as your baseline' : (r.changeSummary || ''))).join('')}</div>` : ''}
${failed.length ? `<h2>Couldn't read</h2><div class="card" style="padding:4px 14px">${failed.map(r => simpleRow(r, 'Not read', 'b-bad', r.error?.message || 'The page could not be read.')).join('')}</div>` : ''}
<p class="foot">Failed pages are not charged and never replace your saved copy. Saved pages live in your own Apify account.</p></main></body></html>`;
}
