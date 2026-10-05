const SCOPE_FIELDS = ['tenant_id', 'project_id', 'task_id', 'agent_id'];

export async function authorizeScopedSandbox(input = {}, operatorUser, deps = {}) {
  const supplied = SCOPE_FIELDS.filter((field) => Boolean(input[field]));
  if (supplied.length === 0) return { scoped: false, tenantVerified: false };
  if (supplied.length !== SCOPE_FIELDS.length) throw new Error('Scoped sandbox requires tenant_id, project_id, task_id, and agent_id together.');
  if (!operatorUser) throw new Error('Sign in before using a tenant-scoped sandbox.');
  if (typeof deps.assertTenantAccess !== 'function') throw new Error('Tenant authorization is unavailable.');
  await deps.assertTenantAccess({ tenantId: input.tenant_id, ownerUsername: operatorUser });
  return { scoped: true, tenantVerified: true };
}

export function buildSecurityReceipt({ operatorUser = null, runState = null, tenantVerified = false } = {}) {
  return Object.freeze({
    version: 1,
    authenticated: Boolean(operatorUser),
    resumeScopeBound: Boolean(operatorUser && runState?.scopeHash),
    tenantVerified: Boolean(tenantVerified),
    rawCredentialsExposed: false,
  });
}
