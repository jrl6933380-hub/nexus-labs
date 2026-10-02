// /public/forge-views.js
//
// Forge's rooms. Same shell as the operator workspace, different furniture.
//
// Nex is the same identity here, with a Forge tool belt and a Forge persona:
// he is walking a customer into building something, not running a business with
// them. So no operator jargon in any string in this file — no PRs, deploys,
// board tasks, agents or tiers. If a sentence here would confuse someone who
// has never written code, it is wrong.
//
// Same rules as the operator views: response shapes are not assumed, a view
// that cannot load says so honestly and offers Nex instead, and there is no
// second level of navigation anywhere.

export { esc, pick, getJSON, field, relative, say, row, group, chips, empty, pill } from '/workspace-views.js';
import { esc, pick, getJSON, field, relative, say, row, group, chips, empty } from '/workspace-views.js';

// Mirrors lib/forge/features.js. The server is the real gate; this is what the
// customer sees. Kept as plain data so the two stay readable side by side.
const TIER_ORDER = ['free', 'fast', 'strong'];
const tierRank = (tier) => TIER_ORDER.indexOf(String(tier || '').toLowerCase());

const FEATURES = [
  { id:'build', name:'Build from a description', requires:'free',
    blurb:'Describe what you want and get a working page.' },
  { id:'edit', name:'Change what you built', requires:'free',
    blurb:'Ask for changes and I patch the page instead of rebuilding it.' },
  { id:'brief', name:'Project Brief', requires:'fast',
    blurb:'I interview you first — audience, goals, must-haves — then build from your answers instead of guessing.',
    reason:'Planning takes several passes before anything gets built. On the free router that means a lot of waiting and a lot of rate limits, so it needs a paid brain to feel good.' },
  { id:'stack', name:'Full stack setup', requires:'strong',
    blurb:'Database, auth, and payments wired into your project.',
    reason:'Setup involves long multi-step reasoning where a wrong call costs real money, so it runs on the strongest tier only.' },
];

export function featureUnlocked(connection, id) {
  const feature = FEATURES.find((f) => f.id === id);
  if (!feature) return false;
  if (!connection?.connected) return false;
  return tierRank(connection.tier) >= tierRank(feature.requires);
}

// Cached per view render so each view does not re-fetch the connection.
let cachedConnection = null;
export async function loadConnection() {
  try { cachedConnection = await getJSON('/api/forge-brain'); }
  catch { cachedConnection = null; }
  return cachedConnection;
}
export function connectionSnapshot() { return cachedConnection; }

function briefQuestionCard(question, progress, ctx) {
  const card = document.createElement('section');
  card.className = 'qcard';
  card.setAttribute('aria-label', question.question);

  const head = document.createElement('div');
  head.className = 'qhead';
  head.innerHTML = `<span>Project brief · ${progress.answered + 1} of ${progress.required}</span><strong>${esc(question.question)}</strong><small>${esc(question.helper || '')}</small>`;
  card.appendChild(head);

  const selected = new Set();
  let longText = null;
  if (question.type === 'long_text') {
    longText = document.createElement('textarea');
    longText.className = 'qcomment qmain';
    longText.placeholder = question.placeholder || 'Tell Nex a little more…';
    longText.rows = 4;
    card.appendChild(longText);
  } else {
    const options = document.createElement('div');
    options.className = 'qoptions';
    for (const option of question.options || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'qoption';
      button.textContent = option.label;
      button.dataset.value = option.value;
      button.setAttribute('aria-pressed', 'false');
      button.onclick = () => {
        if (question.type === 'single_select') {
          selected.clear();
          for (const sibling of options.querySelectorAll('.qoption')) {
            sibling.classList.remove('picked');
            sibling.setAttribute('aria-pressed', 'false');
          }
        }
        if (selected.has(option.value)) {
          selected.delete(option.value);
          button.classList.remove('picked');
          button.setAttribute('aria-pressed', 'false');
        } else {
          selected.add(option.value);
          button.classList.add('picked');
          button.setAttribute('aria-pressed', 'true');
        }
      };
      options.appendChild(button);
    }
    card.appendChild(options);
  }

  let comment = null;
  if (question.allow_comment) {
    comment = document.createElement('textarea');
    comment.className = 'qcomment';
    comment.placeholder = 'Add a focused note for Nex (optional)…';
    comment.rows = 2;
    card.appendChild(comment);
  }

  const actions = document.createElement('div');
  actions.className = 'qactions';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'qsave';
  save.textContent = 'Save and continue';
  const error = document.createElement('span');
  error.className = 'qerror';
  save.onclick = async () => {
    save.disabled = true;
    error.textContent = '';
    try {
      const values = question.type === 'long_text' ? longText.value.trim() : [...selected];
      await ctx.answerBrief(question.id, values, comment?.value.trim() || '');
    } catch (failure) {
      error.textContent = failure.message || 'Choose an answer first.';
      save.disabled = false;
    }
  };
  actions.append(save, error);
  card.appendChild(actions);
  return card;
}

