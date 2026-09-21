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
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
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

export function row({ title, meta, tone, onClick }) {
  const node = document.createElement(onClick ? 'button' : 'div');
  node.className = 'lrow';
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
  node.appendChild(left);
  if (tone) node.appendChild(pill(tone.label, tone.kind || ''));
  if (onClick) node.onclick = onClick;
  return node;
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

// --- the rooms -------------------------------------------------------------
// Each returns nodes. `ctx` gives a view access to the shell: ctx.ask(text)
// sends Nex a message in the thread, ctx.go(id) switches view.

export const VIEWS = {
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
        nodes.push(group('Open', open.slice(0, 12).map((task) => row({
          title: String(field(task, 'title', 'name', 'id')),
          meta: [field(task, 'owner'), relative(field(task, 'updated_at', 'created_at'))].filter(Boolean).join(' · '),
          tone: (() => {
            const state = String(field(task, 'status')).toLowerCase();
            if (state === 'blocked') return { label: 'blocked', kind: 'g' };
            if (state === 'in_progress' || state === 'working') return { label: 'working', kind: 'f' };
            return null;
          })(),
          onClick: () => ctx.openTask(field(task, 'id')),
        }))));
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
