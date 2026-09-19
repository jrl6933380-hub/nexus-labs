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

  brain: {
    label: 'Builder Brain',
    icon: '◉',
    say: ['brain', 'builder brain', 'my brain', 'connection'],
    async render(ctx) {
      const nodes = [];
      let status = null;
      let failed = false;
      try { status = await getJSON('/api/forge-brain'); } catch { failed = true; }

      // The connection flow is not built yet. Say so plainly rather than
      // rendering a panel that implies a connection exists — a brain that
      // claims to be connected when it isn't is the worst possible lie here,
      // because every build failure afterwards looks like a broken product.
      if (failed || !status) {
        nodes.push(say(`Your Builder Brain isn't set up yet.\n\nThis is where you'll connect the AI that does the building, pick how much power you want, and see what you've used. Right now your builds run on Forge's own connection.`));
        nodes.push(group('Coming here', [
          row({ title: 'Free', meta: 'Start building, no card needed' }),
          row({ title: 'Fast', meta: 'Quicker, for lots of small changes' }),
          row({ title: 'Strong', meta: 'For the hard stuff' }),
        ]));
        nodes.push(chips([
          { label: 'How does this work', run: () => ctx.ask('Explain the Builder Brain — what am I connecting and why?') },
        ]));
        return nodes;
      }

      const connected = Boolean(field(status, 'connected'));
      nodes.push(say(connected
        ? `Your brain is connected and working.`
        : `Your brain isn't connected yet. Builds run on Forge's connection until you set one up.`));
      nodes.push(group(null, [
        row({ title: 'Connection', meta: String(field(status, 'provider') || 'Forge'), tone: connected ? { label: 'on', kind: 'f' } : { label: 'off', kind: 'g' } }),
        row({ title: 'Power', meta: String(field(status, 'tier', 'model') || 'Free') }),
        row({ title: 'Last checked', meta: relative(field(status, 'tested_at', 'updated_at')) || 'Not yet' }),
      ]));
      nodes.push(chips([
        { label: 'Test it', run: () => ctx.ask('Test my Builder Brain connection.') },
        { label: 'Change power', run: () => ctx.ask('I want to change how much power my builds use.') },
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