// Shared by the `project` (home) and `pages` views — both list saved
// projects. Built manually rather than through row() because a delete
// action needs its own separate click target, and row() only supports one
// (nesting a <button> inside the <button> row() returns is invalid HTML and
// behaves unpredictably in browsers).
function projectRow(project, ctx) {
  const projectId = field(project, 'projectId', 'key');
  const buildId = field(project, 'latestBuildId', 'id');
  const versions = field(project, 'versionCount');
  const meta = [
    versions ? `${versions} version${versions === 1 ? '' : 's'}` : '',
    relative(field(project, 'updatedAt', 'updated_at', 'createdAt', 'created_at', 'ts')),
  ].filter(Boolean).join(' · ');

  const wrap = document.createElement('div');
  wrap.className = 'lrow';

  const open = document.createElement('button');
  open.type = 'button';
  open.style.cssText = 'flex:1;min-width:0;text-align:left;background:none;border:0;color:inherit;font:inherit;padding:0;cursor:pointer';
  const title = document.createElement('div');
  title.className = 'lt';
  title.textContent = String(field(project, 'label', 'title', 'name', 'prompt', 'id')).slice(0, 90);
  open.appendChild(title);
  if (meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'lm';
    metaEl.textContent = meta;
    open.appendChild(metaEl);
  }
  if (buildId) open.onclick = () => ctx.openBuild(buildId);
  wrap.appendChild(open);

  // Go live / take offline -- carried over from the retired Room Builder so
  // hosting a finished site is still one tap. Same /api/room-publish
  // contract: POST {id} to deploy, DELETE ?projectId= to take it down.
  if (buildId) {
    const pill = 'margin-left:10px;flex-shrink:0;font-size:11px;padding:4px 9px;border-radius:20px;border:0;cursor:pointer;';
    const liveBtn = document.createElement('button');
    liveBtn.type = 'button';
    const offBtn = document.createElement('button');
    offBtn.type = 'button';
    offBtn.textContent = 'Take offline';
    offBtn.style.cssText = pill + 'background:#2b2418;color:#e6c07b';
    let liveUrl = project && project.liveUrl ? String(project.liveUrl) : '';
    const paint = () => {
      liveBtn.disabled = false;
      liveBtn.textContent = liveUrl ? 'Live \u2197' : 'Go live';
      liveBtn.title = liveUrl ? liveUrl : 'Put this project on a real, live web address.';
      liveBtn.style.cssText = pill + (liveUrl ? 'background:#16372a;color:#8fe0b0' : 'background:#1d2a44;color:#9cc0ff');
      offBtn.hidden = !liveUrl || !projectId;
      offBtn.disabled = false;
    };
    liveBtn.onclick = async (event) => {
      event.stopPropagation();
      if (liveUrl) { window.open(liveUrl, '_blank', 'noopener'); return; }
      liveBtn.disabled = true;
      liveBtn.textContent = 'Going live\u2026';
      try {
        const res = await fetch('/api/room-publish', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: buildId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 402) {
          paint();
          if (window.confirm(data.error || 'Going live is part of a paid plan. See plans?')) window.location.href = '/forge.html?view=billing';
          return;
        }
        if (!res.ok || !data.url) throw new Error(data.error || 'Could not put this site live.');
        liveUrl = data.url;
        paint();
        window.open(liveUrl, '_blank', 'noopener');
      } catch (err) {
        paint();
        window.alert(err.message || 'Could not put this site live.');
      }
    };
    offBtn.onclick = async (event) => {
      event.stopPropagation();
      if (!window.confirm('Take this site offline? ' + liveUrl + ' will stop working.')) return;
      offBtn.disabled = true;
      offBtn.textContent = 'Taking down\u2026';
      try {
        const res = await fetch('/api/room-publish?projectId=' + encodeURIComponent(projectId), { method: 'DELETE', credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not take this site offline.');
        liveUrl = '';
        offBtn.textContent = 'Take offline';
        paint();
      } catch (err) {
        offBtn.textContent = 'Take offline';
        paint();
        window.alert(err.message || 'Could not take this site offline.');
      }
    };
    paint();
    wrap.append(liveBtn, offBtn);
  }

  if (projectId && ctx.deleteProject) {
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.style.cssText = 'margin-left:10px;flex-shrink:0;font-size:11px;padding:4px 9px;border-radius:20px;background:#2b1818;color:#e39a9a;border:0;cursor:pointer';
    del.onclick = (event) => {
      event.stopPropagation();
      ctx.deleteProject(projectId, field(project, 'label', 'title', 'name'));
    };
    wrap.appendChild(del);
  }

  return wrap;
}

async function workbenchProjectTiles(ctx) {
  const grid = document.createElement('div');
  grid.className = 'workbench-project-grid';
  grid.setAttribute('aria-label', 'Workbench panels');

  let projects = [];
  try {
    const history = await getJSON('/api/room-history');
    projects = pick(history, 'projects', 'builds', 'history', 'items').slice(0, 12);
  } catch {}
  if (!projects.length && ctx.hasCurrentBuild?.()) {
    projects = [{
      latestBuildId: null,
      mainLabel: ctx.currentProjectLabel?.() || 'Current panel',
      stackItems: [],
      currentHtml: ctx.currentBuild?.() || '',
    }];
  }

  const previews = await Promise.all(projects.map(async (project) => {
    if (project.currentHtml) return project.currentHtml;
    const buildId = field(project, 'latestBuildId', 'id');
    if (!buildId) return '';
    try { return (await getJSON('/api/room-history?id=' + encodeURIComponent(buildId)))?.build?.html || ''; }
    catch { return ''; }
  }));

  projects.forEach((project, index) => {
    const buildId = field(project, 'latestBuildId', 'id');
    const parts = Array.isArray(project.stackItems) ? project.stackItems : [];
    const stack = document.createElement('article');
    stack.className = `workbench-project-stack${parts.length ? ' has-parts' : ''}`;
    const deck = document.createElement('div');
    deck.className = 'workbench-stack-deck';
    const current = document.createElement('button');
    current.type = 'button';
    current.className = 'workbench-project-tile';
    const projectLabel = String(field(project, 'mainLabel', 'label', 'title', 'name') || 'Untitled panel').slice(0, 80);
    current.setAttribute('aria-label', `Open ${projectLabel} in Full Preview`);
    const frame = document.createElement('iframe');
    frame.title = '';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = previews[index] || '';
    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = projectLabel;
    current.append(frame, label);
    current.onclick = buildId ? () => ctx.openBuild(buildId, 'preview', projectLabel) : () => ctx.go('preview');
    deck.appendChild(current);
    stack.appendChild(deck);

    if (parts.length) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'workbench-stack-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = `<span>${parts.length} supporting piece${parts.length === 1 ? '' : 's'}</span><b>⌄</b>`;
      const fan = document.createElement('div');
      fan.className = 'workbench-stack-parts';
      for (const part of parts) {
        const card = document.createElement('div');
        card.className = `workbench-stack-part ${part.kind || 'page'}`;
        card.innerHTML = `<small>${esc(part.kind || 'page')}</small><strong>${esc(String(part.label || 'Supporting piece').slice(0, 80))}</strong>`;
        fan.appendChild(card);
      }
      toggle.onclick = () => {
        const open = stack.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.querySelector('b').textContent = open ? '⌃' : '⌄';
      };
      stack.append(toggle, fan);
    }
    const actions = document.createElement('div');
    actions.className = 'workbench-project-actions';
    for (const [label, destination] of [['Edit with Nex', 'chat'], ['Add a piece', 'pages']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('aria-label', `${label} to ${projectLabel}`);
      button.onclick = async () => {
        button.disabled = true;
        try {
          if (buildId) await ctx.openBuild(buildId, destination, projectLabel);
          else await ctx.go(destination);
        } finally { button.disabled = false; }
      };
      actions.appendChild(button);
    }
    stack.appendChild(actions);
    grid.appendChild(stack);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'workbench-project-tile add-panel';
  add.setAttribute('aria-label', 'Start a new Workbench panel');
  add.innerHTML = '<span class="plus">+</span><strong>New panel</strong><small>Add to your Workbench</small>';
  add.onclick = () => ctx.startProject();
  grid.appendChild(add);
  return grid;
}

async function liveSiteGallery(projects, ctx) {
  const grid = document.createElement('div');
  grid.className = 'live-sites-grid';
  const previews = await Promise.all(projects.map(async (project) => {
    const buildId = field(project, 'latestBuildId', 'id');
    if (!buildId) return '';
    try { return (await getJSON('/api/room-history?id=' + encodeURIComponent(buildId)))?.build?.html || ''; }
    catch { return ''; }
  }));

  const continueInProject = async (project, prompt) => {
    const buildId = field(project, 'latestBuildId', 'id');
    if (buildId) await ctx.openBuild(buildId, 'chat');
    ctx.ask(prompt);
  };

  projects.forEach((project, index) => {
    const buildId = field(project, 'latestBuildId', 'id');
    const liveUrl = String(field(project, 'liveUrl') || '');
    const title = String(field(project, 'mainLabel', 'label', 'title', 'name') || 'Live site').slice(0, 80);
    const card = document.createElement('article');
    card.className = 'live-site-card';
    const preview = document.createElement('button');
    preview.type = 'button'; preview.className = 'live-site-preview';
    preview.setAttribute('aria-label', `Open live site ${title}`);
    preview.onclick = () => ctx.openExternal(liveUrl);
    if (previews[index]) {
      const frame = document.createElement('iframe');
      frame.title = ''; frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.srcdoc = previews[index];
      preview.appendChild(frame);
    }
    const badge = document.createElement('span'); badge.className = 'live-site-badge'; badge.textContent = 'LIVE';
    preview.appendChild(badge);

    const body = document.createElement('div'); body.className = 'live-site-body';
    const heading = document.createElement('h3'); heading.textContent = title;
    const url = document.createElement('span'); url.className = 'live-site-url'; url.textContent = liveUrl;
    const actions = document.createElement('div'); actions.className = 'live-site-actions';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'primary'; open.textContent = 'Open site'; open.onclick = () => ctx.openExternal(liveUrl);
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy link';
    copy.onclick = async () => { await ctx.copyText(liveUrl); copy.textContent = 'Copied ✓'; setTimeout(() => { if (copy.isConnected) copy.textContent = 'Copy link'; }, 1600); };
    const maintain = document.createElement('button'); maintain.type = 'button'; maintain.textContent = 'Maintain with Nex';
    maintain.onclick = () => continueInProject(project, 'Review my live site for anything that needs maintenance, updating, or fixing. Ask before making changes.');
    actions.append(open, copy, maintain);

    const care = document.createElement('div'); care.className = 'live-site-care';
    const feature = document.createElement('button'); feature.type = 'button'; feature.textContent = '+ Add a feature';
    feature.onclick = () => continueInProject(project, 'I want to add a paid feature or supporting page to this live site. Help me scope the best next addition before building it.');
    const help = document.createElement('button'); help.type = 'button'; help.textContent = 'Get Nexus help';
    help.onclick = () => continueInProject(project, 'Show me the paid Nexus help options for maintaining or improving this live site, and help me choose the right level.');
    care.append(feature, help);
    body.append(heading, url, actions, care);
    card.append(preview, body);
    grid.appendChild(card);
  });
  return grid;
}

// A filling circle, not a number.
//
// The customer's real question is "can I keep going", and a ring answers it
// at a glance without asking anyone to learn what a credit is or do
// arithmetic in it. Rendered as SVG rather than a CSS conic-gradient so it
// looks identical across the mobile browsers Forge is mostly used on.
//
// The ring is drawn from `percentRemaining` — it EMPTIES as usage is spent,
// which matches the mental model of a tank draining rather than a bill
// mounting up.
function usageRing(percentRemaining, { size = 54 } = {}) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Number(percentRemaining) || 0));
  const filled = (clamped / 100) * circumference;
  // Under a fifth left is worth flagging visually, but in a warm colour
  // rather than an alarming one: running low on a free allowance is the
  // expected shape of the product, not an error the customer made.
  const colour = clamped <= 20 ? '#c9752a' : '#c9a227';

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');

  const track = document.createElementNS(svgNs, 'circle');
  track.setAttribute('cx', String(size / 2));
  track.setAttribute('cy', String(size / 2));
  track.setAttribute('r', String(radius));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'rgba(255,255,255,0.12)');
  track.setAttribute('stroke-width', String(stroke));
  svg.appendChild(track);

  const arc = document.createElementNS(svgNs, 'circle');
  arc.setAttribute('cx', String(size / 2));
  arc.setAttribute('cy', String(size / 2));
  arc.setAttribute('r', String(radius));
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', colour);
  arc.setAttribute('stroke-width', String(stroke));
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-dasharray', `${circumference} ${circumference}`);
  arc.setAttribute('stroke-dashoffset', String(circumference - filled));
  arc.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  arc.style.transition = 'stroke-dashoffset 600ms ease';
  svg.appendChild(arc);

  return svg;
}

