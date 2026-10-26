(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ads = [];
  var filter = 'all';
  var lastTile = null;
  var loading = false;
  var renders = {};
  var videoUrl = null;
  var plans = {};
  var planCampaign = null;
  var postStatus = 'idea';
  var postPlatform = 'tiktok';
  var PLATFORMS = ['tiktok', 'instagram', 'facebook'];
  var currentAd = null;
  var CAMPAIGN_ID = 'camp-ad-maker-feed';
  var REQ_CAMPAIGN = 'camp-ad-requests';
  var requests = [];
  var hasReqCampaign = false;
  var newFormat = 'portrait';
  var newLength = '15';
  var allVideos = [];
  var accounts = {};
  var logins = {};
  var loginsLoaded = false;
  var mediaCache = null;
  var pickedMedia = [];

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
    return '/ad-view.html?ad=' + encodeURIComponent(ad.campaign_id || '');
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
    var isPosted = function (ad) { var p = bestPlan(ad.campaign_id); return !!(p && p.status === 'posted'); };
    $('stat-ads').textContent = String(ads.length);
    $('stat-cine').textContent = String(ads.filter(function (ad) { return !!renders[ad.campaign_id]; }).length);
    $('stat-studio').textContent = String(ads.filter(isPosted).length);
    var panelMode = filter === 'queue' || filter === 'accounts';
    $('grid').style.display = panelMode ? 'none' : '';
    $('queue').style.display = filter === 'queue' ? '' : 'none';
    $('accounts').style.display = filter === 'accounts' ? '' : 'none';
    if (panelMode) {
      clearMessage();
      setStatus('');
      if (filter === 'queue') renderQueue(); else renderAccounts();
      return;
    }
    var shown = ads.filter(function (ad) {
      if (filter === 'posted') return isPosted(ad);
      if (filter === 'todo') return !isPosted(ad);
      return true;
    });
    var grid = $('grid');
    grid.textContent = '';
    clearMessage();
    setStatus('');
    if (!ads.length) {
      showMessage('No ads yet. Tap New ad to ask for your first one.');
      return;
    }
    if (!shown.length) {
      showMessage('No ads in this view yet.');
      return;
    }
    if (filter === 'all' || filter === 'todo') {
      requests.filter(function (r) { return !r.ad_campaign_id && r.status !== 'posted'; }).forEach(function (r) {
        var rli = document.createElement('li');
        var rt = document.createElement('div');
        rt.className = 'tile pending';
        var rn = document.createElement('span');
        rn.className = 'tile-name';
        rn.textContent = r.title || 'New ad';
        var rm = document.createElement('span');
        rm.className = 'tile-meta';
        rm.textContent = 'Requested';
        rt.appendChild(rn);
        rt.appendChild(rm);
        rli.appendChild(rt);
        grid.appendChild(rli);
      });
    }
    shown.forEach(function (ad) {
      var li = document.createElement('li');
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.style.setProperty('--h', String(hueOf(String(ad.campaign_id || ad.name || ''))));
      var kept = renders[ad.campaign_id];
      if (kept && kept.poster && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(kept.poster)) {
        tile.style.backgroundImage = 'url("' + kept.poster + '")';
        tile.style.backgroundSize = 'cover';
        tile.style.backgroundPosition = 'center';
      }
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
      var plan = bestPlan(ad.campaign_id);
      if (plan && (plan.status === 'posted' || plan.status === 'scheduled' || plan.status === 'ready')) {
        var pb = document.createElement('span');
        pb.className = 'tile-post' + (plan.status === 'posted' ? ' posted' : '');
        pb.textContent = plan.status === 'posted' ? 'Posted' : plan.status === 'scheduled' ? 'Scheduled' : 'Ready';
        tile.appendChild(pb);
      }
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
        loadPlans();
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

  function planKey(adId, platform) { return adId + '|' + platform; }

  // The furthest-along posting across platforms, for the tile tag.
  function bestPlan(adId) {
    var rank = { posted: 3, scheduled: 2, ready: 1 }, best = null;
    PLATFORMS.forEach(function (k) {
      var p = plans[planKey(adId, k)];
      if (p && rank[p.status] && (!best || rank[p.status] > rank[best.status])) best = p;
    });
    return best;
  }

  function rid() {
    if (window.crypto && crypto.randomUUID) return 'req-' + crypto.randomUUID();
    return 'req-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function planApi(action, input, write) {
    var body = { action: action, input: input || {} };
    if (write) body.request_id = rid();
    return fetch('/api/tiktok-plans', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (b) {
        if (!res.ok || !b || !b.data) {
          var e = new Error((b && b.error) || 'Request failed.');
          e.status = res.status;
          throw e;
        }
        return b.data;
      });
    });
  }

  // Posting info for each ad, kept in the TikTok planner. A failure just hides the badges.
  function loadPlans() {
    planApi('overview').then(function (data) {
      plans = {};
      requests = (data.videos || []).filter(function (v) { return v.campaign_id === REQ_CAMPAIGN; });
      allVideos = (data.videos || []).filter(function (v) { return v.campaign_id !== REQ_CAMPAIGN; });
      accounts = {};
      (data.accounts || []).forEach(function (a) { accounts[a.platform] = a; });
      hasReqCampaign = (data.campaigns || []).some(function (c) { return c.id === REQ_CAMPAIGN; });
      (data.videos || []).forEach(function (v) { if (v.ad_campaign_id && v.campaign_id !== REQ_CAMPAIGN) plans[planKey(v.ad_campaign_id, v.platform || 'tiktok')] = v; });
      planCampaign = (data.campaigns || []).filter(function (c) { return c.id === CAMPAIGN_ID; })[0] || null;
      render();
    }).catch(function () {});
  }

  function ensureCampaign() {
    if (planCampaign) return Promise.resolve(planCampaign);
    return planApi('save_campaign', { id: CAMPAIGN_ID, campaign: { name: 'Ad Maker feed', goal: 'Ads posted from the Nexus Ads feed', status: 'active' } }, true)
      .then(function (rec) { planCampaign = rec; return rec; });
  }

  function setPostStatus(status) {
    postStatus = status;
    Array.prototype.forEach.call(document.querySelectorAll('#post-status button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-status') === status ? 'true' : 'false');
    });
    $('post-date-row').style.display = status === 'scheduled' ? '' : 'none';
    $('post-url-row').style.display = status === 'posted' ? '' : 'none';
    $('post-caption').parentNode.style.display = status !== 'idea' ? '' : 'none';
  }

  function postMsg(text, bad) {
    var el = $('post-msg');
    el.textContent = text || '';
    el.className = 'post-msg' + (bad ? ' err' : '');
  }

  function fillPost(ad) {
    postPlatform = PLATFORMS.filter(function (k) { return plans[planKey(ad.campaign_id, k)]; })[0] || 'tiktok';
    showPlatform(ad);
  }

  function showPlatform(ad) {
    Array.prototype.forEach.call(document.querySelectorAll('#post-platform button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-platform') === postPlatform ? 'true' : 'false');
    });
    var p = plans[planKey(ad.campaign_id, postPlatform)];
    setPostStatus(p ? p.status : 'idea');
    $('post-date').value = (p && p.date) || '';
    $('post-caption').value = (p && p.caption) || '';
    $('post-url').value = (p && p.post_url) || '';
    postMsg('');
    $('post-save').disabled = false;
    $('post-save').textContent = 'Save posting';
  }

  function savePost() {
    var ad = currentAd;
    if (!ad) return;
    var status = postStatus, caption = $('post-caption').value.trim(), date = $('post-date').value, url = $('post-url').value.trim();
    if (status !== 'idea' && !caption) { postMsg('Add a caption first.', true); return; }
    if (status === 'scheduled' && !date) { postMsg('Pick a post date.', true); return; }
    if (status === 'posted' && !/^https?:\/\/\S+$/.test(url)) { postMsg('Paste the live post link.', true); return; }
    var platform = postPlatform;
    var old = plans[planKey(ad.campaign_id, platform)];
    var btn = $('post-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    postMsg('');
    ensureCampaign().then(function () {
      var video = {
        campaign_id: CAMPAIGN_ID,
        title: (ad.name || 'Untitled ad').slice(0, 100),
        status: status,
        platform: platform,
        date: status === 'scheduled' ? date : (old && old.date) || '',
        caption: status === 'idea' ? (old && old.caption) || caption : caption,
        post_url: status === 'posted' ? url : (old && old.post_url) || '',
        ad_campaign_id: ad.campaign_id || ''
      };
      if (old) {
        ['hook', 'script', 'hashtags', 'sound', 'video_ref', 'notes', 'scope', 'claimed_by'].forEach(function (k) { if (old[k] !== undefined) video[k] = old[k]; });
      }
      var id = old ? old.id : ('ad-' + String(ad.campaign_id || '').replace(/[^a-zA-Z0-9_-]/g, '-')).slice(0, 88) + '-' + platform;
      return planApi('save_video', { id: id, baseline: old ? old.baseline : undefined, video: video }, true);
    }).then(function (rec) {
      plans[planKey(ad.campaign_id, platform)] = rec;
      allVideos = allVideos.filter(function (x) { return x.id !== rec.id; }).concat([rec]);
      postMsg('Saved.');
      render();
    }).catch(function (err) {
      postMsg((err && err.message) || 'Could not save.', true);
      if (err && err.status === 409) loadPlans();
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Save posting';
    });
  }

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function copyText(text, btn) {
    var label = btn.textContent;
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = label; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { btn.textContent = 'Press and hold to copy'; });
    else btn.textContent = 'Press and hold to copy';
  }

  function adById(id) { return ads.filter(function (a) { return a.campaign_id === id; })[0] || null; }

  function patchVideo(v, patch) {
    var video = {};
    ['campaign_id', 'title', 'status', 'platform', 'date', 'hook', 'script', 'caption', 'hashtags', 'sound', 'video_ref', 'post_url', 'notes', 'claimed_by', 'ad_campaign_id', 'scope'].forEach(function (k) { if (v[k] !== undefined) video[k] = v[k]; });
    Object.keys(patch).forEach(function (k) { video[k] = patch[k]; });
    return planApi('save_video', { id: v.id, baseline: v.baseline, video: video }, true).then(function (rec) {
      allVideos = allVideos.map(function (x) { return x.id === rec.id ? rec : x; });
      if (rec.ad_campaign_id) plans[planKey(rec.ad_campaign_id, rec.platform || 'tiktok')] = rec;
      return rec;
    });
  }

  // Everything marked Ready, Scheduled or Posted, with what the poster needs: caption, ad, and a place to paste the live link.
  function renderQueue() {
    var box = $('queue');
    box.textContent = '';
    var rank = { ready: 0, scheduled: 1, posted: 2 };
    var rows = allVideos.filter(function (v) { return rank[v.status] !== undefined; }).sort(function (a, b) {
      return (rank[a.status] - rank[b.status]) || String(a.date || '9').localeCompare(String(b.date || '9'));
    });
    if (!rows.length) { box.appendChild(mk('p', 'status', 'Nothing in the queue. Open an ad and set its Posting to Ready.')); return; }
    rows.forEach(function (v) {
      var card = mk('div', 'qcard');
      var head = mk('div', 'qhead');
      head.appendChild(mk('b', '', v.title || 'Untitled'));
      head.appendChild(mk('span', 'qtag ' + v.status, v.status));
      card.appendChild(head);
      var meta = [v.platform || 'tiktok', v.date || 'no date'];
      if (v.claimed_by) meta.push(v.claimed_by + ' is posting');
      card.appendChild(mk('p', 'qmeta', meta.join(' · ')));
      if (v.caption) card.appendChild(mk('p', 'qcap', v.caption));
      var row = mk('div', 'qrow');
      var copyBtn = mk('button', 'btn', 'Copy caption');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () { copyText((v.caption || '') + (v.hashtags ? '\n\n' + v.hashtags : ''), copyBtn); });
      row.appendChild(copyBtn);
      var ad = adById(v.ad_campaign_id);
      if (ad) {
        var openBtn = mk('button', 'btn', 'Open ad');
        openBtn.type = 'button';
        openBtn.addEventListener('click', function () { openSheet(ad, null); });
        row.appendChild(openBtn);
      }
      if (v.status === 'posted' && /^https?:\/\/\S+$/.test(v.post_url || '')) {
        var view = mk('a', 'btn', 'View post');
        view.href = v.post_url;
        view.target = '_blank';
        view.rel = 'noopener';
        row.appendChild(view);
      }
      card.appendChild(row);
      if (v.status !== 'posted') {
        var url = document.createElement('input');
        url.type = 'url';
        url.placeholder = 'Paste the live post link';
        url.className = 'qurl';
        var done = mk('button', 'btn primary', 'Mark posted');
        done.type = 'button';
        var msg = mk('p', 'post-msg', '');
        done.addEventListener('click', function () {
          var link = url.value.trim();
          if (!/^https?:\/\/\S+$/.test(link)) { msg.textContent = 'Paste the live post link first.'; msg.className = 'post-msg err'; return; }
          done.disabled = true;
          msg.textContent = '';
          patchVideo(v, { status: 'posted', post_url: link, claimed_by: '' }).then(function () { render(); }).catch(function (err) {
            msg.textContent = (err && err.message) || 'Could not save.';
            msg.className = 'post-msg err';
            done.disabled = false;
            if (err && err.status === 409) loadPlans();
          });
        });
        card.appendChild(url);
        card.appendChild(done);
        card.appendChild(msg);
      }
      box.appendChild(card);
    });
  }

  // The login block under each account: username, a hidden password with tap-to-reveal, edit, and remove.
  // Passwords are encrypted on the server and never come back unless you tap Show.
  function loginBlock(card, p) {
    var cur = logins[p] || null;
    card.appendChild(mk('p', 'qmeta', 'Login (private, only you can see it)'));
    function lfield(label, type, ph) {
      var l = document.createElement('label');
      l.appendChild(document.createTextNode(label));
      var i = document.createElement('input');
      i.type = type;
      i.placeholder = ph;
      i.autocomplete = 'off';
      i.setAttribute('autocapitalize', 'off');
      i.spellcheck = false;
      l.appendChild(i);
      card.appendChild(l);
      return i;
    }
    var user = lfield('Username or email', 'text', 'Login name');
    user.value = (cur && cur.username) || '';
    var pw = lfield('Password', 'password', cur && cur.has_password ? 'Saved. Leave blank to keep it' : 'Password');
    pw.autocomplete = 'new-password';
    var revealed = false;
    var row = mk('div', 'qrow');
    var show = mk('button', 'btn', 'Show');
    show.type = 'button';
    var saveL = mk('button', 'btn primary', 'Save login');
    saveL.type = 'button';
    var rem = mk('button', 'btn', 'Remove login');
    rem.type = 'button';
    row.appendChild(show);
    row.appendChild(saveL);
    row.appendChild(rem);
    card.appendChild(row);
    var msg = mk('p', 'post-msg', '');
    card.appendChild(msg);
    function say(t, bad) { msg.textContent = t || ''; msg.className = 'post-msg' + (bad ? ' err' : ''); }
    function hidePw() { pw.type = 'password'; if (revealed) pw.value = ''; revealed = false; show.textContent = 'Show'; }
    show.addEventListener('click', function () {
      if (pw.type === 'text') { hidePw(); return; }
      if (pw.value || !(logins[p] && logins[p].has_password)) { pw.type = 'text'; show.textContent = 'Hide'; return; }
      show.disabled = true;
      planApi('reveal_login', { platform: p }).then(function (r) {
        pw.value = r.password || '';
        revealed = true;
        pw.type = 'text';
        show.textContent = 'Hide';
        say('');
      }).catch(function (err) { say((err && err.message) || 'Could not show it.', true); })
        .then(function () { show.disabled = false; });
    });
    saveL.addEventListener('click', function () {
      saveL.disabled = true;
      say('');
      var input = { platform: p, username: user.value.trim() };
      if (pw.value) input.password = pw.value;
      planApi('save_login', input).then(function (rec) {
        logins[p] = rec;
        hidePw();
        pw.value = '';
        pw.placeholder = rec.has_password ? 'Saved. Leave blank to keep it' : 'Password';
        say('Saved.');
      }).catch(function (err) { say((err && err.message) || 'Could not save.', true); })
        .then(function () { saveL.disabled = false; });
    });
    rem.addEventListener('click', function () {
      if (!logins[p]) { say('Nothing saved yet.'); return; }
      if (!window.confirm('Remove the saved login for ' + p + '?')) return;
      rem.disabled = true;
      planApi('delete_login', { platform: p }).then(function () {
        delete logins[p];
        hidePw();
        user.value = '';
        pw.value = '';
        pw.placeholder = 'Password';
        say('Removed.');
      }).catch(function (err) { say((err && err.message) || 'Could not remove.', true); })
        .then(function () { rem.disabled = false; });
    });
  }

  function renderAccounts() {
    var box = $('accounts');
    box.textContent = '';
    if (!loginsLoaded) {
      loginsLoaded = true;
      planApi('login_status').then(function (d) {
        logins = {};
        (d.logins || []).forEach(function (l) { logins[l.platform] = l; });
        renderAccounts();
      }).catch(function () { loginsLoaded = false; });
    }
    box.appendChild(mk('p', 'qmeta', 'Handle, link, and a private login for each account. Passwords are encrypted, hidden by default, and only you can reveal them. Claude and ChatGPT sign in through the browser.'));
    PLATFORMS.forEach(function (p) {
      var cur = accounts[p] || null;
      var card = mk('div', 'qcard');
      card.appendChild(mk('b', '', p.charAt(0).toUpperCase() + p.slice(1)));
      function field(label, value, type, ph) {
        var l = document.createElement('label');
        l.appendChild(document.createTextNode(label));
        var i = document.createElement('input');
        i.type = type;
        i.value = value || '';
        i.placeholder = ph;
        l.appendChild(i);
        card.appendChild(l);
        return i;
      }
      var h = field('Handle', cur && cur.handle, 'text', '@yourname');
      var u = field('Profile link', cur && cur.profile_url, 'url', 'https://...');
      var n = field('Notes', cur && cur.notes, 'text', 'Anything the poster should know');
      var save = mk('button', 'btn primary', 'Save');
      save.type = 'button';
      var msg = mk('p', 'post-msg', '');
      save.addEventListener('click', function () {
        var now = accounts[p] || null;
        save.disabled = true;
        msg.textContent = '';
        msg.className = 'post-msg';
        planApi('save_account', { baseline: now ? now.baseline : undefined, account: { platform: p, handle: h.value.trim(), profile_url: u.value.trim(), notes: n.value.trim() } }, true)
          .then(function (rec) { accounts[p] = rec; msg.textContent = 'Saved.'; })
          .catch(function (err) {
            msg.textContent = (err && err.message) || 'Could not save.';
            msg.className = 'post-msg err';
            if (err && err.status === 409) loadPlans();
          })
          .then(function () { save.disabled = false; });
      });
      card.appendChild(save);
      card.appendChild(msg);
      loginBlock(card, p);
      box.appendChild(card);
    });
  }

  function loadMediaPicker() {
    var box = $('newad-media');
    pickedMedia = [];
    function paint() {
      box.textContent = '';
      if (!mediaCache || !mediaCache.length) { box.appendChild(mk('p', 'qmeta', mediaCache ? 'No files in your media library yet.' : 'Loading your media...')); return; }
      mediaCache.forEach(function (m) {
        var b = mk('button', 'mpick');
        b.type = 'button';
        b.title = m.name || '';
        b.setAttribute('aria-pressed', pickedMedia.indexOf(m.media_id) >= 0 ? 'true' : 'false');
        if (m.preview && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(m.preview)) {
          b.style.backgroundImage = 'url("' + m.preview + '")';
        }
        b.appendChild(mk('span', 'mname', m.name || m.media_id));
        b.addEventListener('click', function () {
          var i = pickedMedia.indexOf(m.media_id);
          if (i >= 0) pickedMedia.splice(i, 1); else if (pickedMedia.length < 5) pickedMedia.push(m.media_id);
          paint();
        });
        box.appendChild(b);
      });
    }
    paint();
    if (mediaCache) return;
    api('media_list').then(function (d) { mediaCache = (d && d.media) || []; paint(); }).catch(function () { mediaCache = []; paint(); });
  }

  function buildNotes(text) {
    var head = 'New ad request. Shape: ' + newFormat + '. Length: ' + newLength + 's.\n';
    var attach = pickedMedia.map(function (id) {
      var m = (mediaCache || []).filter(function (x) { return x.media_id === id; })[0];
      return (m && m.name ? m.name : 'file') + ' (' + id + ')';
    });
    var tail = attach.length ? '\nAttach from media library: ' + attach.join(', ') : '';
    return head + text.slice(0, Math.max(0, 1000 - head.length - tail.length)) + tail;
  }

  function newMsg(text, bad) {
    var el = $('newad-msg');
    el.textContent = text || '';
    el.className = 'post-msg' + (bad ? ' err' : '');
  }

  function openNewAd() {
    $('newad-text').value = '';
    newMsg('');
    $('newad-send').disabled = false;
    $('newad-send').textContent = 'Send request';
    $('newad').hidden = false;
    loadMediaPicker();
    $('newad-text').focus();
  }

  function closeNewAd() { $('newad').hidden = true; }

  function pickSeg(groupId, onPick) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + groupId + ' button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('#' + groupId + ' button'), function (o) {
          o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
        });
        onPick(b.getAttribute('data-value'));
      });
    });
  }

  // A new-ad request is a planner record in the Ad requests campaign. Claude or ChatGPT reads it, builds the ad, and links it back.
  function sendRequest() {
    var text = $('newad-text').value.trim();
    if (!text) { newMsg('Say what the ad should be.', true); return; }
    var btn = $('newad-send');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    newMsg('');
    var ready = hasReqCampaign ? Promise.resolve() : planApi('save_campaign', { id: REQ_CAMPAIGN, campaign: { name: 'Ad requests', goal: 'New ads asked for from the Ads feed', status: 'active' } }, true).then(function () { hasReqCampaign = true; });
    ready.then(function () {
      var id = 'req-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var title = text.split('\n')[0].slice(0, 100);
      var video = {
        campaign_id: REQ_CAMPAIGN,
        title: title,
        status: 'idea',
        platform: 'tiktok',
        notes: buildNotes(text)
      };
      return planApi('save_video', { id: id, video: video }, true);
    }).then(function (rec) {
      requests.push(rec);
      render();
      newMsg('Sent. Tell Claude or ChatGPT to pick it up.');
      btn.textContent = 'Sent';
      setTimeout(closeNewAd, 1200);
    }).catch(function (err) {
      newMsg((err && err.message) || 'Could not send.', true);
      btn.disabled = false;
      btn.textContent = 'Send request';
    });
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
      var req = info.source === 'library' ? api('media_chunk', { media_id: info.media_id, index: i }) : api('render_chunk', { job_id: info.job_id, index: i });
      return req.then(function (c) {
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
    currentAd = ad;
    fillPost(ad);
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
    $('sheet-open').textContent = 'Play ad';
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
  $('post-save').addEventListener('click', savePost);
  $('newad-btn').addEventListener('click', openNewAd);
  $('newad-plus').addEventListener('click', openNewAd);
  $('newad-close').addEventListener('click', closeNewAd);
  $('newad-backdrop').addEventListener('click', closeNewAd);
  $('newad-send').addEventListener('click', sendRequest);
  pickSeg('newad-format', function (v) { newFormat = v; });
  pickSeg('newad-length', function (v) { newLength = v; });
  Array.prototype.forEach.call(document.querySelectorAll('#post-platform button'), function (b) {
    b.addEventListener('click', function () { postPlatform = b.getAttribute('data-platform'); if (currentAd) showPlatform(currentAd); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#post-status button'), function (b) {
    b.addEventListener('click', function () { setPostStatus(b.getAttribute('data-status')); });
  });
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
