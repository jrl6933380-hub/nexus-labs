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

      nodes.push(say(builds.length
        ? `Here's what you've built so far. Pick one up, or tell me something new and I'll start it.`
        : `Nothing built yet. Tell me what you want — a site for your business, a booking page, somewhere for customers to find you — and I'll start it.`));

      if (builds.length) {
        nodes.push(group(null, builds.slice(0, 12).map((build) => row({
          title: String(field(build, 'title', 'name', 'prompt', 'id')).slice(0, 90),
          meta: relative(field(build, 'updated_at', 'created_at', 'ts')),
          onClick: () => ctx.ask(`Open "${String(field(build, 'title', 'name', 'prompt', 'id')).slice(0, 60)}" and tell me where it stands.`),
        }))));
      }

      nodes.push(chips([
        { label: 'Start something new', run: () => ctx.ask('I want to build something new. Ask me what you need to know.') },
        { label: 'What can you build', run: () => ctx.ask('What kinds of things can you build for me?') },
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
    label: 'Your Stack',
    icon: '⬡',
    say: ['stack', 'my stack', 'your stack', 'setup', 'services'],
    async render(ctx) {
      const nodes = [];
      let manifest = null;
      try { manifest = await getJSON('/api/forge-stack?projectId=default'); } catch {}

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
        const provider = slot.provider
          ? (definition.providers || []).find((item) => item.id === slot.provider)?.label || slot.provider
          : 'Choose when needed';
        const label = statusLabel[slot.status] || slot.status;
        return row({
          title: definition.label || slotId,
          meta: `${provider} · ${definition.purpose || 'Project service'}`,
          tone: { label, kind: slot.status === 'ready' ? 'f' : 'g' },
          onClick: () => ctx.ask(`Walk me through setting up ${definition.label || slotId} for my project. Check its real connection state first and do not call it ready until it passes a test.`),
        });
      };

      if (required.length) nodes.push(group('Needed for this project', required.map(makeRow)));
      if (optional.length) nodes.push(group('Add when you need them', optional.map(makeRow)));
      nodes.push(chips([
        { label: 'Plan my stack', run: () => ctx.ask('Ask me what I am building, then recommend the full stack it needs and update my checklist.') },
        { label: 'Set up the next piece', run: () => ctx.ask('Open my stack checklist and walk me through the next unfinished required piece.') },
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
      try { status = await getJSON('/api/openrouter-oauth?action=status&projectId=default'); } catch {}

      const callbackResult = new URLSearchParams(location.search).get('connection');
      const connected = Boolean(status?.connected);
      if (!connected) {
        nodes.push(say(callbackResult === 'error'
          ? `OpenRouter didn't finish connecting. Nothing was saved and no Forge build used your owner's key. Try again when you're ready.`
          : `Your Builder Brain needs a power source before Forge can build. Connect OpenRouter once, sign in there, and approve Nexus Forge. OpenRouter creates your own key behind the scenes — you never copy or paste it, and Forge never shows it.`));
        nodes.push(group('What you get', [
          row({ title: 'One account, many models', meta: 'Choose free or paid models through OpenRouter' }),
          row({ title: 'Your usage, your limits', meta: 'Model charges stay on your OpenRouter account' }),
          row({ title: 'Private connection', meta: 'The key stays encrypted on the server' }),
        ]));
        nodes.push(chips([
          { label: 'Connect OpenRouter', run: () => location.assign('/api/openrouter-oauth?action=start&projectId=default') },
          { label: 'How does this work', run: () => ctx.ask('Explain the Builder Brain connection and what OpenRouter controls.') },
        ]));
        return nodes;
      }

      const metadata = status.metadata || {};
      nodes.push(say(callbackResult === 'success'
        ? `Your Builder Brain is connected, tested, and ready. From now on Forge build requests use this OpenRouter connection — not the Forge owner's AI bill.`
        : `Your Builder Brain is connected and ready. Forge uses your OpenRouter connection for builds.`));
      nodes.push(group(null, [
        row({ title: 'Connection', meta: 'OpenRouter', tone: { label: status.status === 'ready' ? 'ready' : status.status, kind: 'f' } }),
        row({ title: 'Account type', meta: metadata.is_free_tier ? 'Free tier' : 'Funded account' }),
        row({ title: 'Available limit', meta: Number.isFinite(metadata.limit_remaining) ? String(metadata.limit_remaining) : 'Managed by OpenRouter' }),
        row({ title: 'Last tested', meta: relative(status.tested_at) || 'Just now' }),
      ]));
      nodes.push(chips([
        ...(metadata.settings_url ? [{ label: 'Open settings', run: () => window.open(metadata.settings_url, '_blank', 'noopener') }] : []),
        ...(metadata.logs_url ? [{ label: 'View usage', run: () => window.open(metadata.logs_url, '_blank', 'noopener') }] : []),
        {
          label: 'Disconnect',
          run: async () => {
            await fetch('/api/openrouter-oauth', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'disconnect', projectId: 'default' }),
            });
            ctx.go('brain');
          },
        },
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
