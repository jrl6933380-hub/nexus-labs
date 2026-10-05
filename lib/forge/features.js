// lib/forge/features.js
//
// Feature requirements for legacy Builder Brain connections. The configured
// Nex pod is represented by featureConnection.js with full feature capability.
// Hosting plans and per-customer inference metering remain separate policies.

/** Ordered weakest to strongest. Index is the comparison rank. */
export const TIER_ORDER = Object.freeze(['free', 'fast', 'strong']);

export function tierRank(tier) {
  const index = TIER_ORDER.indexOf(String(tier || '').toLowerCase());
  return index < 0 ? -1 : index;
}

/**
 * Every Forge feature and what it needs.
 *
 * `requires` is the minimum brain tier. `reason` is shown to the customer and
 * must explain the real constraint in plain terms — never "upgrade for more
 * power", which tells them nothing and reads like an upsell.
 */
export const FEATURES = Object.freeze([
  {
    id: 'build',
    name: 'Build from a description',
    blurb: 'Describe what you want and get a working page.',
    requires: 'free',
    reason: 'Works on any connected brain.',
  },
  {
    id: 'edit',
    name: 'Change what you built',
    blurb: 'Ask for changes and I patch the page instead of rebuilding it.',
    requires: 'free',
    reason: 'Works on any connected brain.',
  },
  {
    id: 'brief',
    name: 'Project Brief',
    blurb: 'I interview you first — audience, goals, must-haves — then build from your answers instead of guessing.',
    requires: 'fast',
    reason: 'Planning takes several passes before anything gets built. On the free router that means a lot of waiting and a lot of rate limits, so it needs a paid brain to feel good.',
  },
  {
    id: 'stack',
    name: 'Full stack setup',
    blurb: 'Database, auth, and payments wired into your project.',
    requires: 'strong',
    reason: 'Setup involves long multi-step reasoning where a wrong call costs real money, so it runs on the strongest tier only.',
  },
]);

export function getFeature(id) {
  return FEATURES.find((feature) => feature.id === id) || null;
}

/**
 * Can this connection use this feature?
 *
 * No configured runtime means no. Callers resolve the pod runtime or a legacy
 * provider connection before applying these capability requirements.
 *
 * @param {{ connected?: boolean, tier?: string }|null} connection
 */
export function canUseFeature(connection, featureId) {
  const feature = getFeature(featureId);
  if (!feature) return { allowed: false, reason: 'Unknown feature.' };
  if (!connection?.connected) {
    return {
      allowed: false,
      needsConnection: true,
      requires: feature.requires,
      reason: 'Connect a Builder Brain to start — the free option needs no card.',
    };
  }
  const have = tierRank(connection.tier);
  const need = tierRank(feature.requires);
  if (have < need) {
    return { allowed: false, requires: feature.requires, reason: feature.reason };
  }
  return { allowed: true };
}

/**
 * The full catalogue with each feature marked locked or unlocked for this
 * connection. Drives the Features view, so what the customer is shown is
 * computed from the same rules the server enforces.
 */
export function describeFeatures(connection) {
  return FEATURES.map((feature) => {
    const verdict = canUseFeature(connection, feature.id);
    return {
      id: feature.id,
      name: feature.name,
      blurb: feature.blurb,
      requires: feature.requires,
      unlocked: verdict.allowed,
      reason: verdict.allowed ? null : verdict.reason,
    };
  });
}

/** Features unlocked by a given tier — used to show what an upgrade buys. */
export function featuresForTier(tier) {
  const rank = tierRank(tier);
  return FEATURES.filter((feature) => tierRank(feature.requires) <= rank).map((f) => f.name);
}
