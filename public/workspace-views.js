// /public/workspace-views.js
//
// Every room, rebuilt as a view inside the chat shell.
//
// The rule these all follow: a room is not a dashboard here. It reads the way
// Nex would tell you about it if you asked — a sentence in his voice, then only
// the rows that matter, then the things you can do about it. No panels, no
// widget chrome, no nested tabs. One tap from the hamburger gets you the whole
// room; there is no second level of navigation anywhere in this file, and that
// is deliberate rather than unfinished.
//
// Data is read from endpoints that already exist. Response shapes are NOT
// assumed: every view pulls through `pick()` below, which tolerates an array, a
// wrapped array, or something unexpected, and renders an honest empty state
// instead of throwing. A room that quietly shows nothing is bad; a room that
// blanks the whole shell because a field moved is worse.

import { NEXUS_PRODUCTS, NEX_CHAT_PLANS } from './nexus-product-catalog.js';
import { renderLife } from './life.js';
import { renderReminders } from './reminders.js';
import { renderScheduleCalendar } from './schedule-calendar.js';
import { friendlyError } from './ux.js';

export function primaryAction(label,run){const button=document.createElement('button');button.type='button';button.className='uxprimary';button.textContent=label;button.onclick=run;return button;}
export function secondaryActions(label,nodes){const details=document.createElement('details');details.className='uxsecondary';const summary=document.createElement('summary');summary.textContent=label;details.append(summary,...nodes);return details;}
export function renderWelcome(ctx){
  const welcome=document.createElement('section');welcome.className='welcome';
  for(const [tag,text,cls] of [['div','N','welcome-mark'],['h1','What would you like to do?',''],['p','Nex can help you build something, plan your time, or think it through.','']]){const node=document.createElement(tag);node.className=cls;node.textContent=text;welcome.append(node);}
  welcome.append(primaryAction('Start with Nex',()=>ctx.ask('Help me get started. Offer relevant clickable choices to build something, plan my time, or make room for life. Ask one short question and explain the next step. Do not build or change anything until I choose a goal.')));
  const goals=document.createElement('div');goals.className='startergrid';
  for(const [label,description,view] of [['Build something','A website, app, or tool','workbench'],['Plan my time','Activities and reminders','planner'],['Make room for life','Balance, energy, and what matters','life']]){const button=document.createElement('button');button.type='button';button.className='starter';button.textContent=label;const meta=document.createElement('span');meta.textContent=description;button.append(meta);button.onclick=()=>ctx.go(view);goals.append(button);}
  welcome.append(secondaryActions('Choose a goal yourself',[goals]));return welcome;
}

