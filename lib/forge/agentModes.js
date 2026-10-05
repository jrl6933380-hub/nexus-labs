// lib/forge/agentModes.js
//
// Agent modes, and the operator's control over what each one actually calls.
//
// Two ideas here, kept deliberately separate:
//
//   1. MODES are what the customer picks, described by GOAL rather than by
//      model name. "Explore an idea and start a project" is a choice someone
//      can make about their own work; "gemma-4-31b vs sonnet-5" is not, and
//      asking a non-technical customer to make it is asking them to guess.
//
//   2. ROUTES are which model a mode calls, and belong to the operator. They
//      live in Redis rather than in this file so a misbehaving model can be
//      swapped from the dashboard in seconds instead of needing a PR and a
//      deploy. That mattered the night a whole free-model pool turned out to
//      be 404ing: the fix was known in minutes and still took a deploy to
//      land.
//
// AUTO is the default inside every mode. The mode sets the CEILING on what
// may be spent; Auto picks the cheapest model that can actually do the job in
// front of it. A one-line copy tweak and a full page build should not cost the
// same, and the customer should not have to think about which is which.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const ROUTES_KEY = 'nexus:forge:model-routes';

/**
 * Customer-facing modes. `goal` is the wording shown in the picker \u2014 it is
 * what the customer is trying to do, not what the machine will do about it.
 */
export const AGENT_MODES = Object.freeze({
  free: {
    id: 'free',
    label: 'Free',
    goal: 'Explore ideas, see how Forge works, and start a project',
    // Honest about the ceiling. A free tier that promises production work
    // sets someone up to conclude the product is broken when a cheap model
    // gives a cheap result.
    note: 'Fast, lightweight models at no cost. Best for starting out and small changes.',
    paid: false,
  },
  power: {
    id: 'power',
    label: 'Power',
    goal: 'Balance cost and quality for most real projects',
    note: 'Stronger models for work you intend to keep.',
    paid: true,
  },
  max: {
    id: 'max',
    label: 'Max',
    goal: 'Best results on complex, production-grade work',
    note: 'The most capable models, for builds worth spending on.',
    paid: true,
  },
});

export const DEFAULT_MODE = 'free';

export function isKnownMode(mode) {
  return Object.prototype.hasOwnProperty.call(AGENT_MODES, String(mode || ''));
}

/** What the customer picker renders. Carries no model ids on purpose. */
export function publicAgentModes() {
  return Object.values(AGENT_MODES).map(({ id, label, goal, note, paid }) => ({
    id, label, goal, note, paid,
  }));
}

/**
 * Fallback routes, used when the operator has not configured any. Kept
 * conservative: if the controller is empty or unreachable, Forge should still
 * run, on the cheap end, rather than defaulting to the expensive end and
 * quietly costing real money.
 */
export const DEFAULT_ROUTES = Object.freeze({
  free: { build: 'anthropic/claude-haiku-4.5', chat: 'anthropic/claude-haiku-4.5' },
  power: { build: 'anthropic/claude-sonnet-5', chat: 'anthropic/claude-haiku-4.5' },
  max: { build: 'anthropic/claude-sonnet-5', chat: 'anthropic/claude-sonnet-5' },
});

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const data = await res.json();
    if (!res.ok || data.error) return null;
    return data.result;
  } catch {
    return null;
  }
}

/** Operator-configured routes merged over the defaults. */
export async function getRoutes() {
  const raw = await redisCommand(['GET', ROUTES_KEY]);
  if (!raw) return { ...DEFAULT_ROUTES };
  try {
    const stored = JSON.parse(raw);
    const merged = {};
    for (const mode of Object.keys(DEFAULT_ROUTES)) {
      merged[mode] = { ...DEFAULT_ROUTES[mode], ...(stored?.[mode] || {}) };
    }
    return merged;
  } catch {
    // A corrupt config must not take Forge down. Fall back rather than throw.
    console.error('agentModes: stored routes were unreadable, using defaults');
    return { ...DEFAULT_ROUTES };
  }
}

/** Operator-only. Callers must check isOperatorUser before reaching this. */
export async function saveRoutes(routes) {
  const clean = {};
  for (const mode of Object.keys(DEFAULT_ROUTES)) {
    const entry = routes?.[mode];
    if (!entry) continue;
    clean[mode] = {
      build: typeof entry.build === 'string' && entry.build ? entry.build : DEFAULT_ROUTES[mode].build,
      chat: typeof entry.chat === 'string' && entry.chat ? entry.chat : DEFAULT_ROUTES[mode].chat,
    };
  }
  await redisCommand(['SET', ROUTES_KEY, JSON.stringify(clean)]);
  return getRoutes();
}

/**
 * Picks the model for one request.
 *
 * `kind` is what the request actually is ('build' or 'chat'), not what the
 * customer asked for in words. A chat turn on Max still does not need a
 * build-grade model, which is where most of the saving in Auto comes from:
 * conversation is the majority of requests and the cheapest kind of work.
 *
 * `templateMatched` is Auto's other signal. Filling a known template is a much
 * smaller job than inventing a page, so it can drop a tier without the
 * customer noticing anything except that it was quicker.
 */
export async function resolveModel({ mode = DEFAULT_MODE, kind = 'build', templateMatched = false } = {}) {
  const chosen = isKnownMode(mode) ? mode : DEFAULT_MODE;
  const routes = await getRoutes();

  // Auto: a templated build on a paid mode is routed as if it were a tier
  // lower. Never applied to Free \u2014 there is nothing below it \u2014 and never to
  // a from-scratch build, which is exactly the case that needs the headroom.
  if (templateMatched && kind === 'build' && chosen !== 'free') {
    const lower = chosen === 'max' ? 'power' : 'free';
    return { model: routes[lower].build, mode: chosen, routedAs: lower, auto: true };
  }

  const route = routes[chosen] || routes[DEFAULT_MODE];
  return {
    model: kind === 'chat' ? route.chat : route.build,
    mode: chosen,
    routedAs: chosen,
    auto: false,
  };
}
