// Render only structured cells as text. CSV never contains executable spreadsheet formulas.
export function opportunitiesCsv(table) {
  const cell = value => {
    let s = String(value ?? '');
    if (/^[\s\uFEFF]*[=+@\-]/u.test(s) || /^[\t\r\n]/u.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + [table.columns, ...table.rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function renderLocalOpportunities(out, result, download) {
  const table = result.tables?.find(t => t.name === 'Opportunities');
  if (!table) return;
  const doc = out.ownerDocument;
  const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const link = (label, value) => {
    try {
      const u = new URL(value);
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
      const a = el('a', label); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
    } catch { return null; }
  };
  out.append(el('h2', table.rows.length + ' business opportunities'));
  for (const row of table.rows) {
    const card = el('article', null, 'sec'); card.style.overflowWrap = 'anywhere';
    card.append(el('h3', row[0]), el('p', row[1] + ' · ' + row[2]));
    if (row[3]) card.append(el('p', row[3]));
    card.append(el('p', 'Website: ' + row[5] + ' · Site inspected: ' + row[6]));
    const website = link('Website', row[4]); if (website) card.append(website);
    if (row[7]) card.append(el('p', 'Public phone: ' + row[7]));
    if (row[8]) card.append(el('p', 'Public email: ' + row[8]));
    card.append(el('p', row[11]));
    for (const [label, index] of [['Business source', 9], ['Contact source', 10], ['Opportunity evidence', 12]]) {
      const a = link(label, row[index]); if (a) { const p = el('p'); p.append(a); card.append(p); }
    }
    card.append(el('p', 'Checked: ' + row[13], 'mute'));
    if (row[14]) {
      const details = el('details'); details.append(el('summary', 'Outreach draft — review before use'), el('p', row[14]));
      card.append(details);
    }
    out.append(card);
  }
  const dl = el('button', 'Download opportunities (.csv)', 'ghost');
  dl.addEventListener('click', () => download('nexus-local-opportunities.csv', opportunitiesCsv(table), 'text/csv;charset=utf-8'));
  out.append(dl, el('p', 'These are observed service-fit signals, not confirmed buying intent. No messages were sent.', 'mute'));
}
