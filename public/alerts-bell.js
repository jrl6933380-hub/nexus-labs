// The owner's bell: a small bell in the top corner with an unread count and a dropdown of recent alerts
// (new waitlist requests, previews ready or opened, paid, problems). Owner only: if /api/alerts says
// "not signed in" the bell stays hidden. All text is inserted with textContent, never as HTML.
const POLL_MS = 30000;
const ICONS = { new_request: '✉️', preview_ready: '✅', preview_viewed: '👀', paid: '💰', live: '🚀', stuck: '⏳', problem: '⚠️' };
const CSS = `
.nxbell{position:relative}
.nxbell-badge{position:absolute;top:-3px;right:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#e5484d;color:#fff;font:600 10px/16px system-ui,sans-serif;text-align:center;box-sizing:border-box}
.nxbell-panel{position:fixed;top:54px;right:10px;width:min(92vw,360px);max-height:min(70vh,520px);display:flex;flex-direction:column;background:#10161a;color:#e8ece9;border:1px solid #2a3a33;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);z-index:1000;overflow:hidden}
.nxbell-panel[hidden]{display:none}
.nxbell-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #24332a;font:600 14px system-ui,sans-serif}
.nxbell-head button{background:none;border:0;color:#8fd4b0;font:500 12px system-ui,sans-serif;cursor:pointer;padding:4px}
.nxbell-list{overflow:auto;margin:0;padding:0;list-style:none}
.nxbell-item{display:flex;gap:10px;padding:11px 14px;border-bottom:1px solid #1a2520;cursor:default}
.nxbell-item[data-link]{cursor:pointer}.nxbell-item[data-link]:hover{background:#151d20}
.nxbell-item.unread{background:#12201b}
.nxbell-ico{flex:none;font-size:16px;line-height:20px}
.nxbell-t{font:600 13px/1.3 system-ui,sans-serif;word-break:break-word}
.nxbell-b{margin-top:2px;font:400 12px/1.35 system-ui,sans-serif;color:#a9b8ae;word-break:break-word}
.nxbell-w{margin-top:3px;font:400 11px system-ui,sans-serif;color:#74857a}
.nxbell-empty{padding:26px 16px;text-align:center;font:400 13px system-ui,sans-serif;color:#8a9a90}
`;

export function relativeTime(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function mountAlertsBell({ doc = document, fetchImpl = fetch, anchor = doc.getElementById('headBtn'), poll = true } = {}) {
  if (!anchor || doc.getElementById('alertsBtn')) return null;
  const style = doc.createElement('style'); style.textContent = CSS; doc.head.appendChild(style);

  const btn = doc.createElement('button');
  btn.className = (anchor.className || 'ticon') + ' nxbell'; btn.id = 'alertsBtn'; btn.type = 'button';
  btn.setAttribute('aria-label', 'Alerts'); btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); btn.hidden = true;
  btn.append('🔔');
  const badge = doc.createElement('span'); badge.className = 'nxbell-badge'; badge.hidden = true; btn.appendChild(badge);
  anchor.parentNode.insertBefore(btn, anchor);

  const panel = doc.createElement('div'); panel.className = 'nxbell-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Alerts');
  const head = doc.createElement('div'); head.className = 'nxbell-head';
  const title = doc.createElement('span'); title.textContent = 'Alerts';
  const markBtn = doc.createElement('button'); markBtn.type = 'button'; markBtn.textContent = 'Mark all read';
  head.append(title, markBtn);
  const list = doc.createElement('ul'); list.className = 'nxbell-list';
  panel.append(head, list); doc.body.appendChild(panel);

  let items = [], unread = 0;

  function paintBadge() {
    badge.hidden = unread < 1; badge.textContent = unread > 9 ? '9+' : String(unread);
    btn.setAttribute('aria-label', unread ? `Alerts, ${unread} unread` : 'Alerts');
  }
  function paintList() {
    list.textContent = '';
    if (!items.length) { const e = doc.createElement('li'); e.className = 'nxbell-empty'; e.textContent = 'Nothing yet. New requests, ready previews and payments will show up here.'; list.appendChild(e); return; }
    for (const a of items) {
      const li = doc.createElement('li'); li.className = 'nxbell-item' + (a.unread ? ' unread' : '');
      const ico = doc.createElement('span'); ico.className = 'nxbell-ico'; ico.textContent = ICONS[a.kind] || '🔔';
      const col = doc.createElement('div');
      const t = doc.createElement('div'); t.className = 'nxbell-t'; t.textContent = a.title;
      col.appendChild(t);
      if (a.body) { const b = doc.createElement('div'); b.className = 'nxbell-b'; b.textContent = a.body; col.appendChild(b); }
      const w = doc.createElement('div'); w.className = 'nxbell-w'; w.textContent = relativeTime(a.at); col.appendChild(w);
      li.append(ico, col);
      if (a.url) {
        li.dataset.link = '1'; li.tabIndex = 0; li.setAttribute('role', 'link');
        const go = () => { if (/^\//.test(a.url) && !/^\/\//.test(a.url)) location.href = a.url; else if (/^https:\/\//.test(a.url)) window.open(a.url, '_blank', 'noopener'); };
        li.addEventListener('click', go); li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
      }
      list.appendChild(li);
    }
  }
  async function load() {
    try {
      const r = await fetchImpl('/api/alerts', { credentials: 'same-origin' });
      if (r.status === 401) { btn.hidden = true; return; }
      if (!r.ok) return;
      const d = await r.json();
      items = Array.isArray(d.items) ? d.items : []; unread = Number(d.unread) || 0;
      btn.hidden = false; paintBadge(); if (!panel.hidden) paintList();
    } catch { /* offline: keep the last state */ }
  }
  async function markRead() {
    unread = 0; paintBadge();
    try { await fetchImpl('/api/alerts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read' }) }); } catch { /* retried on the next open */ }
  }
  function open() { panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); paintList(); if (unread) markRead(); }
  function close() { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); items = items.map((a) => ({ ...a, unread: false })); }

  btn.addEventListener('click', (ev) => { ev.stopPropagation(); panel.hidden ? open() : close(); });
  markBtn.addEventListener('click', () => { items = items.map((a) => ({ ...a, unread: false })); paintList(); markRead(); });
  doc.addEventListener('click', (ev) => { if (!panel.hidden && !panel.contains(ev.target) && ev.target !== btn) close(); });
  doc.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !panel.hidden) { close(); btn.focus(); } });

  load();
  if (poll) {
    setInterval(() => { if (doc.visibilityState !== 'hidden') load(); }, POLL_MS);
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') load(); });
  }
  return { load, open, close };
}

if (typeof document !== 'undefined') mountAlertsBell();
