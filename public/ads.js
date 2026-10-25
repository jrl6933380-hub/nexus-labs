(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ads = [];
  var filter = 'all';
  var lastTile = null;
  var loading = false;
  var renders = {};
  var videoUrl = null;

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
    if (renders[ad.campaign_id]) parts.push('video');
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
      showMessage('No ads yet. Make your first one and it will show up here.', '/ad-maker.html?new=1', 'New ad');
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
        loadRenders();
      });
    }).catch(function (err) {
      $('grid').textContent = '';
      setStatus('');
      showMessage((err && err.message) || 'Could not load your ads.');
    }).then(function () { loading = false; });
  }

  function api(action, input) {
    return fetch('/api/ad-campaigns', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, input: input || {} })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok || !body || !body.data) throw new Error((body && body.error) || 'Request failed.');
        return body.data;
      });
    });
  }

  // Which ads have a finished video. A failure just means no video buttons.
  function loadRenders() {
    api('renders').then(function (data) {
      renders = (data && data.renders) || {};
      render();
    }).catch(function () {});
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function clearVideo() {
    var box = $('sheet-video');
    box.textContent = '';
    box.hidden = true;
    box.style.display = 'none';
    if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
  }

  // Download the finished MP4 in its stored chunks, then play it here and offer a save link.
  function watchVideo(ad, info) {
    var btn = $('sheet-watch');
    clearVideo();
    btn.disabled = true;
    btn.textContent = 'Loading video...';
    var parts = new Array(info.chunks), next = 0, done = 0;
    function lane() {
      if (next >= info.chunks) return Promise.resolve();
      var i = next++;
      return api('render_chunk', { job_id: info.job_id, index: i }).then(function (c) {
        parts[i] = b64ToBytes(c.data_base64);
        done++;
        btn.textContent = 'Loading video ' + Math.round(done / info.chunks * 100) + '%';
        return lane();
      });
    }
    var lanes = [];
    for (var n = 0; n < 4; n++) lanes.push(lane());
    Promise.all(lanes).then(function () {
      videoUrl = URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }));
      var box = $('sheet-video');
      var v = document.createElement('video');
      v.src = videoUrl;
      v.controls = true;
      v.loop = true;
      v.setAttribute('playsinline', '');
      v.style.cssText = 'width:100%;max-height:60vh;border-radius:12px;background:#000;margin:8px 0';
      var save = document.createElement('a');
      save.className = 'btn';
      save.href = videoUrl;
      save.download = ((ad.name || 'ad').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'ad') + '.mp4';
      save.textContent = 'Save video';
      box.appendChild(v);
      box.appendChild(save);
      box.hidden = false;
      box.style.display = '';
      btn.hidden = true;
      btn.style.display = 'none';
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Watch video';
      var box = $('sheet-video');
      box.textContent = /expired|410/i.test((err && err.message) || '') ? 'This video expired. Ask Claude to render the ad again.' : 'Could not load the video. Try again.';
      box.hidden = false;
      box.style.display = '';
    });
  }

  function openSheet(ad, tile) {
    lastTile = tile;
    clearVideo();
    var info = renders[ad.campaign_id], watch = $('sheet-watch');
    watch.disabled = false;
    watch.textContent = 'Watch video';
    watch.hidden = !info;
    watch.style.display = info ? '' : 'none'; // .btn's display would otherwise override the hidden attribute
    watch.onclick = function () { if (info) watchVideo(ad, info); };
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
    clearVideo();
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
