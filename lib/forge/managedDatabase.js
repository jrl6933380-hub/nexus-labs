// Idempotent control-plane adapter for the managed "Forge Database" layer.
// Provider credentials and connection strings stay behind forgeSecrets.js;
// only safe Neon resource metadata is written to the Build Plan.

import {
  ensureStackManifest,
  setStackSlotState,
} from '../forgeStack.js';
import {
  createNeonDatabase,
  getNeonDatabaseStatus,
} from '../neonProvisioning.js';
import { storeManagedDatabaseUrl } from './forgeSecrets.js';

const PATH_TO_CONNECTING = Object.freeze({
  not_needed: ['selected', 'connecting'],
  recommended: ['selected', 'connecting'],
  selected: ['connecting'],
  error: ['connecting'],
  skipped: ['selected', 'connecting'],
  connecting: [],
});

function safeName(ownerUsername, projectId) {
  return `forge-${ownerUsername}-${projectId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function transitionPath({ ownerUsername, projectId, store, path }) {
  let manifest;
  for (const status of path) {
    manifest = await setStackSlotState({
      ownerUsername, projectId, slotId: 'database', status, store,
    });
  }
  return manifest;
}

export async function provisionManagedDatabase({
  ownerUsername,
  projectId = 'default',
  store,
  provision = createNeonDatabase,
  verify = getNeonDatabaseStatus,
  saveSecret = storeManagedDatabaseUrl,
} = {}) {
  let manifest = await ensureStackManifest({ ownerUsername, projectId, store });
  let slot = manifest.slots?.database;
  if (!slot) throw new Error('Database is not available in this Build Plan.');

  if (slot.status === 'ready' && slot.metadata?.provider_resource_id) {
    const check = await verify({ project_id: slot.metadata.provider_resource_id });
    if (check?.ok) {
      return { ok: true, changed: false, message: 'Forge Database is healthy and ready.', manifest };
    }
    manifest = await setStackSlotState({
      ownerUsername, projectId, slotId: 'database', status: 'error',
      error: check?.reason || 'Database health check failed.', store,
    });
    slot = manifest.slots.database;
  }

  if (slot.status === 'ready' && !slot.metadata?.provider_resource_id) {
    manifest = await setStackSlotState({
      ownerUsername, projectId, slotId: 'database', status: 'error',
      error: 'The previous database record is missing its provider resource ID.', store,
    });
    slot = manifest.slots.database;
  }

  const existingId = slot.metadata?.provider_resource_id;
  if (existingId) {
    const check = await verify({ project_id: existingId });
    if (!check?.ok) {
      const failed = await setStackSlotState({
        ownerUsername, projectId, slotId: 'database', status: 'error',
        error: check?.reason || 'Database health check failed.', store,
      });
      return { ok: false, changed: false, message: 'Forge Database needs attention before setup can continue.', manifest: failed };
    }
    const path = slot.status === 'connected' ? ['testing', 'ready']
      : slot.status === 'testing' ? ['ready']
        : slot.status === 'error' ? ['testing', 'ready'] : [];
    manifest = await transitionPath({ ownerUsername, projectId, store, path });
    return { ok: true, changed: path.length > 0, message: 'Forge Database is tested and ready.', manifest };
  }

  const path = PATH_TO_CONNECTING[slot.status];
  if (!path) throw new Error(`Database cannot be provisioned from ${slot.status}.`);
  manifest = await transitionPath({ ownerUsername, projectId, store, path });

  const created = await provision({ name: safeName(ownerUsername, projectId) });
  if (!created?.provisioned || !created?.project_id || !created?.connection_string) {
    const reason = created?.reason || 'Neon did not return a complete database.';
    const failed = await setStackSlotState({
      ownerUsername, projectId, slotId: 'database', status: 'error', error: reason, store,
    });
    return { ok: false, changed: true, message: `Forge Database could not be created: ${reason}`, manifest: failed };
  }

  try {
    await saveSecret({ ownerUsername, projectId, connectionString: created.connection_string });
  } catch (error) {
    const failed = await setStackSlotState({
      ownerUsername, projectId, slotId: 'database', status: 'error',
      error: 'The database was created but its secure connection could not be saved.', store,
    });
    return {
      ok: false,
      changed: true,
      message: `Database ${created.project_id} was created, but its secure connection needs recovery.`,
      manifest: failed,
      recovery_resource_id: created.project_id,
    };
  }

  manifest = await setStackSlotState({
    ownerUsername, projectId, slotId: 'database', status: 'connected', store,
    metadata: {
      provider: 'neon',
      provider_resource_id: created.project_id,
      database_name: created.database_name || 'neondb',
      region_id: created.region_id || null,
      managed_by: 'forge',
    },
  });
  manifest = await setStackSlotState({
    ownerUsername, projectId, slotId: 'database', status: 'testing', store,
  });
  const check = await verify({ project_id: created.project_id });
  if (!check?.ok) {
    const failed = await setStackSlotState({
      ownerUsername, projectId, slotId: 'database', status: 'error',
      error: check?.reason || 'The new database did not pass its health check.', store,
    });
    return { ok: false, changed: true, message: 'Forge Database was created but did not pass its health check.', manifest: failed };
  }
  manifest = await setStackSlotState({
    ownerUsername, projectId, slotId: 'database', status: 'ready', store,
    metadata: { verified_by: 'neon-project-health' },
  });
  return { ok: true, changed: true, message: 'Forge Database was created, secured, tested, and is ready.', manifest };
}