export const pill = (text, tone = '') => {
  const span = document.createElement('span');
  span.className = `tag ${tone}`;
  span.textContent = text;
  return span;
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Tolerant extraction: array, {items}, {tasks}, {data}, or nothing. */
export function pick(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  for (const value of Object.values(payload || {})) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

export async function getJSON(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw Object.assign(new Error('Could not load this view'),{status:response.status});
  return response.json();
}

export async function postJSON(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Could not save this change'),{status:response.status});
  return payload;
}

/** First present field from a list of candidate names. */
export function field(object, ...names) {
  for (const name of names) {
    const value = object?.[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

export function relative(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// --- building blocks -------------------------------------------------------
// These are the only shapes a view may use. Keeping the vocabulary this small
// is what stops each room from drifting back into its own bespoke dashboard.

export function say(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg a';
  const body = document.createElement('div');
  body.className = 'body';
  body.innerHTML = String(text).split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('');
  wrap.appendChild(body);
  return wrap;
}

export function row({ title, meta, tone, onClick, action }) {
  // The row is always a plain div: an action (the deck ✕) is a real <button>,
  // and nesting a button inside a button is invalid HTML that browsers hoist
  // unpredictably. When the row is clickable, the inner .lmain element is the
  // button that carries the row click, leaving the ✕ a valid sibling.
  const node = document.createElement('div');
  node.className = 'lrow';
  const interactive = document.createElement(onClick ? 'button' : 'div');
  interactive.className = 'lmain';
  const left = document.createElement('div');
  left.style.minWidth = '0';
  const t = document.createElement('div');
  t.className = 'lt';
  t.textContent = title;
  left.appendChild(t);
  if (meta) {
    const m = document.createElement('div');
    m.className = 'lm';
    m.textContent = meta;
    left.appendChild(m);
  }
  interactive.appendChild(left);
  if (tone) interactive.appendChild(pill(tone.label, tone.kind || ''));
  if (onClick) interactive.onclick = onClick;
  node.appendChild(interactive);
  if (action) node.appendChild(action);
  return node;
}

/**
 * Pure delete flow behind the ✕ on a Command Deck task row: confirm, post
 * the existing /api/board delete_task route, then re-render. Returns false
 * when the user cancels, throws when the delete fails. Every dependency is
 * injected so the flow is testable without a DOM or network.
 */
export async function requestDelete({ title, id, post, confirm, onDeleted }) {
  if (!confirm(`Delete “${title}”? This can't be undone.`)) return false;
  await post('/api/board', { action: 'delete_task', id });
  if (onDeleted) await onDeleted();
  return true;
}

/**
 * ✕ for a Command Deck task row. The click handler stops propagation so
 * tapping it never also fires the row's own onClick.
 */
export function deleteTaskButton({ id, title, post, onDeleted }) {
  const button = document.createElement('button');
  button.className = 'rowdel';
  button.type = 'button';
  button.title = 'Delete this task';
  button.setAttribute('aria-label', `Delete task: ${title}`);
  button.textContent = '✕';
  button.onclick = async (event) => {
    event.stopPropagation();
    button.disabled = true;
    try {
      const ok = await requestDelete({ title, id, post, confirm: window.confirm, onDeleted });
      if (ok === false) button.disabled = false;
    } catch (err) {
      button.disabled = false;
      window.alert(friendlyError(err,{action:'delete'}));
    }
  };
  return button;
}

export function group(label, children) {
  const wrap = document.createElement('div');
  wrap.className = 'lgroup';
  if (label) {
    const head = document.createElement('div');
    head.className = 'lhead';
    head.textContent = label;
    wrap.appendChild(head);
  }
  for (const child of children) wrap.appendChild(child);
  return wrap;
}

async function projectPreviewHtml(buildId) {
  if (!buildId) return '';
  try {
    const payload = await getJSON('/api/room-history?id=' + encodeURIComponent(buildId));
    return typeof payload?.build?.html === 'string' ? payload.build.html : '';
  } catch {
    return '';
  }
}

async function copyProjectLink(url, button) {
  try {
    await navigator.clipboard.writeText(url);
    const previous = button.textContent;
    button.textContent = 'Copied ✓';
    setTimeout(() => { if (button.isConnected) button.textContent = previous; }, 1600);
  } catch {
    window.prompt('Copy this clean live-site link:', url);
  }
}

function projectUsage(count, limit, planName) {
  const wrap = document.createElement('div');
  wrap.className = 'projectusage';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = Number.isFinite(limit) ? `${count} of ${limit} projects used` : `${count} projects`;
  const detail = document.createElement('span');
  detail.textContent = Number.isFinite(limit)
    ? `${planName || 'Current'} plan · ${Math.max(0, limit - count)} project slot${Math.max(0, limit - count) === 1 ? '' : 's'} left`
    : `${planName || 'Current'} plan`;
  copy.append(title, detail);
  wrap.appendChild(copy);
  if (Number.isFinite(limit) && limit > 0) {
    const meter = document.createElement('div');
    meter.className = 'projectmeter';
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, Math.round((count / limit) * 100))}%`;
    meter.appendChild(fill);
    wrap.appendChild(meter);
  }
  return wrap;
}

async function projectGallery(projects, ctx) {
  const gallery = document.createElement('div');
  gallery.className = 'projectgrid';
  const previews = await Promise.all(projects.map((project) => projectPreviewHtml(field(project, 'latestBuildId', 'id'))));
  projects.forEach((project, index) => {
    const buildId = field(project, 'latestBuildId', 'id');
    const title = String(field(project, 'label', 'title', 'name', 'requestMessage', 'id') || 'Untitled project').slice(0, 90);
    const versions = Number(field(project, 'versionCount')) || 0;
    const liveUrl = field(project, 'liveUrl');
    const card = document.createElement('article');
    card.className = 'projectcard';

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'projectthumb';
    thumb.setAttribute('aria-label', `Preview ${title}`);
    thumb.onclick = buildId ? () => ctx.openWorkbenchPanel(buildId, 'preview') : null;
    if (previews[index]) {
      const frame = document.createElement('iframe');
      frame.title = '';
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.srcdoc = previews[index];
      thumb.appendChild(frame);
    } else {
      const blank = document.createElement('span');
      blank.className = 'projectthumbempty';
      blank.textContent = 'Project preview';
      thumb.appendChild(blank);
    }

    const body = document.createElement('div');
    body.className = 'projectcardbody';
    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'projectcardtitle';
    titleButton.textContent = title;
    titleButton.onclick = buildId ? () => ctx.openWorkbenchPanel(buildId, 'preview') : null;
    const meta = document.createElement('div');
    meta.className = 'projectcardmeta';
    meta.textContent = [liveUrl ? 'Live' : 'Saved', versions ? `${versions} version${versions === 1 ? '' : 's'}` : '', relative(field(project, 'updatedAt', 'createdAt', 'ts'))].filter(Boolean).join(' · ');
    const actions = document.createElement('div');
    actions.className = 'projectcardactions';
    const preview = document.createElement('button');
    preview.type = 'button'; preview.textContent = 'Preview';
    preview.onclick = buildId ? () => ctx.openWorkbenchPanel(buildId, 'preview') : null;
    const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = 'Edit';
    edit.onclick = buildId ? () => ctx.openWorkbenchPanel(buildId, 'edit') : null;
    actions.append(preview, edit);
    if (liveUrl) {
      const copy = document.createElement('button');
      copy.type = 'button'; copy.textContent = 'Copy link';
      copy.onclick = () => copyProjectLink(liveUrl, copy);
      actions.appendChild(copy);
    }
    body.append(titleButton, meta, actions);
    card.append(thumb, body);
    gallery.appendChild(card);
  });
  return gallery;
}

export function chips(items) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  for (const { label, run } of items) {
    const button = document.createElement('button');
    button.className = 'chip';
    button.textContent = label;
    button.onclick = run;
    wrap.appendChild(button);
  }
  return wrap;
}

export function empty(text) {
  const node = document.createElement('div');
  node.className = 'lempty';
  node.textContent = text;
  return node;
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const SCHEDULE_COLORS = {
  work:'#6f9ce8', project:'#9a7bea', gym:'#56c596', health:'#65b8b2', family:'#e9a66f',
  social:'#df7fa4', appointment:'#e0c35c', errands:'#a5a19a', learning:'#74b7e8',
  creative:'#c883d8', rest:'#7b87a7', travel:'#d78b68', other:'#8e8a84',
};

export function scheduleBalance(summary = {}, items = [], ctx) {
  const card = document.createElement('section');
  card.className = 'schedulebalance';
  const minutes = summary.category_minutes || {};
  const entries = Object.entries(minutes).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, entries.reduce((sum, [, value]) => sum + value, 0));
  const hours = Math.round((total / 60) * 10) / 10;
  const conflictCount = Array.isArray(summary.conflicts) ? summary.conflicts.length : 0;
  const header = document.createElement('div'); header.className = 'schedulebalancehead';
  header.innerHTML = `<span><small>TIME SPLIT</small><strong>${hours} scheduled hour${hours === 1 ? '' : 's'}</strong></span><em>${conflictCount ? `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` : 'No conflicts'}</em>`;
  const bar = document.createElement('div'); bar.className = 'schedulebar';
  const legend = document.createElement('div'); legend.className = 'schedulelegend';
  if (!entries.length) {
    bar.innerHTML = '<i style="width:100%;background:#292929"></i>';
    legend.textContent = 'Add a block to see how your time is divided.';
  } else {
    for (const [category, value] of entries) {
      const segment = document.createElement('button');
      segment.style.width = `${Math.max(2, value / total * 100)}%`;
      segment.style.background = SCHEDULE_COLORS[category] || SCHEDULE_COLORS.other;
      segment.title = `${category}: ${Math.round(value / 6) / 10} hours`;
      segment.setAttribute('aria-label', `Open ${category} schedule blocks`);
      segment.onclick = () => ctx.openScheduleCategory(category, items.filter((item) => item.category === category));
      bar.appendChild(segment);
      const label = document.createElement('button');
      label.innerHTML = `<i style="background:${SCHEDULE_COLORS[category] || SCHEDULE_COLORS.other}"></i>${category} · ${Math.round(value / 6) / 10}h`;
      label.onclick = segment.onclick;
      legend.appendChild(label);
    }
  }
  card.append(header, bar, legend);
  return card;
}

// --- the rooms -------------------------------------------------------------
// Each returns nodes. `ctx` gives a view access to the shell: ctx.ask(text)
// sends Nex a message in the thread, ctx.go(id) switches view.

export const VIEWS = {
  workbench: {
    label: 'Projects',
    icon: '▦',
    say: ['workbench', 'nex workbench', 'panels', 'build mode'],
    async render(ctx) {
      const payload = await getJSON('/api/room-history');
      const projects = pick(payload, 'projects', 'builds');
      const workbench = payload?.workbench || {};
      const limit = Number.isFinite(Number(workbench.limit)) ? Number(workbench.limit) : NEX_CHAT_PLANS.plus.panels;
      const canCreate = workbench.canCreate !== false && projects.length < limit;
      ctx.setProjectUsage?.(projects.length, limit);
      return [
        say(projects.length ? 'Open a project to see it, or edit it with Nex.' : 'Build a website, app, or tool. Nex will guide you one step at a time.'),
        projectUsage(projects.length, limit, workbench.planName),
        primaryAction(canCreate ? 'Build something' : 'See plan options',canCreate ? () => ctx.newWorkbenchPanel() : () => ctx.ask(`I have used all ${limit} Workbench project slots. Show me which Nex Chat plan gives me more projects.`)),
        secondaryActions('More project options',[chips([
          { label: 'Map a project', run: () => ctx.ask('Help me map a new website, app, business system, or intelligence before we open its Workbench project.') },
          { label: 'Refresh', run: () => ctx.go('workbench') },
        ])]),
        projects.length ? await projectGallery(projects.slice(0, 10), ctx) : empty('Your projects will appear here after you build the first one.'),
        secondaryActions('Compare plans',[group('Plans', Object.values(NEX_CHAT_PLANS).map((plan) => row({
          title: `${plan.name}${plan.price ? ` · $${plan.price}/month` : ''}`,
          meta: plan.description,
          tone: plan.name === 'Plus' ? { label: '10 projects', kind: 'f' }
            : plan.name === 'Pro' ? { label: '3 projects' } : { label: 'chat' },
        })))]),
      ];
    },
  },

  reminders: {
    label:'Reminders', icon:'◉', say:['reminders','my reminders','to-do list'],
    async render(ctx){return [await renderReminders(ctx)];},
  },

  planner: {
    label: 'Schedule',
    icon: '▤',
    say: ['planner', 'calendar', 'schedule', 'my day', 'my week'],
    async render(ctx) {
      return [await renderScheduleCalendar(ctx, {balance:scheduleBalance})];
    },
  },

  life: {
    label:'Nexus Life', icon:NEXUS_PRODUCTS.life.icon, say:['nexus life','life'],
    async render(ctx){return [await renderLife(ctx)];},
  },

  legacy: {
    label: 'Nexus Legacy',
    icon: NEXUS_PRODUCTS.legacy.icon,
    say: ['nexus legacy', 'legacy'],
    async render(ctx) {
      return [
        say(`${NEXUS_PRODUCTS.legacy.promise} This is the bridge from everyday conversation into the people, memories, lessons, and moments you never want to lose.`),
        chips([
          { label: 'Save a memory', run: () => ctx.ask('I want to preserve a memory in Nexus Legacy. Walk me through it.') },
          { label: 'Who should I reach out to', run: () => ctx.ask('Who in my life might appreciate hearing from me right now?') },
        ]),
      ];
    },
  },

  teams: {
    label: 'Nexus Teams',
    icon: NEXUS_PRODUCTS.teams.icon,
    say: ['nexus teams', 'teams'],
    async render(ctx) {
      return [
        say(`${NEXUS_PRODUCTS.teams.promise} Bring people and agents into one shared canvas, hand off work clearly, and keep a human in control of the decisions that matter.`),
        chips([
          { label: 'Plan a team workspace', run: () => ctx.ask('Help me design a Nexus Teams workspace for a new project.') },
          { label: 'See my AI team', run: () => ctx.go('agents') },
        ]),
      ];
    },
  },

  deck: {
    label: 'Command Deck',
    icon: '◈',
    say: ['command deck', 'deck', 'mission control', 'command center', 'board'],
    async render(ctx) {
      const nodes = [];
      let board = null;
      let status = null;
      try { board = await getJSON('/api/board'); } catch {}
      try { status = await getJSON('/api/status'); } catch {}

      const tasks = pick(board, 'tasks', 'items');
      const open = tasks.filter((t) => !['complete', 'completed', 'done'].includes(String(field(t, 'status')).toLowerCase()));
      const blocked = open.filter((t) => String(field(t, 'status')).toLowerCase() === 'blocked');

      nodes.push(say(
        tasks.length
          ? `${open.length} open on the board${blocked.length ? `, ${blocked.length} blocked` : ''}. Here's what's actually moving.`
          : `The board is clear.`
      ));

      if (open.length) {
        nodes.push(group('Open', open.slice(0, 12).map((task) => {
          const title = String(field(task, 'title', 'name', 'id'));
          return row({
            title,
            meta: [field(task, 'owner'), relative(field(task, 'updated_at', 'created_at'))].filter(Boolean).join(' · '),
            tone: (() => {
              const state = String(field(task, 'status')).toLowerCase();
              if (state === 'blocked') return { label: 'blocked', kind: 'g' };
              if (state === 'in_progress' || state === 'working') return { label: 'working', kind: 'f' };
              return null;
            })(),
            onClick: () => ctx.openTask(field(task, 'id')),
            action: deleteTaskButton({
              id: field(task, 'id'),
              title,
              post: postJSON,
              onDeleted: () => ctx.go('deck'),
            }),
          });
        })));
      } else if (tasks.length === 0) {
        nodes.push(empty('Nothing on the board.'));
      }

      if (status) {
        const lines = Object.entries(status).filter(([, v]) => typeof v === 'string' || typeof v === 'number').slice(0, 6);
        if (lines.length) {
          nodes.push(group('System', lines.map(([key, value]) => row({
            title: key.replace(/_/g, ' '),
            meta: String(value),
          }))));
        }
      }

      nodes.push(chips([
        { label: 'New task', run: () => ctx.newTask() },
        { label: 'Refresh', run: () => ctx.go('deck') },
        { label: 'Approvals', run: () => ctx.go('approvals') },
        { label: 'What needs me', run: () => ctx.ask('What on the board actually needs me right now, and what can wait?') },
        { label: 'Deployments', run: () => ctx.ask('Show the latest production deployment state and anything failing.') },
        { label: 'What broke today', run: () => ctx.ask('Any crashes, failing checks, or collisions today?') },
      ]));
      return nodes;
    },
  },

  approvals: {
    label: 'Approvals',
    icon: '⚑',
    say: ['approvals', 'approval queue', 'queue'],
    async render(ctx) {
      const nodes = [];
      let queue = null;
      try { queue = await getJSON('/api/queue'); } catch {}
      const items = pick(queue, 'items', 'queue', 'pending');

      nodes.push(say(items.length
        ? `${items.length} waiting on you. Nothing here runs until you say so.`
        : `Nothing waiting. Anything that needs your yes will show up here.`));

      if (items.length) {
        nodes.push(group(null, items.slice(0, 15).map((item) => row({
          title: String(field(item, 'title', 'summary', 'action', 'id')),
          meta: [field(item, 'agent', 'requested_by'), relative(field(item, 'created_at', 'ts'))].filter(Boolean).join(' · '),
          tone: { label: 'waiting', kind: 'g' },
          onClick: () => ctx.openApproval(item),
        }))));
      } else {
        nodes.push(empty('Queue is empty.'));
      }

      nodes.push(chips([
        { label: 'Refresh', run: () => ctx.go('approvals') },
        { label: 'Explain the risky one', run: () => ctx.ask('Which pending approval carries the most risk, and why?') },
        { label: 'Anything stale', run: () => ctx.ask('Is anything sitting in the approval queue that should have been handled already?') },
      ]));
      return nodes;
    },
  },

  forge: {
    label: 'Forge',
    icon: '⚒',
    say: ['forge', 'builder', 'room builder', 'forge builder'],
    async render(ctx) {
      const nodes = [];
      let metrics = null;
      let customers = null;
      let developers = null;
      try { metrics = await getJSON('/api/forge-metrics'); } catch {}
      try { customers = await getJSON('/api/forge-customers'); } catch {}
      try { developers = await getJSON('/api/forge-admin'); } catch {}
      const accounts = pick(customers, 'customers', 'accounts', 'items');
      const developerAccounts = pick(developers, 'accounts');

      nodes.push(say(accounts.length
        ? `${accounts.length} on Forge. Build, leads, and billing all sit behind this.`
        : `Forge is the product side — builds, leads, and customer accounts.`));

      if (metrics && typeof metrics === 'object') {
        const stats = Object.entries(metrics).filter(([, v]) => typeof v === 'number').slice(0, 6);
        if (stats.length) {
          nodes.push(group('Numbers', stats.map(([key, value]) => row({
            title: key.replace(/_/g, ' '),
            meta: String(value),
          }))));
        }
      }

      if (accounts.length) {
        nodes.push(group('Accounts', accounts.slice(0, 10).map((account) => row({
          title: String(field(account, 'name', 'business', 'email', 'id')),
          meta: [field(account, 'plan'), field(account, 'status')].filter(Boolean).join(' · '),
          onClick: () => ctx.ask(`Give me the full picture on Forge customer "${field(account, 'name', 'business', 'email', 'id')}".`),
        }))));
      }

      if (developerAccounts.length) {
        nodes.push(group('Developer accounts · track your testers', developerAccounts.map((account) => row({
          title: account.username,
          meta: `${account.plan || 'free'} · ${account.brainConnected ? 'Brain connected' : 'Brain not connected'}${account.tracked ? ' · tracked' : ''}`,
          tone: account.brainConnected ? { label:'ready', kind:'f' } : null,
          onClick: () => ctx.openDeveloper(account),
        }))));
      }

      nodes.push(chips([
        { label: 'Refresh', run: () => ctx.go('forge') },
        { label: 'Create test account', run: () => ctx.createDeveloper() },
        { label: 'Open Forge', run: () => location.assign('/forge.html') },
        { label: 'Return to owner', run: () => ctx.returnToOwner() },
        { label: 'Build something', run: () => ctx.ask('I want to build a new site. Ask me what you need to start.') },
        { label: 'Lead queue', run: () => ctx.ask('What leads are queued in Forge Field right now?') },
        { label: 'Billing health', run: () => ctx.ask('Any Forge accounts with billing problems or near their limit?') },
      ]));
      return nodes;
    },
  },

  story: {
    label: 'Story Studio',
    icon: '✦',
    say: ['story studio', 'story', 'comic', 'studio'],
    async render(ctx) {
      const nodes = [];
      let studio = null;
      try { studio = await getJSON('/api/story-studio'); } catch {}
      const projects = pick(studio, 'projects', 'items', 'stories');

      nodes.push(say(projects.length
        ? `${projects.length} story project${projects.length === 1 ? '' : 's'} in flight.`
        : `Nothing started yet. Give me a chapter or an idea and I'll break it into scenes.`));

      if (projects.length) {
        nodes.push(group(null, projects.slice(0, 10).map((project) => row({
          title: String(field(project, 'title', 'name', 'id')),
          meta: [field(project, 'status'), relative(field(project, 'updated_at', 'created_at'))].filter(Boolean).join(' · '),
          onClick: () => ctx.ask(`Open story project "${field(project, 'title', 'name', 'id')}" — where is it and what's next?`),
        }))));
      }

      nodes.push(chips([
        { label: 'Start from a chapter', run: () => ctx.ask('I want to turn a chapter into a comic sequence. Ask me for what you need.') },
        { label: 'Character continuity', run: () => ctx.ask('How are the characters holding continuity across the current scenes?') },
      ]));
      return nodes;
    },
  },

  agents: {
    label: 'AI Team',
    icon: '⬡',
    say: ['ai team', 'agents', 'team', 'conference room'],
    async render(ctx) {
      const nodes = [];
      let agents = null;
      try { agents = await getJSON('/api/agents'); } catch {}
      const list = pick(agents, 'agents', 'items');

      nodes.push(say(list.length
        ? `${list.length} in the crew. This is who's available and what they're on.`
        : `Crew status isn't reporting right now.`));

      if (list.length) {
        nodes.push(group(null, list.map((agent) => {
          const state = String(field(agent, 'status', 'state')).toLowerCase();
          return row({
            title: String(field(agent, 'name', 'id')),
            meta: field(agent, 'role', 'description') || state,
            tone: state
              ? { label: state.replace(/_/g, ' '), kind: ['online', 'available', 'available_on_demand'].includes(state) ? 'f' : 'g' }
              : null,
            onClick: () => ctx.ask(`What is ${field(agent, 'name', 'id')} working on, and what should they pick up next?`),
          });
        })));
      }

      nodes.push(chips([
        { label: 'Hand something off', run: () => ctx.ask('I want to hand work to another agent. Ask me what and to whom.') },
        { label: 'Who is stuck', run: () => ctx.ask('Is any agent blocked or waiting on me?') },
      ]));
      return nodes;
    },
  },

  memory: {
    label: 'Memory',
    icon: '◍',
    say: ['memory', 'memories', 'archive'],
    async render(ctx) {
      const nodes = [];
      let memory = null;
      try { memory = await getJSON('/api/memory'); } catch {}
      const items = pick(memory, 'memories', 'items', 'results');

      nodes.push(say(items.length
        ? `${items.length} things I'm holding onto. Ask me to forget anything that's gone stale.`
        : `Nothing durable stored yet.`));

      if (items.length) {
        nodes.push(group(null, items.slice(0, 15).map((item) => row({
          title: String(field(item, 'text', 'content', 'summary', 'title', 'id')).slice(0, 120),
          meta: [field(item, 'category', 'kind'), relative(field(item, 'updated_at', 'created_at'))].filter(Boolean).join(' · '),
          onClick: () => ctx.ask(`Tell me more about this memory: "${String(field(item, 'text', 'content', 'summary', 'id')).slice(0, 80)}"`),
        }))));
      }

      nodes.push(chips([
        { label: 'What do you know about me', run: () => ctx.ask('Summarise what you actually remember about me and how I work.') },
        { label: 'Anything stale', run: () => ctx.ask('Which stored memories look out of date or contradict each other?') },
      ]));
      return nodes;
    },
  },

  ventures: {
    label: 'Ventures',
    icon: '⬢',
    say: ['ventures', 'venture', 'businesses'],
    async render(ctx) {
      const nodes = [];
      let ventures = null;
      try { ventures = await getJSON('/api/ventures'); } catch {}
      const list = pick(ventures, 'ventures', 'items');

      nodes.push(say(list.length
        ? `${list.length} venture${list.length === 1 ? '' : 's'} tracked.`
        : `No ventures tracked yet.`));

      if (list.length) {
        nodes.push(group(null, list.map((venture) => row({
          title: String(field(venture, 'name', 'title', 'id')),
          meta: [field(venture, 'stage', 'status'), field(venture, 'summary')].filter(Boolean).join(' · ').slice(0, 90),
          onClick: () => ctx.ask(`Where does venture "${field(venture, 'name', 'title', 'id')}" actually stand?`),
        }))));
      }

      nodes.push(chips([
        { label: 'Scope a new one', run: () => ctx.ask('I want to scope a new venture. Break it into sections and ask me what you need for each.') },
      ]));
      return nodes;
    },
  },

  pod: {
    label: 'Pod Room',
    icon: '◉',
    say: ['pod room', 'pod', 'gpu', 'nex pod'],
    async render(ctx) {
      const status = await getJSON('/api/pod-controller');
      const pod = status.pod;
      const ready = Boolean(status.health?.ready);
      const nodes = [];

      if (!status.configured) {
        nodes.push(say('The Pod Room is connected to Nexus, but its RunPod credentials are not configured in Vercel yet.'));
        return nodes;
      }

      if (!pod) {
        nodes.push(say('No existing nex-pod is attached right now. The model volume is safe, but a fresh pod must be deployed in RunPod and named “nex-pod” before Nexus can control it. Pod creation and GPU changes stay behind your approval.'));
        nodes.push(chips([
          { label: 'Refresh', run: () => ctx.go('pod') },
          { label: 'Ask Nex for the runbook', run: () => ctx.ask('Walk me through deploying a fresh nex-pod with the existing persistent volume.') },
        ]));
        return nodes;
      }

      const state = ready ? 'ready' : String(pod.state || 'unknown').toLowerCase();
      nodes.push(say(ready
        ? `Nex is live on your GPU. The model answered its health check${status.health.latencyMs ? ` in ${status.health.latencyMs}ms` : ''}.`
        : `The pod is ${state}. Forge and the private Nex chat will use their hosted fallback until the model is ready.`));

      nodes.push(group('Live status', [
        row({ title: 'State', meta: state, tone: { label: ready ? 'ready' : state, kind: ready ? 'f' : 'g' } }),
        row({ title: 'Model', meta: status.health?.model || 'nex-base' }),
        row({ title: 'GPU type', meta: pod.gpu || 'RunPod did not report the GPU name while exited' }),
        row({ title: 'Last started', meta: relative(pod.lastStartedAt) || 'not reported' }),
        ...(pod.costPerHr != null ? [row({ title: 'RunPod rate when running', meta: `$${pod.costPerHr.toFixed(2)}/hr` })] : []),
      ]));

      const act = async (action) => {
        if (['stop', 'restart'].includes(action) && !window.confirm(`${action === 'stop' ? 'Turn off' : 'Restart'} the Nex pod now?`)) return;
        try {
          await postJSON('/api/pod-controller', { action });
          window.setTimeout(() => ctx.go('pod'), action === 'start' ? 1200 : 500);
        } catch (error) { window.alert(error.message); }
      };
      const test = async () => {
        const message = window.prompt('Talk directly to the pod model:', 'Say hello as Nex in one sentence.');
        if (!message) return;
        try {
          const result = await postJSON('/api/pod-controller', { action: 'test', message });
          window.alert(result.reply || 'The pod returned no visible text.');
        } catch (error) { window.alert(error.message); }
      };

      nodes.push(chips([
        ...(pod.state === 'RUNNING' ? [] : [{ label: 'Turn on', run: () => act('start') }]),
        ...(pod.state === 'RUNNING' ? [{ label: 'Turn off', run: () => act('stop') }] : []),
        ...(pod.state === 'RUNNING' ? [{ label: 'Restart', run: () => act('restart') }] : []),
        ...(ready ? [{ label: 'Test Nex', run: test }] : []),
        { label: 'Refresh', run: () => ctx.go('pod') },
      ]));
      return nodes;
    },
  },

  skills: {
    label: 'Capabilities',
    icon: '◫',
    say: ['capabilities', 'skills', 'connectors', 'tools', 'what can you do'],
    async render(ctx) {
      const nodes = [];
      let skills = null;
      try { skills = await getJSON('/api/skills'); } catch {}
      const list = pick(skills, 'skills', 'items');

      nodes.push(say(`Everything I can do, and everywhere I can take you. Anything on a button I draw comes from this list — nothing outside it can be clicked into existence.`));

      nodes.push(group('Go anywhere', Object.entries(VIEWS)
        .filter(([id]) => id !== 'skills')
        .map(([id, view]) => row({
          title: view.label,
          meta: `“${view.say[0]}”`,
          onClick: () => ctx.go(id),
        }))));

      if (list.length) {
        nodes.push(group('Skills', list.slice(0, 20).map((skill) => row({
          title: String(field(skill, 'name', 'title', 'id')),
          meta: String(field(skill, 'description', 'summary')).slice(0, 90),
        }))));
      }

      nodes.push(group('Actions', [
        row({ title: 'prompt', meta: 'Send me a message', tone: { label: 'free', kind: 'f' } }),
        row({ title: 'open-system', meta: 'Move the workspace', tone: { label: 'free', kind: 'f' } }),
        row({ title: 'snapshot', meta: 'Read what is on screen', tone: { label: 'free', kind: 'f' } }),
        row({ title: 'create-task · update-task', meta: 'Writes to the board', tone: { label: 'gated', kind: 'g' } }),
        row({ title: 'approve · reject', meta: 'Acts on the queue', tone: { label: 'gated', kind: 'g' } }),
      ]));
      return nodes;
    },
  },
};

/** Match typed text to a view id, exact phrases only. */
export function matchView(raw) {
  const text = String(raw).toLowerCase().trim()
    .replace(/^(open|go to|show|take me to|switch to)\s+/, '')
    .replace(/[.?!]$/, '');
  for (const [id, view] of Object.entries(VIEWS)) {
    if (view.say.includes(text)) return id;
  }
  return null;
}
