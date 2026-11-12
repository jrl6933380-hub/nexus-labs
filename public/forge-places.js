const $ = id => document.getElementById(id);
const LABEL = { no_dedicated_site_found: ['No website listed', 's0'], social_booking_only: ['Social / booking page only', 's1'], needs_checking: ['Needs checking', 's2'], has_website: ['Has a website', 's3'] };
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
function addBuild(card, lead, query) {
  const btn = el('button', 'Build sites + pitch'), note = el('p', '', 'note'), box = el('div');
  btn.type = 'button'; btn.style.marginTop = '8px';
  btn.addEventListener('click', async () => {
    btn.disabled = true; note.textContent = 'Building…'; box.replaceChildren();
    try {
      const r = await fetch('/api/forge-places-build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business: query.business, city: query.city, lead }), signal: AbortSignal.timeout(30000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(d.error || 'Build failed.');
      note.textContent = 'Built. ' + (d.saved?.message || '') + (d.saved?.status === 'saved' || d.saved?.status === 'already' ? '' : ' Copy the pitch before you leave.');
      const row = el('p');
      for (const v of d.previews) {
        const a = el('a', v.label + ' preview'); a.href = URL.createObjectURL(new Blob([v.html], { type: 'text/html' })); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.marginRight = '14px'; row.append(a);
      }
      const pre = el('pre', d.pitch, 'pitch'), copy = el('button', 'Copy pitch'); copy.type = 'button';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(d.pitch); copy.textContent = 'Copied'; } catch { copy.textContent = 'Press and hold the text to copy'; } });
      box.append(row, copy, pre);
    } catch (e) { note.textContent = e.name === 'TimeoutError' ? 'No answer from the server after 30 seconds.' : String(e.message || e); }
    finally { btn.disabled = false; }
  });
  card.append(btn, note, box);
}
$('f').addEventListener('submit', async ev => {
  ev.preventDefault(); $('go').disabled = true; $('msg').textContent = 'Searching…'; $('out').replaceChildren();
  try {
    if ($('src').value === 'ally') {
      const id = crypto.getRandomValues(new Uint8Array(12)); const requestId = 'fl' + Array.from(id, b => b.toString(16).padStart(2, '0')).join('');
      const r = await fetch('/api/forge-lead-jobs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', input: { request_id: requestId, kind: 'search', business: $('b').value, city: $('c').value, count: Number($('n').value) } }), signal: AbortSignal.timeout(30000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(d.error || 'Could not send the search to the Ally.');
      const c = el('div', undefined, 'card'); const a = el('a', 'Open Forge Leads'); a.href = '/forge-leads.html';
      c.append(el('h2', 'Sent to the Ally'), el('p', 'It searches Google and Maps on the Ally and takes a few minutes. Follow it, and pick leads to build, on Forge Leads.'), a);
      $('out').append(c); $('msg').textContent = 'Search queued.'; return;
    }
    const r = await fetch('/api/forge-places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business: $('b').value, city: $('c').value, count: Number($('n').value) }), signal: AbortSignal.timeout(30000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || 'Search failed.');
    $('msg').textContent = `Google returned ${d.found} places; showing ${d.leads.length}.`;
    for (const l of d.leads) {
      const [text, cls] = LABEL[l.status] || ['Unknown', 's2'];
      const c = el('div', undefined, 'card'); c.append(el('span', text, 'chip ' + cls), el('h2', l.name), el('p', l.address));
      if (l.phone) c.append(el('p', 'Phone: ' + l.phone));
      if (l.rating) c.append(el('p', `Rating ${l.rating} from ${l.reviewCount} reviews`));
      c.append(el('p', l.notes));
      if (l.reason) c.append(el('p', `Rank ${d.leads.indexOf(l) + 1} (score ${l.score}): ${l.reason}`, 'note'));
      if (l.website) { const a = el('a', l.website); a.href = l.website; a.rel = 'noopener noreferrer'; const p = el('p'); p.append(a); c.append(p); }
      if (l.map_url) { const a = el('a', 'Open in Maps'); a.href = l.map_url; a.rel = 'noopener noreferrer'; const p = el('p'); p.append(a); c.append(p); }
      if (l.status !== 'has_website') addBuild(c, l, d.query);
      $('out').append(c);
    }
  } catch (e) { $('msg').textContent = e.name === 'TimeoutError' ? 'No answer from the server after 30 seconds.' : String(e.message || e); }
  finally { $('go').disabled = false; }
});
