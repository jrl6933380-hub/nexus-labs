const $ = id => document.getElementById(id);
const LABEL = { no_dedicated_site_found: ['No website listed', 's0'], social_booking_only: ['Social / booking page only', 's1'], needs_checking: ['Needs checking', 's2'], has_website: ['Has a website', 's3'] };
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
$('f').addEventListener('submit', async ev => {
  ev.preventDefault(); $('go').disabled = true; $('msg').textContent = 'Searching…'; $('out').replaceChildren();
  try {
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
      if (l.website) { const a = el('a', l.website); a.href = l.website; a.rel = 'noopener noreferrer'; const p = el('p'); p.append(a); c.append(p); }
      if (l.map_url) { const a = el('a', 'Open in Maps'); a.href = l.map_url; a.rel = 'noopener noreferrer'; const p = el('p'); p.append(a); c.append(p); }
      $('out').append(c);
    }
  } catch (e) { $('msg').textContent = e.name === 'TimeoutError' ? 'No answer from the server after 30 seconds.' : String(e.message || e); }
  finally { $('go').disabled = false; }
});
