(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var id = new URLSearchParams(location.search).get('ad') || '';

  function say(text, href, label) {
    var box = $('msg');
    box.textContent = '';
    var p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    if (href) {
      var a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      box.appendChild(a);
    }
    box.hidden = false;
  }

  // JSON for a <script type="application/json"> tag; "<" is escaped so it cannot close the tag.
  function json(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c')
      .split(String.fromCharCode(8232)).join('\\u2028')
      .split(String.fromCharCode(8233)).join('\\u2029');
  }

  function api(action, input) {
    return fetch('/api/ad-campaigns', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, input: input })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) {
        if (!r.ok || !b || !b.data) throw new Error((b && b.error) || 'Request failed.');
        return b.data;
      });
    });
  }

  // {mediaId: trimInSeconds} for every video layer in the ad.
  function videoLayers(project) {
    var out = {};
    (project.scenes || []).forEach(function (s) {
      var layers = s && s.params && s.params.layers;
      if (!Array.isArray(layers)) return;
      layers.forEach(function (l) {
        if (l && l.shape === 'video' && typeof l.imageId === 'string' && !(l.imageId in out)) out[l.imageId] = Number(l.trimIn) || 0;
      });
    });
    return out;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Download a clip from the media library in its stored chunks and join them.
  function loadClip(mediaId) {
    return api('media_chunk', { media_id: mediaId, index: 0 }).then(function (first) {
      var parts = [b64ToBytes(first.data_base64)], total = first.chunks, next = 1;
      function worker() {
        if (next >= total) return Promise.resolve();
        var i = next++;
        return api('media_chunk', { media_id: mediaId, index: i }).then(function (c) {
          parts[i] = b64ToBytes(c.data_base64);
          return worker();
        });
      }
      var lanes = [];
      for (var n = 0; n < 4; n++) lanes.push(worker());
      return Promise.all(lanes).then(function () { return new Blob(parts, { type: 'video/mp4' }); });
    });
  }

  // One still frame from the clip, as a small JPEG data URI.
  function stillFrom(blob, seconds) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video');
      var url = URL.createObjectURL(blob);
      var finished = false;
      function done(err, value) {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        if (err) reject(err); else resolve(value);
      }
      v.muted = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.onerror = function () { done(new Error('Could not read the clip.')); };
      v.onloadedmetadata = function () {
        v.currentTime = Math.min(seconds + 0.1, Math.max(0, (v.duration || 1) - 0.1));
      };
      v.onseeked = function () {
        try {
          var w = v.videoWidth, h = v.videoHeight, k = Math.min(1, 720 / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * k));
          c.height = Math.max(1, Math.round(h * k));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          done(null, c.toDataURL('image/jpeg', 0.72));
        } catch (e) { done(e); }
      };
      setTimeout(function () { done(new Error('Timed out reading the clip.')); }, 25000);
      v.src = url;
      v.load();
    });
  }

  // Videos with no saved poster get a still taken from the clip itself. Failures leave that clip blank.
  function addStills(project, images) {
    var wanted = videoLayers(project), ids = Object.keys(wanted).filter(function (m) { return !images[m]; });
    if (!ids.length) return Promise.resolve();
    say('Loading footage...');
    return ids.reduce(function (chain, mediaId) {
      return chain.then(function () {
        return loadClip(mediaId).then(function (blob) { return stillFrom(blob, wanted[mediaId]); }).then(function (src) {
          images[mediaId] = { src: src, source: 'uploaded', original: false };
        }).catch(function () {});
      });
    }, Promise.resolve());
  }

  if (!id) { $('title').textContent = 'No ad chosen'; say('Pick an ad from the feed.', '/ads.html', 'Back to Ads'); return; }

  fetch('/api/ad-campaigns', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read', input: { campaign_id: id } })
  }).then(function (res) {
    return res.json().catch(function () { return null; }).then(function (body) {
      if (res.status === 401) { $('title').textContent = 'Signed out'; say('Sign in to Nexus in this browser to see this ad.', '/nexus-login.html', 'Sign in'); return null; }
      if (!res.ok || !body || !body.data) throw new Error((body && body.error) || 'Could not load this ad.');
      return body.data;
    });
  }).then(function (record) {
    if (!record) return;
    var project = record.project || {};
    $('title').textContent = project.name || 'Untitled ad';
    if (project.specVersion !== 2) {
      say('This ad uses the old format and cannot be opened here.', '/ads.html', 'Back to Ads');
      return;
    }
    var imagesReq = fetch('/api/ad-campaigns', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'images', input: { campaign_id: id } })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) { return (b && b.data && b.data.images) || {}; })
      .catch(function () { return {}; });
    return Promise.all([fetch('/ad-designs/vocabulary-player.html').then(function (r) {
      if (!r.ok) throw new Error('Could not load the player.');
      return r.text();
    }), imagesReq]).then(function (parts) {
      var html = parts[0], images = parts[1];
      return addStills(project, images).then(function () {
      var marker = '<div id="stage"></div>';
      if (html.indexOf(marker) < 0) throw new Error('Player format changed.');
      var seeded = html.replace(marker, function () {
        return marker + '<script id="ad-project" type="application/json">' + json(project) + '<\/script>' +
          (Object.keys(images).length ? '<script id="ad-images" type="application/json">' + json(images) + '<\/script>' : '');
      });
      var frame = $('frame');
      frame.srcdoc = seeded;
      frame.hidden = false;
      $('msg').hidden = true;
      });
    });
  }).catch(function (err) {
    say((err && err.message) || 'Could not load this ad.', '/ads.html', 'Back to Ads');
  });
})();
