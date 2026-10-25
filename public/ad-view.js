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
      location.replace('/ad-maker.html?ad=' + encodeURIComponent(id));
      return;
    }
    return fetch('/ad-designs/vocabulary-player.html').then(function (r) {
      if (!r.ok) throw new Error('Could not load the player.');
      return r.text();
    }).then(function (html) {
      var marker = '<div id="stage"></div>';
      if (html.indexOf(marker) < 0) throw new Error('Player format changed.');
      var seeded = html.replace(marker, function () {
        return marker + '<script id="ad-project" type="application/json">' + json(project) + '<\/script>';
      });
      var frame = $('frame');
      frame.srcdoc = seeded;
      frame.hidden = false;
      $('msg').hidden = true;
    });
  }).catch(function (err) {
    say((err && err.message) || 'Could not load this ad.', '/ads.html', 'Back to Ads');
  });
})();
