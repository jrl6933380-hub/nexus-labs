// Lead finder + saved leads for the Forge Leads page. One place: pick a search, run it (Google now, or the Ally),
// build sites + a pitch from a lead, and see everything saved. Nothing here sends, calls or posts anything.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TRADES = ['barber', 'nail salon', 'hair salon', 'tattoo shop', 'auto repair', 'plumber', 'electrician', 'lawn care', 'house cleaning', 'pet groomer', 'restaurant', 'gym'];
  var CITIES = ['Des Moines, Iowa', 'West Des Moines, Iowa', 'Ankeny, Iowa', 'Urbandale, Iowa', 'Cedar Rapids, Iowa', 'Iowa City, Iowa', 'Davenport, Iowa', 'Sioux City, Iowa', 'Ames, Iowa', 'Waterloo, Iowa', 'Council Bluffs, Iowa', 'Dubuque, Iowa'];
  var LABEL = { no_dedicated_site_found: ['No website listed', 'ok'], social_booking_only: ['Social / booking page only', 'warn'], needs_checking: ['Needs checking', ''], has_website: ['Has a website', 'bad'] };
  var TEXT = /^[\p{L}\p{N} .,'&-]{2,100}$/u;
  var source = 'google';

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'text') n.textContent = props[k]; else n[k] = props[k]; });
    (kids || []).forEach(function (c) { n.append(c); });
    return n;
  }
  function post(url, body, ms) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms || 30000) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; }); });
  }
  function fail(e) { return e && e.name === 'TimeoutError' ? 'No answer from the server after 30 seconds.' : String((e && e.message) || e); }
  function requestId() { var a = new Uint8Array(12); crypto.getRandomValues(a); return 'fl' + Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function chips(host, items, input) {
    items.forEach(function (t) {
      var b = el('button', { type: 'button', className: 'chipbtn', text: t.replace(/, Iowa$/, '') });
      b.setAttribute('aria-pressed', String($(input).value.toLowerCase() === t.toLowerCase()));
      b.addEventListener('click', function () { $(input).value = t; Array.prototype.forEach.call(host.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); }); });
      host.append(b);
    });
  }

  function mountFinder(root) {
    var tr = el('div', { className: 'chips' }), ci = el('div', { className: 'chips' });
    var type = el('input', { id: 'f-type', type: 'text', value: 'barber', maxLength: 100, autocomplete: 'off' });
    var city = el('input', { id: 'f-city', type: 'text', value: 'Des Moines, Iowa', maxLength: 100, autocomplete: 'off' });
    var count = el('select', { id: 'f-count' }, [el('option', { text: '5' }), el('option', { text: '10', selected: true })]);
    var gBtn = el('button', { type: 'button', text: 'Google (fast)' }), aBtn = el('button', { type: 'button', text: 'Ally (free, slower)' });
    var go = el('button', { type: 'button', className: 'primary', text: 'Search' });
    var msg = el('p', { className: 'muted', id: 'f-msg' }), out = el('div', { id: 'f-out' });
    function setSource(s) { source = s; gBtn.setAttribute('aria-pressed', String(s === 'google')); aBtn.setAttribute('aria-pressed', String(s === 'ally')); note.textContent = s === 'google' ? 'Uses your Google credit. Results appear below in seconds.' : 'Free. The Ally searches Google and Maps on its screen and takes a few minutes. Results appear under Ally results.'; }
    var note = el('p', { className: 'muted' });
    gBtn.addEventListener('click', function () { setSource('google'); }); aBtn.addEventListener('click', function () { setSource('ally'); });
    root.append(
      el('label', { text: 'Business type' }), tr, type, el('label', { text: 'City' }), ci, city,
      el('label', { text: 'How many' }), count, el('label', { text: 'Search with' }), el('div', { className: 'row' }, [gBtn, aBtn]), note,
      el('div', { className: 'row' }, [go]), msg, out);
    chips(tr, TRADES, 'f-type'); chips(ci, CITIES, 'f-city'); setSource('google');
    go.addEventListener('click', function () {
      var b = type.value.trim().replace(/\s+/g, ' '), c = city.value.trim().replace(/\s+/g, ' ');
      if (!TEXT.test(b) || !TEXT.test(c)) { msg.textContent = 'Use plain letters and numbers for the business type and city.'; return; }
      go.disabled = true; msg.textContent = 'Searching…'; out.replaceChildren();
      var run = source === 'ally'
        ? post('/api/forge-lead-jobs', { action: 'create', input: { request_id: requestId(), kind: 'search', business: b, city: c, count: Number(count.value) } }).then(function () {
          msg.textContent = 'Sent to the Ally. Follow it under Ally results below.'; if (window.__leadsReload) window.__leadsReload();
        })
        : post('/api/forge-places', { business: b, city: c, count: Number(count.value) }).then(function (d) {
          msg.textContent = 'Google returned ' + d.found + ' places; showing ' + d.leads.length + '.';
          d.leads.forEach(function (l, i) { out.append(leadCard(l, d.query, i + 1)); });
        });
      run.catch(function (e) { msg.textContent = fail(e); }).then(function () { go.disabled = false; });
    });
  }

  function leadCard(l, query, rank) {
    var s = LABEL[l.status] || ['Unknown', ''];
    var c = el('div', { className: 'job' }, [el('span', { className: 'pill ' + s[1], text: s[0] }), el('h3', { text: (rank ? rank + '. ' : '') + l.name }), el('p', { className: 'muted', text: l.address })]);
    if (l.phone) c.append(el('p', { text: 'Phone: ' + l.phone }));
    if (l.rating) c.append(el('p', { text: 'Rating ' + l.rating + ' from ' + l.reviewCount + ' reviews' }));
    if (l.reason) c.append(el('p', { className: 'muted', text: 'Score ' + l.score + ': ' + l.reason }));
    if (l.website) { var a = el('a', { text: l.website, href: l.website, rel: 'noopener noreferrer' }); c.append(el('p', {}, [a])); }
    if (l.map_url) c.append(el('p', {}, [el('a', { text: 'Open in Maps', href: l.map_url, rel: 'noopener noreferrer' })]));
    if (l.status !== 'has_website') c.append(buildControls(l, query));
    return c;
  }

  function buildControls(lead, query) {
    var btn = el('button', { type: 'button', className: 'primary', text: 'Build sites + pitch, save lead' }), note = el('p', { className: 'muted' }), box = el('div');
    btn.addEventListener('click', function () {
      btn.disabled = true; note.textContent = 'Building…'; box.replaceChildren();
      post('/api/forge-places-build', { business: query.business, city: query.city, lead: lead }).then(function (d) {
        note.textContent = 'Built. ' + ((d.saved && d.saved.message) || '');
        box.append(previewTabs(d.name, d.previews), el('pre', { text: d.pitch }));
        if (window.__savedReload) window.__savedReload();
      }).catch(function (e) { note.textContent = fail(e); }).then(function () { btn.disabled = false; });
    });
    return el('div', {}, [el('div', { className: 'row' }, [btn]), note, box]);
  }

  function previewTabs(name, previews) {
    var wrap = el('div', {}), tabs = el('div', { className: 'row' });
    var frame = el('iframe', { title: 'Site preview for ' + name }); frame.setAttribute('sandbox', '');
    function show(p, btn) { frame.srcdoc = p.html; Array.prototype.forEach.call(tabs.children, function (x) { x.setAttribute('aria-pressed', String(x === btn)); }); }
    previews.forEach(function (p, i) {
      var b = el('button', { type: 'button', text: p.label }); b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { show(p, b); }); tabs.append(b); if (i === 0) show(p, b);
    });
    wrap.append(tabs, el('div', { className: 'frame' }, [frame]));
    return wrap;
  }

  function pitchText(p) {
    if (!p || typeof p !== 'object') return '';
    var list = function (a) { return (Array.isArray(a) ? a : []).map(function (x) { return '- ' + (typeof x === 'string' ? x : (x.objection ? '"' + x.objection + '" -> ' + x.response : '')); }); };
    return [p.opener, '', 'WHAT WE FOUND'].concat(list(p.weaknesses), ['', 'DISCOVERY QUESTIONS'], list(p.discoveryQuestions), ['', String(p.demoLabel || '').toUpperCase(), p.demoLine, '', 'PRICING', p.pricingLine, '', 'OBJECTIONS'], list(p.objections), ['', 'NEXT STEP', p.nextStep]).filter(function (x) { return x !== undefined && x !== null; }).join('\n');
  }

  function mountSaved(root) {
    var list = el('div'), msg = el('p', { className: 'muted', text: 'Loading…' });
    root.append(msg, list);
    function load() {
      return fetch('/api/forge-leads?scope=all', { credentials: 'same-origin' }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Could not load saved leads.'); return d.leads || []; });
      }).then(function (leads) {
        list.replaceChildren(); msg.textContent = leads.length ? leads.length + ' saved. Newest first.' : 'Nothing saved yet. Build a lead above and it shows up here.';
        leads.forEach(function (l) {
          var s = LABEL[l.websiteStatus] || ['', ''];
          var card = el('div', { className: 'job' }, [el('div', { className: 'row' }, [el('strong', { text: l.businessName }), s[0] ? el('span', { className: 'pill ' + s[1], text: s[0] }) : el('span')]), el('p', { className: 'muted', text: [l.category, l.location].filter(Boolean).join(' · ') })]);
          if (l.phone) card.append(el('p', {}, [el('a', { className: 'btn', text: 'Call ' + l.phone, href: 'tel:' + String(l.phone).replace(/[^0-9+]/g, '') })]));
          if (l.rating) card.append(el('p', { className: 'muted', text: 'Rating ' + l.rating + ' from ' + l.reviewCount + ' reviews' }));
          var variants = (l.siteVariants || []).filter(function (v) { return v && typeof v.html === 'string'; });
          if (variants.length) { var d1 = el('details', {}, [el('summary', { text: 'Site previews' }), previewTabs(l.businessName, variants)]); card.append(d1); }
          var text = pitchText(l.pitch);
          if (text) card.append(el('details', {}, [el('summary', { text: 'Call pitch' }), el('pre', { text: text })]));
          list.append(card);
        });
      }).catch(function (e) { msg.textContent = fail(e); });
    }
    window.__savedReload = load; load();
  }

  document.addEventListener('DOMContentLoaded', function () {
    if ($('finder-root')) mountFinder($('finder-root'));
    if ($('saved-root')) mountSaved($('saved-root'));
  });
})();
