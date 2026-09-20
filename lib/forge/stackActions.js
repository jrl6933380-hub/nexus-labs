// Protected, provider-aware actions for the Forge Build Plan.
//
// This module is deliberately a control plane. It never accepts or returns a
// credential. A slot only becomes ready after its verifier returns positive
// evidence. Providers without a safe connector stay visibly blocked instead
// of being advanced because a customer clicked a button.

import {
  ensureStackManifest,
  setStackSlotState,
  stackProgress,
} from '../forgeStack.js';

const SLOT_ACTIONS = Object.freeze({
  brain: {
    kind: 'account_connection',
    label: 'Open Builder Brain',
    operation: 'open_brain',
    available: true,
    help: 'Connect or check the customer-owned Builder Brain.',
  },
  auth: {
    kind: 'managed',
    label: 'Check sign-in',
    operation: 'verify',
    available: true,
    help: 'Forge Accounts is managed by Forge and can be checked immediately.',
  },
  database: {
    kind: 'provision',
    label: 'Set up database',
    operation: 'prepare',
    available: false,
    blocker: 'A real project ID and publish target are required before Forge can safely provision a database.',
  },
  storage: {
    kind: 'provision',
    label: 'Set up file storage',
    operation: 'prepare',
    available: false,
    blocker: 'The Vercel Blob connector is not available yet.',
  },
  deployment: {
    kind: 'publish',
    label: 'Publish first version',
    operation: 'open_publish',
    available: false,
    blocker: 'Hosting becomes testable after the project has a real publish target.',
  },
  payments: {
    kind: 'oauth',
    label: 'Connect Stripe',
    operation: 'prepare',
    available: false,
    blocker: 'Customer Stripe authorization is not connected to the Build Plan yet.',
  },
  email: {
    kind: 'oauth_or_managed',
    label: 'Connect email',
    operation: 'prepare',
    available: false,
    blocker: 'Customer email authorization and sender verification are not connected yet.',
  },
  domain: {
    kind: 'publish',
    label: 'Connect a domain',
    operation: 'prepare',
    available: false,
    blocker: 'A live deployment is required before a domain can be connected and tested.',
  },
  observability: {
    kind: 'managed_or_oauth',
    label: 'Set up monitoring',
    operation: 'prepare',
    available: false,
    blocker: 'Per-project monitoring is not connected to the Build Plan yet.',
  },
});

function publicAction(slotId, slot) {
  const definition = SLOT_ACTIONS[slotId] || {
    kind: 'unknown',
    label: 'Ask Nex',
    operation: 'prepare',
    available: false,
    blocker: 'Forge does not have a safe setup action for this service yet.',
  };
  if (slot?.status === 'ready') {
    return {
      ...definition,
      label: definition.available ? 'Check again' : definition.label,
      operation: definition.available ? 'verify' : definition.operation,
    };
  }
  return { ...definition };
}

export function describeStackActions(manifest) {
  return Object.fromEntries(
    Object.entries(manifest?.slots || {}).map(([slotId, slot]) => [slotId, publicAction(slotId, slot)]),
  );
}

async function advanceToReady({ ownerUsername, projectId, slotId, metadata, store }) {
  let manifest = await ensureStackManifest({ ownerUsername, projectId, store });
  const path = {
    not_needed: ['selected', 'connecting', 'connected', 'testing', 'ready'],
    recommended: ['selected', 'connecting', 'connected', 'testing', 'ready'],
    selected: ['connecting', 'connected', 'testing', 'ready'],
    connecting: ['connected', 'testing', 'ready'],
    connected: ['testing', 'ready'],
    testing: ['ready'],
    error: ['testing', 'ready'],
    skipped: ['selected', 'connecting', 'connected', 'testing', 'ready'],
    ready: [],
  }[manifest.slots?.[slotId]?.status];
  if (!path) throw new Error('This service must be selected before it can be checked.');
  for (const status of path) {
    manifest = await setStackSlotState({
      ownerUsername,
      projectId,
      slotId,
      status,
      metadata: status === 'ready' ? metadata : {},
      store,
    });
  }
  return manifest;
}

async function defaultVerify({ ownerUsername, slotId }) {
  if (slotId === 'auth') {
    return { ok: true, metadata: { verified_by: 'forge-session' } };
  }
  if (slotId === 'brain') {
    // Load the secret-aware store only for this verifier. Keeping the rest of
    // the action registry independent makes it usable in tests and future
    // provider workers without pulling credential code into every request.
    const { getConnection } = await import('./brainStore.js');
    const connection = await getConnection(ownerUsername);
    if (!connection?.connected) {
      return { ok: false, message: 'Connect your Builder Brain first.', next_view: 'brain' };
    }
    if (!connection?.tested_at) {
      return { ok: false, message: 'Your Builder Brain is connected but still needs a successful check.', next_view: 'brain' };
    }
    return {
      ok: true,
      metadata: { provider: connection.provider || 'openrouter', verified_by: 'provider-test' },
    };
  }
  return { ok: false, message: SLOT_ACTIONS[slotId]?.blocker || 'No safe verifier is available yet.' };
}

export async function runStackAction({
  ownerUsername,
  projectId = 'default',
  slotId,
  operation,
  store,
  verify = defaultVerify,
} = {}) {
  const manifest = await ensureStackManifest({ ownerUsername, projectId, store });
  const slot = manifest.slots?.[slotId];
  if (!slot) throw new Error('Unknown stack slot.');
  const action = publicAction(slotId, slot);

  if (operation === 'open_brain' && slotId === 'brain') {
    return { ok: true, changed: false, next_view: 'brain', message: 'Open Builder Brain to connect or check it.', manifest };
  }
  if (operation === 'open_publish' && slotId === 'deployment') {
    return { ok: false, changed: false, next_view: 'preview', message: action.blocker, manifest };
  }
  if (operation === 'prepare') {
    return { ok: false, changed: false, message: action.blocker || action.help, manifest };
  }
  if (operation !== 'verify') throw new Error('Unknown stack operation.');

  const evidence = await verify({ ownerUsername, projectId, slotId, slot });
  if (!evidence?.ok) {
    return {
      ok: false,
      changed: false,
      message: evidence?.message || 'That service did not pass its check.',
      next_view: evidence?.next_view || null,
      manifest,
    };
  }

  const wasReady = slot.status === 'ready';
  const ready = await advanceToReady({
    ownerUsername,
    projectId,
    slotId,
    metadata: evidence.metadata || {},
    store,
  });
  return {
    ok: true,
    changed: !wasReady,
    message: `${slotId === 'auth' ? 'Sign-in' : 'Builder Brain'} is tested and ready.`,
    manifest: ready,
    progress: stackProgress(ready),
  };
}

export const __internals = { SLOT_ACTIONS, publicAction, advanceToReady, defaultVerify };
