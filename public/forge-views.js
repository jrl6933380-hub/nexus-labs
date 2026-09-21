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

export const FORGE_VIEWS = {
  project: {
    label: 'Your Project',
    icon: '◇',
    say: ['project', 'my project', 'home'],
    async render(ctx) {
      const nodes = [];
      let history = null;
      try { history = await getJSON('/api/room-history'); } catch {}
      const builds = pick(history, 'builds', 'history', 'items');
      const projects = pick(history, 'projects');

      nodes.push(say(builds.length
        ? `Here's what you've built so far. Pick one up, or tell me something new and I'll start it.`
        : `Nothing built yet. I'll ask a few focused questions first, then build the first version from your real answers instead of guessing.`));

      if (projects.length || builds.length) {
        nodes.push(group(null, (projects.length ? projects : builds).slice(0, 12).map((build) => row({
          title: String(field(build, 'label', 'title', 'name', 'prompt', 'id')).slice(0, 90),
          meta: relative(field(build, 'updatedAt', 'updated_at', 'created_at', 'ts')),
          onClick: () => ctx.openBuild(field(build, 'latestBuildId', 'id')),
        }))));
      }

      nodes.push(chips([
        { label: 'Start something new', run: () => ctx.startProject() },
        { label: 'What can you build', run: () => ctx.ask('What kinds of things can you build for me?') },
      ]));
      return nodes;
    },
  },

  brief: {
    label: 'Project Brief',
    icon: '✦',
    say: ['brief', 'project brief', 'questions', 'plan my project'],
    async render(ctx) {
      const nodes = [];
      let brief = null;
      try { brief = await getJSON('/api/forge-brief?projectId=' + encodeURIComponent(ctx.projectId())); } catch {}
      if (!brief?.progress) {
        return [
          say(`I couldn't load your Project Brief just now. None of your answers were changed.`),
          chips([{ label: 'Try again', run: () => ctx.go('brief') }]),
        ];
      }

      if (!brief.progress.ready && brief.next_question) {
        nodes.push(say(`I'll collect the important decisions one at a time. Each answer saves automatically, and the next question adapts to your project.`));
        nodes.push(briefQuestionCard(brief.next_question, brief.progress, ctx));
        return nodes;
      }

      nodes.push(say(`Your Project Brief is ready. This is the information I'll use as the source of truth for the first build.`));
      nodes.push(group('What Nex understands', (brief.summary || []).map((item) => row({
        title: item.value || 'Answered',
        meta: `${item.label}${item.comment ? ` · ${item.comment}` : ''}`,
        tone: { label: 'saved', kind: 'f' },
      }))));
      nodes.push(chips([
        { label: 'Build the first version', run: () => ctx.buildFromBrief() },
        { label: 'Start the brief over', run: () => ctx.resetBrief() },
      ]));
      return nodes;
    },
  },

  pages: {
    label: 'Pages',
    icon: '▤',
    say: ['pages', 'page'],
    async render(ctx) {
      const nodes = [];
      let history = null;
      try { history = await getJSON('/api/room-history'); } catch {}
      const builds = pick(history, 'builds', 'history', 'items');

      nodes.push(say(builds.length
        ? `The pages in your project. Tell me what to change on any of them and I'll do it.`
        : `No pages yet. Once we build something, each page shows up here.`));

      if (builds.length) {
        nodes.push(group(null, builds.slice(0, 12).map((build) => row({
          title: String(field(build, 'title', 'name', 'page', 'id')).slice(0, 90),
          meta: relative(field(build, 'updated_at', 'created_at', 'ts')),
          onClick: () => ctx.ask(`I want to change "${String(field(build, 'title', 'name', 'id')).slice(0, 60)}".`),
        }))));
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
      try { status = await getJSON('/api/forge-brain'); } catch { failed = true; }

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