/** "refills in about 4 hours" — an empty ring should read as a wait, not a wall. */
function refillCopy(resetAt) {
  const ms = Number(resetAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Refills shortly.';
  const hours = Math.round(ms / 3_600_000);
  if (hours >= 2) return `Refills in about ${hours} hours.`;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `Refills in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export const FORGE_VIEWS = {
  usage: {
    label: 'Usage',
    icon: '\u25d4',
    say: ['usage', 'credits', 'limit', 'how much'],
    async render(ctx) {
      const nodes = [];
      let usage = null;
      try { usage = await getJSON('/api/forge-usage'); } catch {}

      if (usage?.unlimited) {
        nodes.push(say('You have unlimited building.'));
        return nodes;
      }

      // A failed read omits the ring rather than guessing: a wrongly full or
      // wrongly empty circle is worse than no circle.
      if (!usage || usage.unknown) {
        nodes.push(say("Couldn't check your usage just now — try again in a moment."));
        return nodes;
      }

      const percent = Number(usage.percentRemaining) || 0;
      const panel = document.createElement('div');
      panel.style.cssText = 'display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.04);border-radius:16px;padding:18px';
      panel.appendChild(usageRing(percent));

      const text = document.createElement('div');
      const headline = document.createElement('div');
      headline.style.cssText = 'font-weight:700;margin-bottom:3px';
      headline.textContent = usage.empty
        ? 'Out of building for today'
        : percent <= 20 ? 'Running low' : 'Building available';
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:0.85rem;opacity:0.7';
      sub.textContent = refillCopy(usage.resetAt);
      text.appendChild(headline);
      text.appendChild(sub);
      panel.appendChild(text);
      nodes.push(panel);

      nodes.push(say(usage.empty
        ? 'Grab a usage pack to keep building now, or come back when it refills.'
        : 'Need more than the daily refill? A usage pack tops you up straight away.'));

      nodes.push(chips([
        { label: 'Get a usage pack', run: () => ctx.buyUsagePack?.() },
      ]));
      return nodes;
    },
  },

  project: {
    label: 'Your Project',
    icon: '◇',
    say: ['project', 'my project', 'home'],
    async render(ctx) {
      if (ctx.surface?.() === 'workbench') {
        return [
          say('Choose a project below. Tap its preview to see the full site, or Add a piece on that project to grow its stack.'),
          say('One stack becomes one live site. Nex builds supporting pages and tools into the same project as you add them. When you go live, the latest combined site is published on one link. Stack cards are visual guides to what you have added.'),
          await workbenchProjectTiles(ctx),
          chips([
            { label: ctx.hasCurrentBuild?.() ? 'Edit with Nex' : 'Start building', run: () => ctx.go('chat') },
            ...(ctx.hasCurrentBuild?.() ? [{ label: 'Connections', run: () => ctx.go('stack') }] : []),
          ]),
        ];
      }
      const nodes = [];
      let history = null;
      try { history = await getJSON('/api/room-history'); } catch {}
      const builds = pick(history, 'builds', 'history', 'items');
      const projects = pick(history, 'projects');

      nodes.push(say(builds.length
        ? `Here's what you've built so far. Pick one up, or tell me something new and I'll start it.`
        : `Nothing built yet. I'll ask a few focused questions first, then build the first version from your real answers instead of guessing.`));

      if (projects.length || builds.length) {
        nodes.push(group(null, (projects.length ? projects : builds).slice(0, 12).map((item) => projectRow(item, ctx))));
      }

      nodes.push(chips([
        { label: 'Start something new', run: () => ctx.startProject() },
        { label: 'What can you build', run: () => ctx.ask('What kinds of things can you build for me?') },
      ]));
      return nodes;
    },
  },

  live: {
    label: 'Live Sites',
    icon: '↗',
    say: ['live sites', 'published sites', 'launched sites'],
    async render(ctx) {
      let payload = null;
      try { payload = await getJSON('/api/room-history'); } catch {}
      const projects = pick(payload, 'projects', 'builds');
      const live = projects.filter((project) => field(project, 'liveUrl'));
      if (!live.length) {
        return [
          say('Published sites will live here after the project stage. You will be able to open them, share them, maintain them with Nex, and add paid help or features without rebuilding from scratch.'),
          empty('No live sites yet.'),
          chips([
            { label: 'Open Projects', run: () => ctx.go('project') },
            { label: 'How publishing works', run: () => ctx.ask('Explain how I take a Workbench project live and maintain it afterward.') },
          ]),
        ];
      }
      return [
        say(`${live.length} live site${live.length === 1 ? '' : 's'} in one maintainable home. Open or share a site, keep it healthy with Nex, or add features and hands-on Nexus help whenever it needs to grow.`),
        await liveSiteGallery(live, ctx),
      ];
    },
  },

  brief: {
    label: 'Project Brief',
    icon: '✦',
    say: ['brief', 'project brief', 'questions', 'plan my project'],
    async render(ctx) {
      const nodes = [];
      let brief = null;
      let unavailable = null;
      try {
        const response = await fetch('/api/forge-brief?projectId=' + encodeURIComponent(ctx.projectId()) + '&mode=' + (ctx.hasCurrentBuild?.() ? 'addon' : 'new'), {
          credentials: 'include', headers: { Accept:'application/json' }, cache:'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) brief = data;
        else unavailable = { status:response.status, code:data.code, reason:data.error };
      } catch {}
      if (unavailable?.code === 'TIER_REQUIRED') {
        return [
          say('Project Brief needs a Fast Builder Brain because it asks several planning questions. You can build a first version directly with your Free Brain now.'),
          chips([
            { label:'Build with Free', run:() => ctx.go('chat') },
            { label:'Change Brain option', run:() => ctx.go('brain') },
          ]),
        ];
      }
      if (unavailable?.status === 401) {
        return [say('Sign in to save a Project Brief to your Forge account.'),
          chips([{ label:'Sign in', run:() => ctx.signIn() }])];
      }
      if (!brief?.progress) {
        return [
          say(`I couldn't load your Project Brief just now. None of your answers were changed.`),
          chips([{ label: 'Try again', run: () => ctx.go('brief') }]),
        ];
      }

      const addon = brief.mode === 'addon';
      if (addon) {
        nodes.push(say(`Planning an addition to “${brief.project?.label || ctx.currentProjectLabel?.() || 'your project'}”. Your original plan and existing site stay intact.`));
        if (brief.connections?.length) nodes.push(group('Connections for this plan', brief.connections.map(connection => row({ title: connection.label, meta: `${connection.status === 'ready' ? 'Tested and ready' : 'Needs a check or setup'} · ${connection.purpose}` }))));
        if (brief.contextUnavailable?.length) nodes.push(say('Some saved project context could not be loaded. Connection readiness is unconfirmed until its check passes.'));
      }
      if (!brief.progress.ready && brief.next_question) {
        nodes.push(say(`I'll collect the important decisions one at a time. Each answer saves automatically, and the next question adapts to your project.`));
        nodes.push(briefQuestionCard(brief.next_question, brief.progress, ctx));
        return nodes;
      }

      nodes.push(say(addon ? 'Your add-on plan is ready. Review the change and its connections, then approve it to update this project.' : `Your Project Brief is ready. This is the information I'll use as the source of truth for the first build.`));
      nodes.push(group('What Nex understands', (brief.summary || []).map((item) => row({
        title: item.value || 'Answered',
        meta: `${item.label}${item.comment ? ` · ${item.comment}` : ''}`,
        tone: { label: 'saved', kind: 'f' },
      }))));
      nodes.push(chips([
        { label: addon ? 'Approve & build addition' : 'Build the first version', run: () => ctx.buildFromBrief() },
        { label: addon ? 'Start another add-on plan' : 'Start the brief over', run: () => ctx.resetBrief() },
      ]));
      return nodes;
    },
  },

  pages: {
    label: 'Pages',
    icon: '▤',
    say: ['pages', 'page'],
    async render(ctx) {
      if (ctx.surface?.() === 'workbench') {
        if (!ctx.hasCurrentBuild?.()) {
          return [say('Choose the project you want to add to, then tap Add a piece on its card.'), await workbenchProjectTiles(ctx)];
        }
        const selected = document.createElement('div');
        selected.className = 'workbench-selected-project';
        const caption = document.createElement('small');
        caption.textContent = 'Adding to project';
        const name = document.createElement('strong');
        name.textContent = ctx.currentProjectLabel?.() || 'Your project';
        selected.append(caption, name);
        return [
          selected,
          chips([{ label: 'Choose a different project', run: () => ctx.go('project') }]),
          say('Add a page, tool, dashboard, workflow, or intelligence to this project. Nex builds it into the same site while keeping the existing pieces. When you go live, the latest combined project shares one link; stack cards are visual guides to its pieces.'),
          chips([
            { label: 'Add a page', run: () => ctx.ask('Add a supporting page to this project. Ask what it should do and how it connects to the main experience.', { stackItem: { kind: 'page' } }) },
            { label: 'Add a tool', run: () => ctx.ask('Add a useful tool, dashboard, calculator, or workflow to this project. Ask what should power it and who will use it.', { stackItem: { kind: 'tool' } }) },
            { label: 'Add an intelligence', run: () => ctx.ask('Add an intelligence that helps run or support this main project. Ask what it should know, watch, and do.', { stackItem: { kind: 'intelligence' } }) },
            { label: 'Review the whole stack', run: () => ctx.ask('Review the main project and every supporting piece as one stack. Tell me what is missing or disconnected.') },
          ]),
        ];
      }
      const nodes = [];
      let history = null;
      try { history = await getJSON('/api/room-history'); } catch {}
      const projects = pick(history, 'projects', 'builds', 'history', 'items');

      nodes.push(say(projects.length
        ? `Your saved projects. Open one to change it, or delete it if you're done with it.`
        : `No projects yet. Once we build something, it shows up here.`));

      if (projects.length) {
        nodes.push(group(null, projects.slice(0, 12).map((item) => projectRow(item, ctx))));
      } else {
        nodes.push(empty('Nothing here yet.'));
      }

      nodes.push(chips([
        { label: 'Add a page', run: () => ctx.ask('I want to add a page. Ask me what it should do.') },
        { label: 'Change the look', run: () => ctx.ask('I want to change how my site looks. Show me some directions.') },
      ]));
      return nodes;
    },
  },

  preview: {
    label: 'Preview',
    icon: '◱',
    say: ['preview', 'my site', 'live'],
    async render(ctx) {
      if (ctx.surface?.() === 'workbench') {
        return [
          say('Build the first working version and Full Preview will open the project itself across the whole screen.'),
          chips([{ label: 'Build with Nex', run: () => ctx.go('chat') }]),
        ];
      }
      return [
        say(`This is where your site shows up as we build it. Change something and it updates here.`),
        chips([
          { label: 'Show me my site', run: () => ctx.ask('Show me my site as it looks right now.') },
          { label: 'Check it on a phone', run: () => ctx.ask('How does my site look on a phone? Anything that needs fixing?') },
          { label: 'Publish it', run: () => ctx.ask('I want to publish my site. Walk me through what happens.') },
        ]),
      ];
    },
  },

  stack: {
    label: 'Build Plan',
    icon: '⬡',
    say: ['stack', 'my stack', 'your stack', 'setup', 'services', 'build plan'],
    async render(ctx) {
      if (!ctx.hasCurrentBuild?.()) return [say('Build or open a project first. Its connections will appear here afterward.'), chips([{ label: 'Plan the project', run: () => ctx.go('brief') }])];
      const nodes = [];
      let manifest = null;
      try { manifest = await getJSON('/api/forge-stack?projectId=' + encodeURIComponent(ctx.projectId())); } catch {}

      if (!manifest?.slots) {
        nodes.push(say(`I couldn't load your stack checklist just now. Nothing was marked connected.`));
        nodes.push(chips([
          { label: 'Try again', run: () => ctx.go('stack') },
          { label: 'Ask Nex', run: () => ctx.ask('Help me check what my project needs to run.') },
        ]));
        return nodes;
      }

      const progress = manifest.progress || { ready: 0, required: 0, percent: 0 };
      nodes.push(say(
        progress.required
          ? `Your project stack is ${progress.percent}% ready — ${progress.ready} of ${progress.required} required pieces are tested and working. I'll walk you through the rest one piece at a time.`
          : `Tell me what you're building and I'll turn it into a stack checklist.`
      ));

      const statusLabel = {
        not_needed: 'optional',
        recommended: 'next',
        selected: 'selected',
        connecting: 'connecting',
        connected: 'test needed',
        testing: 'testing',
        ready: 'ready',
        error: 'needs attention',
        skipped: 'skipped',
      };
      const entries = Object.entries(manifest.slots);
      const required = entries.filter(([, slot]) => slot.required);
      const optional = entries.filter(([, slot]) => !slot.required);
      const makeRow = ([slotId, slot]) => {
        const definition = manifest.catalog?.[slotId] || {};
        const action = manifest.actions?.[slotId] || null;
        const provider = slot.provider
          ? (definition.providers || []).find((item) => item.id === slot.provider)?.label || slot.provider
          : 'Choose when needed';
        const label = statusLabel[slot.status] || slot.status;
        return row({
          title: definition.label || slotId,
          meta: `${provider} · ${action?.available === false && action?.blocker ? action.blocker : (definition.purpose || 'Project service')}`,
          tone: { label, kind: slot.status === 'ready' ? 'f' : 'g' },
          onClick: () => action
            ? ctx.runStackAction(slotId, action.operation)
            : ctx.ask(`Walk me through setting up ${definition.label || slotId} for my project. Check its real connection state first and do not call it ready until it passes a test.`),
        });
      };

      if (required.length) nodes.push(group('Needed for this project', required.map(makeRow)));
      if (optional.length) nodes.push(group('Add when you need them', optional.map(makeRow)));
      nodes.push(chips([
        { label: 'Set up this project', run: () => ctx.setupStack() },
        { label: 'Plan my stack', run: () => ctx.ask('Ask me what I am building, then recommend the full stack it needs and update my checklist.') },
        { label: 'Set up the next piece', run: () => {
          const next = progress.next;
          const action = next ? manifest.actions?.[next] : null;
          if (next && action) ctx.runStackAction(next, action.operation);
          else ctx.ask('Open my Build Plan and walk me through the next unfinished required piece.');
        } },
        { label: 'Add a database', run: () => ctx.ask('I need a database. Explain the recommended option and walk me through connecting it.') },
      ]));
      return nodes;
    },
  },

  brain: {
    label: 'Builder Brain',
    icon: '◉',
    say: ['brain', 'builder brain', 'my brain', 'connection'],
    async render(ctx) {
      const nodes = [];
      let status = null;
      let failed = false;
      let needsSignIn = false;
      try { status = await getJSON('/api/forge-brain'); }
      catch (error) {
        needsSignIn = /returned 401\b/.test(error.message || '');
        failed = !needsSignIn;
      }

      if (needsSignIn) {
        nodes.push(say('Sign in to your Forge account to connect your Builder Brain. Your connection stays with your account.'));
        nodes.push(chips([{ label: 'Sign in or create an account', run: () => ctx.signIn() }]));
        return nodes;
      }

      // Only reached when the endpoint itself is unreachable or misconfigured.
      // Say that plainly rather than implying the user simply hasn't connected:
      // "you haven't set this up" sends them looking for a button when the
      // actual problem is on our side.
      if (failed || !status) {
        nodes.push(say(`I can't reach the Builder Brain settings right now. Builds require your connected brain, so this is worth another try in a minute.`));
        nodes.push(chips([
          { label: 'Try again', run: () => ctx.go('brain') },
        ]));
        return nodes;
      }

      if (status.provider === 'nex-pod') {
        return [
          say('Nex powers your builds, Project Plan, and Connections. No separate Builder Brain or power upgrade is needed.'),
          chips([
            { label: 'Check Nex', run: () => ctx.testBrain() },
            { label: 'Project Plan', run: () => ctx.go('brief') },
            ...(ctx.hasCurrentBuild?.() ? [{ label: 'Connections', run: () => ctx.go('stack') }] : []),
          ]),
        ];
      }
      const connected = Boolean(field(status, 'connected'));
      const tiers = (status.providers?.[0]?.tiers) || [];
      const currentTier = String(field(status, 'tier') || 'free');

      if (!connected) {
        nodes.push(say(`Connect your Builder Brain before the first build. It takes one tap — nothing to copy, nothing to paste, and the free option needs no card. What you use stays on your account.`));

        if (tiers.length) {
          nodes.push(group('Pick how much power', tiers.map((tier) => row({
            title: tier.label,
            meta: tier.blurb,
            tone: tier.id === currentTier ? { label: 'picked', kind: 'f' } : null,
            onClick: () => ctx.connectBrain(tier.id),
          }))));
        }

        nodes.push(chips([
          { label: 'Connect', run: () => ctx.connectBrain(currentTier) },
          { label: 'What am I connecting', run: () => ctx.ask('Explain the Builder Brain in plain terms — what am I connecting and what does it cost me?') },
        ]));
        return nodes;
      }

      nodes.push(say(field(status, 'tested_at')
        ? `Your brain is connected and working.`
        : `Your brain is connected. Worth checking it before we build something big.`));

      const used = field(status, 'usage');
      const cap = field(status, 'limit');
      nodes.push(group(null, [
        row({ title: 'Connection', meta: String(field(status, 'provider') || 'Connected'), tone: { label: 'on', kind: 'f' } }),
        row({ title: 'Power', meta: (tiers.find((t) => t.id === currentTier) || {}).label || currentTier }),
        row({ title: 'Last checked', meta: relative(field(status, 'tested_at')) || 'Not yet' }),
        ...(used !== '' && used !== null
          ? [row({ title: 'Used so far', meta: cap ? `${used} of ${cap}` : String(used) })]
          : []),
      ]));

      if (tiers.length) {
        nodes.push(group('Change power', tiers.map((tier) => row({
          title: tier.label,
          meta: tier.blurb,
          tone: tier.id === currentTier ? { label: 'current', kind: 'f' } : null,
          onClick: () => ctx.setTier(tier.id),
        }))));
      }

      nodes.push(chips([
        { label: 'Check it', run: () => ctx.testBrain() },
        { label: 'Disconnect', run: () => ctx.disconnectBrain() },
      ]));
      return nodes;
    },
  },

  features: {
    label: 'Features',
    icon: '◇',
    say: ['features', 'what do i get', 'unlock', 'upgrade'],
    async render(ctx) {
      const nodes = [];
      const connection = await loadConnection();
      const connected = Boolean(connection?.connected);
      const tier = String(connection?.tier || '').toLowerCase();
      const pod = connection?.provider === 'nex-pod';

      nodes.push(say(pod
        ? 'Nex powers your builds, Project Plan, and Connections. These features are available without a separate Builder Brain upgrade.'
        : connected
        ? `You're on ${tier || 'free'}. Here's what that unlocks — and what the next step up adds.`
        : `Everything here runs on a Builder Brain you connect yourself. It's one tap, the free option needs no card, and what you pick decides which features are available.`));

      // Unlocked first: what they can actually do right now, before any upsell.
      const unlocked = FEATURES.filter((f) => featureUnlocked(connection, f.id));
      const locked = FEATURES.filter((f) => !featureUnlocked(connection, f.id));

      if (unlocked.length) {
        nodes.push(group('Available now', unlocked.map((feature) => row({
          title: feature.name,
          meta: feature.blurb,
          tone: { label: 'on', kind: 'f' },
        }))));
      }

      if (locked.length) {
        nodes.push(group(connected ? 'Unlocks with more power' : 'Unlocks once connected', locked.map((feature) => row({
          title: feature.name,
          meta: feature.blurb,
          tone: { label: feature.requires, kind: 'g' },
          onClick: () => (connected ? ctx.go('brain') : ctx.go('brain')),
        }))));
      }

      // Why, in the customer's terms. Stating the real constraint beats
      // "upgrade for more power", which tells them nothing.
      const gated = locked.filter((feature) => feature.reason && connected);
      if (gated.length) {
        nodes.push(group('Why these need more', gated.map((feature) => row({
          title: feature.name,
          meta: feature.reason,
        }))));
      }

      nodes.push(chips(connected
        ? [
            { label: pod ? 'Check Nex' : 'Change power', run: () => ctx.go('brain') },
            { label: 'What can you build', run: () => ctx.go('help') },
          ]
        : [
            { label: 'Connect a brain', run: () => ctx.go('brain') },
            { label: 'What can you build', run: () => ctx.go('help') },
          ]));
      return nodes;
    },
  },

  billing: {
    label: 'Plan',
    icon: '◈',
    say: ['plan', 'billing', 'account', 'subscription'],
    async render(ctx) {
      const nodes = [];

      // A guest has no account to describe. Say what an account is FOR rather
      // than showing an empty plan panel — this is the one view where a signed
      // out visitor most plausibly landed looking for exactly that answer.
      if (ctx.signedIn && !ctx.signedIn()) {
        nodes.push(say(`You're browsing as a guest — look around as much as you like.\n\nAn account saves your projects, connects the brain that does the building, and keeps your work here when you come back. Free to make.`));
        nodes.push(chips([
          { label: 'Create an account', run: () => ctx.signIn() },
          { label: 'What can you build', run: () => ctx.go('help') },
        ]));
        return nodes;
      }

      let me = null;
      try { me = await getJSON('/api/room-auth'); } catch {}

      nodes.push(say(me?.username
        ? `You're signed in as ${String(me.username)}.`
        : `Your account and plan live here.`));

      nodes.push(chips([
        { label: "What's my plan", run: () => ctx.ask("What plan am I on and what does it include?") },
        { label: 'Upgrade', run: () => ctx.ask('I want to upgrade my plan. What are the options?') },
        { label: 'Sign out', run: () => ctx.signOut() },
      ]));
      return nodes;
    },
  },

  help: {
    label: 'What I can do',
    icon: '?',
    say: ['help', 'what can you do', 'options'],
    async render(ctx) {
      if (ctx.surface?.() === 'workbench') {
        return [
          say(`One Workbench panel is one complete project: a website, app, business system, or intelligence. Talk to Nex normally, then use these controls only when you want to inspect or extend a specific part.`),
          group('Inside this project', [
            row({ title: 'Your Project', meta: 'The main experience you are building', onClick: () => ctx.go('project') }),
            row({ title: 'Project stacks', meta: 'Choose a project to preview or add supporting pages, tools, workflows, and intelligences', onClick: () => ctx.go('project') }),
            ...(ctx.hasCurrentBuild?.() ? [row({ title: 'Connections', meta: 'Services and infrastructure behind the project', onClick: () => ctx.go('stack') })] : []),
            row({ title: 'Project Plan', meta: 'Shape the idea before building', onClick: () => ctx.go('brief') }),
          ]),
          group('Try asking Nex', [
            row({ title: 'Build the first working version', onClick: () => ctx.ask('Build the first working version of this panel. Ask what you need before starting.') }),
            row({ title: 'Make this feel more professional', onClick: () => ctx.ask('Review this panel and make it feel more professional.') }),
            row({ title: 'Get this ready to go live', onClick: () => ctx.ask('Check this whole panel and tell me what is left before it can go live.') }),
          ]),
        ];
      }
      return [
        say(`Tell me what you want and I build it. You don't need to know how any of it works.`),
        group('Say any of these', [
          row({ title: 'Your Project', meta: '“project”', onClick: () => ctx.go('project') }),
          row({ title: 'Pages', meta: '“pages”', onClick: () => ctx.go('pages') }),
          row({ title: 'Preview', meta: '“preview”', onClick: () => ctx.go('preview') }),
          row({ title: 'Your Stack', meta: '“stack”', onClick: () => ctx.go('stack') }),
          row({ title: 'Builder Brain', meta: '“brain”', onClick: () => ctx.go('brain') }),
          row({ title: 'Plan', meta: '“plan”', onClick: () => ctx.go('billing') }),
        ]),
        group('Things people ask me', [
          row({ title: 'Build me a site for my business', onClick: () => ctx.ask('Build me a site for my business. Ask me what you need.') }),
          row({ title: 'Add a way for customers to contact me', onClick: () => ctx.ask('Add a way for customers to contact me.') }),
          row({ title: 'Make it look more professional', onClick: () => ctx.ask('Make my site look more professional.') }),
        ]),
      ];
    },
  },
};

export function matchForgeView(raw) {
  const text = String(raw).toLowerCase().trim()
    .replace(/^(open|go to|show|take me to|switch to)\s+/, '')
    .replace(/[.?!]$/, '');
  for (const [id, view] of Object.entries(FORGE_VIEWS)) {
    if (view.say.includes(text)) return id;
  }
  return null;
}
