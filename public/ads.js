(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ads = [];
  var filter = 'all';
  var lastTile = null;
  var loading = false;

  function setStatus(text) { $('status').textContent = text || ''; }

  function hueOf(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function isCinematic(ad) { return ad.spec_version === 2; }

  function ago(ts) {
    if (!ts) return '';
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' hr ago';
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function metaOf(ad) {
    var parts = [];
    if (ad.duration) parts.push(Math.round(ad.duration) + 's');
    if (ad.format) parts.push(ad.format);
    return parts.join(' · ');
  }

  function openUrl(ad) {
    if (isCinematic(ad)) return '/ad-view.html?ad=' + encodeURIComponent(ad.campaign_id || '');
    return safeStudioUrl(ad);
  }

  function safeStudioUrl(ad) {
    var url = typeof ad.studio_url === 'string' ? ad.studio_url : '';
    if (url.indexOf('/ad-maker.html') === 0) return url;
    return '/ad-maker.html?ad=' + encodeURIComponent(ad.campaign_id || '');
  }

  function showMessage(text, linkHref, linkText) {
    var box = $('message');
    box.textContent = '';
    var p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    if (linkHref) {
      var a = document.createElement('a');
      a.className = 'btn primary';
      a.href = linkHref;
      a.textContent = linkText;
      box.appendChild(a);
    }
    box.hidden = false;
  }

  function clearMessage() { $('message').hidden = true; $('message').textContent = ''; }

  function skeletons() {
    var grid = $('grid');
    grid.textContent = '';
    for (var i = 0; i < 9; i++) {
      var li = document.createElement('li');
      li.className = 'skeleton';
      li.setAttribute('aria-hidden', 'true');
      grid.appendChild(li);
    }
  }

  function render() {
    var cine = ads.filter(isCinematic).length;
    $('stat-ads').textContent = String(ads.length);
    $('stat-cine').textContent = String(cine);
    $('stat-studio').textContent = String(ads.length - cine);
    var shown = ads.filter(function (ad) {
      if (filter === 'cinematic') return isCinematic(ad);
      if (filter === 'studio') return !isCinematic(ad);
      return true;
    });
    var grid = $('grid');
    grid.textContent = '';
    clearMessage();
    setStatus('');
    if (!ads.length) {
      showMessage('No ads yet. Make your first one and it will show up here.', '/ad-maker.html', 'New ad');
      return;
    }
    if (!shown.length) {
      showMessage('No ads in this view yet.');
      return;
    }
    shown.forEach(function (ad) {
      var li = document.createElement('li');
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.style.setProperty('--h', String(hueOf(String(ad.campaign_id || ad.name || ''))));
      tile.setAttribute('aria-label', (ad.name || 'Untitled ad') + ', ' + (isCinematic(ad) ? 'cinematic' : 'studio') + ' ad. Open details.');
      var badge = document.createElement('span');
      badge.className = 'tile-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = isCinematic(ad) ? '▶' : '▤';
      var name = document.createElement('span');
      name.className = 'tile-name';
      name.textContent = ad.name || 'Untitled ad';
      var meta = document.createElement('span');
      meta.className = 'tile-meta';
      meta.textContent = metaOf(ad);
      tile.appendChild(badge);
      tile.appendChild(name);
      tile.appendChild(meta);
      tile.addEventListener('click', function () { openSheet(ad, tile); });
      li.appendChild(tile);
      grid.appendChild(li);
    });
  }

  function load() {
    if (loading) return;
    loading = true;
    clearMessage();
    setStatus('Loading your ads...');
    skeletons();
    fetch('/api/ad-campaigns', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', input: {} })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (res.status === 401) {
          $('grid').textContent = '';
          setStatus('');
          showMessage('Sign in to Nexus in this browser to see your ads.', '/nexus-login.html', 'Sign in');
          return;
        }
        if (!res.ok || !body || !body.data) throw new Error((body && body.error) || 'Could not load your ads.');
        ads = Array.isArray(body.data.campaigns) ? body.data.campaigns : [];
        render();
      });
    }).catch(function (err) {
      $('grid').textContent = '';
      setStatus('');
      showMessage((err && err.message) || 'Could not load your ads.');
    }).then(function () { loading = false; });
  }

  function openSheet(ad, tile) {
    lastTile = tile;
    $('sheet-title').textContent = ad.name || 'Untitled ad';
    var bits = [isCinematic(ad) ? 'Cinematic ad' : 'Studio ad'];
    var meta = metaOf(ad);
    if (meta) bits.push(meta);
    var when = ago(ad.updated_at);
    if (when) bits.push('updated ' + when);
    $('sheet-meta').textContent = bits.join(' · ');
    $('sheet-id').textContent = ad.campaign_id || '';
    $('sheet-open').href = openUrl(ad);
    $('sheet-open').textContent = isCinematic(ad) ? 'Play ad' : 'Open in studio';
    $('sheet-copy').textContent = 'Copy ID';
    $('sheet-copy').onclick = function () { copyId(ad.campaign_id || ''); };
    $('sheet').hidden = false;
    $('sheet-close').focus();
  }

  function closeSheet() {
    $('sheet').hidden = true;
    if (lastTile) lastTile.focus();
  }

  function copyId(id) {
    var done = function () { $('sheet-copy').textContent = 'Copied'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(done, function () { $('sheet-copy').textContent = 'Press and hold the ID to copy'; });
    } else {
      $('sheet-copy').textContent = 'Press and hold the ID to copy';
    }
  }

  $('refresh').addEventListener('click', load);
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (btn) {
    btn.addEventListener('click', function () {
      filter = btn.getAttribute('data-filter');
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      render();
    });
  });
  load();
})();
