// lib/forge/onboardingMachine.js
//
// Forge onboarding as a typed state machine rather than scattered component
// state. The reason is concrete: onboarding crosses an OAuth redirect, so the
// page unloads mid-flow. Anything held in component state is gone when the user
// comes back, and they restart from the top — which is exactly where people
// abandon a signup.
//
// So: states are named, transitions are explicit and validated, and the current
// state is derived from facts (is there a session? is there a connection?)
// rather than remembered. A refresh, a back button, or a provider bounce all
// land on the right step because the step is computed, not stored.

export const STATES = Object.freeze({
  WELCOME: 'welcome',
  ACCOUNT_REQUIRED: 'account_required',
  TERMS_REQUIRED: 'terms_required',
  BRAIN_SELECTION: 'brain_selection',
  PROVIDER_AUTHORIZATION: 'provider_authorization',
  CONNECTION_TEST: 'connection_test',
  READY: 'ready',
  ERROR_RECOVERY: 'error_recovery',
});

const ORDER = [
  STATES.WELCOME,
  STATES.ACCOUNT_REQUIRED,
  STATES.TERMS_REQUIRED,
  STATES.BRAIN_SELECTION,
  STATES.PROVIDER_AUTHORIZATION,
  STATES.CONNECTION_TEST,
  STATES.READY,
];

const TRANSITIONS = {
  [STATES.WELCOME]: [STATES.ACCOUNT_REQUIRED, STATES.TERMS_REQUIRED, STATES.BRAIN_SELECTION, STATES.READY],
  [STATES.ACCOUNT_REQUIRED]: [STATES.TERMS_REQUIRED, STATES.ERROR_RECOVERY],
  [STATES.TERMS_REQUIRED]: [STATES.BRAIN_SELECTION, STATES.ERROR_RECOVERY],
  [STATES.BRAIN_SELECTION]: [STATES.PROVIDER_AUTHORIZATION, STATES.ERROR_RECOVERY],
  [STATES.PROVIDER_AUTHORIZATION]: [STATES.CONNECTION_TEST, STATES.BRAIN_SELECTION, STATES.ERROR_RECOVERY],
  [STATES.CONNECTION_TEST]: [STATES.READY, STATES.ERROR_RECOVERY],
  [STATES.READY]: [STATES.BRAIN_SELECTION],
  // Recovery can always go back to selection or forward to a retest. It must
  // never be a terminal state: a user stuck on an error screen with no move is
  // the failure mode this whole file exists to avoid.
  [STATES.ERROR_RECOVERY]: [STATES.BRAIN_SELECTION, STATES.PROVIDER_AUTHORIZATION, STATES.CONNECTION_TEST, STATES.ACCOUNT_REQUIRED],
};

export function canTransition(from, to) {
  if (!ORDER.includes(from) && from !== STATES.ERROR_RECOVERY) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

export function transition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid onboarding transition: ${from} -> ${to}`);
  }
  return to;
}

/**
 * Derive the current step from facts. This is what survives refreshes and the
 * OAuth round trip — nothing is remembered, so nothing can be stale.
 *
 * @param {object} facts
 * @param {boolean} facts.hasAccount
 * @param {boolean} facts.acceptedTerms
 * @param {boolean} facts.hasConnection
 * @param {boolean} facts.connectionTested
 * @param {boolean} [facts.authorizationPending]
 * @param {string}  [facts.error]
 */
export function deriveState(facts = {}) {
  if (facts.error) return STATES.ERROR_RECOVERY;
  if (!facts.hasAccount) return STATES.ACCOUNT_REQUIRED;
  if (!facts.acceptedTerms) return STATES.TERMS_REQUIRED;
  if (facts.hasConnection) {
    return facts.connectionTested ? STATES.READY : STATES.CONNECTION_TEST;
  }
  // A pending authorization means they have left for the provider and not come
  // back yet. Showing selection again here would lose an in-flight consent.
  if (facts.authorizationPending) return STATES.PROVIDER_AUTHORIZATION;
  return STATES.BRAIN_SELECTION;
}

/**
 * Copy for each step. Kept here so the state machine and what the user reads
 * cannot drift apart, and so no step can exist without something to say.
 *
 * Every message is written for someone who has never built a website. No
 * jargon, and every error names a next move.
 */
export function describe(state, context = {}) {
  switch (state) {
    case STATES.WELCOME:
      return {
        say: `Hey, I'm Nex. Welcome to Forge.\n\nForge builds real things from a description. Before we start, let's get your account set up and pick your Builder Brain.`,
        actions: [{ id: 'begin', label: 'Get started' }],
      };
    case STATES.ACCOUNT_REQUIRED:
      return {
        say: `First, an account so your work is saved and waiting next time.`,
        actions: [{ id: 'signup', label: 'Create account' }, { id: 'login', label: 'I already have one' }],
      };
    case STATES.TERMS_REQUIRED:
      return {
        say: `Quick bit of housekeeping. Forge connects to an AI provider to do the building — that connection is yours, on your account, and you can disconnect it any time.`,
        actions: [{ id: 'accept', label: 'Sounds good' }, { id: 'read', label: 'Read the details' }],
      };
    case STATES.BRAIN_SELECTION:
      return {
        say: `Now pick how much power you want. You can change this whenever — it's the same connection either way.`,
        actions: (context.tiers || []).map((tier) => ({ id: `tier:${tier.id}`, label: tier.label, blurb: tier.blurb })),
      };
    case STATES.PROVIDER_AUTHORIZATION:
      return {
        say: `I'll send you over to authorize the connection. You'll come right back here — nothing to copy or paste.`,
        actions: [{ id: 'authorize', label: 'Connect' }, { id: 'back', label: 'Pick something else' }],
      };
    case STATES.CONNECTION_TEST:
      return {
        say: `Connected. Let me make sure it actually works before we start.`,
        actions: [{ id: 'test', label: 'Check it' }],
      };
    case STATES.READY:
      return {
        say: `You're set. Tell me what you want to build.`,
        actions: [{ id: 'enter', label: 'Start building' }],
      };
    case STATES.ERROR_RECOVERY:
      return {
        say: context.message || `That didn't go through. Nothing's lost — we can try again.`,
        actions: [{ id: 'retry', label: 'Try again' }, { id: 'back', label: 'Pick something else' }],
      };
    default:
      return { say: '', actions: [] };
  }
}

/** Human-readable reasons for the ways a connection can fail, each with a move. */
export const RECOVERY = Object.freeze({
  cancelled: `Looks like you backed out before finishing — no problem, nothing was connected.`,
  expired: `That took a little too long and the link expired. Starting it again takes a second.`,
  rejected: `The provider turned that request down. Trying again usually sorts it.`,
  test_failed: `It connected, but the check didn't pass. Worth reconnecting.`,
  network: `Couldn't reach the provider just now. Might be a blip — try again in a moment.`,
  unknown: `Something went sideways. Nothing's lost, and we can try again.`,
});
