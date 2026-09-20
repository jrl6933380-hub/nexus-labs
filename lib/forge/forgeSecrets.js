// Secret boundary for Forge-managed project infrastructure.
//
// Build Plan manifests may contain safe provider resource IDs, but never live
// database URLs or API keys. Reuse the existing encrypted tenant credential
// vault with a deterministic, non-identifying scope for each Forge project.

import crypto from 'node:crypto';

async function storeInVault(input) {
  const { storeTenantCredential } = await import('../tenantCredentials.js');
  return storeTenantCredential(input);
}

async function getFromVault(input) {
  const { getTenantCredential } = await import('../tenantCredentials.js');
  return getTenantCredential(input);
}

async function deleteFromVault(input) {
  const { deleteTenantCredential } = await import('../tenantCredentials.js');
  return deleteTenantCredential(input);
}

function normalize(value, label) {
  const cleaned = String(value || '').trim().toLowerCase();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

export function forgeCredentialScope({ ownerUsername, projectId = 'default' } = {}) {
  const owner = normalize(ownerUsername, 'ownerUsername');
  const project = normalize(projectId, 'projectId');
  const digest = crypto.createHash('sha256').update(`${owner}\0${project}`).digest('hex');
  return `forge-${digest}`;
}

export async function storeManagedDatabaseUrl({
  ownerUsername,
  projectId = 'default',
  connectionString,
  storeCredential = storeInVault,
} = {}) {
  if (!connectionString) throw new Error('A database connection string is required.');
  await storeCredential({
    tenantId: forgeCredentialScope({ ownerUsername, projectId }),
    provider: 'neon-database',
    accessToken: connectionString,
  });
  return { stored: true };
}

// Internal server use only. Never return this value from an API or model tool.
export async function getManagedDatabaseUrl({
  ownerUsername,
  projectId = 'default',
  getCredential = getFromVault,
} = {}) {
  const record = await getCredential({
    tenantId: forgeCredentialScope({ ownerUsername, projectId }),
    provider: 'neon-database',
  });
  return record?.accessToken || null;
}

export async function deleteManagedDatabaseUrl({
  ownerUsername,
  projectId = 'default',
  deleteCredential = deleteFromVault,
} = {}) {
  return deleteCredential({
    tenantId: forgeCredentialScope({ ownerUsername, projectId }),
    provider: 'neon-database',
  });
}
