// Managed Neon project provisioning for Forge customer projects.

const NEON_API = 'https://console.neon.tech/api/v2';
const neonApiKey = () => process.env.NEON_API_KEY;
const neonOrgId = () => process.env.NEON_ORG_ID;

async function neonRequest(path, options = {}) {
  const apiKey = neonApiKey();
  if (!apiKey) return { ok: false, reason: 'No NEON_API_KEY configured.' };
  try {
    const response = await fetch(`${NEON_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      return { ok: false, status: response.status, reason: `Neon API error (${response.status}): ${JSON.stringify(data).slice(0, 300)}` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function createNeonDatabase({ name, regionId = 'aws-us-east-1' } = {}) {
  if (!neonApiKey()) return { provisioned: false, reason: 'No NEON_API_KEY configured.' };
  if (!name || typeof name !== 'string') throw new Error('createNeonDatabase requires a project name.');
  const orgId = neonOrgId();
  const result = await neonRequest('/projects', {
    method: 'POST',
    body: JSON.stringify({
      project: { name, region_id: regionId, pg_version: 17 },
      ...(orgId ? { org_id: orgId } : {}),
    }),
  });
  if (!result.ok) {
    console.error('createNeonDatabase failed:', result.reason);
    return { provisioned: false, reason: result.reason };
  }
  const data = result.data;
  const uri = data?.connection_uris?.[0] || {};
  return {
    provisioned: true,
    project_id: data?.project?.id || null,
    connection_string: uri.connection_uri || null,
    database_name: uri.database_name || 'neondb',
    region_id: data?.project?.region_id || regionId,
  };
}

export async function getNeonDatabaseStatus({ project_id } = {}) {
  if (!project_id) throw new Error('getNeonDatabaseStatus requires project_id.');
  const result = await neonRequest(`/projects/${encodeURIComponent(project_id)}`, { method: 'GET' });
  if (!result.ok) return { ok: false, project_id, reason: result.reason, status: result.status || null };
  const project = result.data?.project || result.data;
  return {
    ok: Boolean(project?.id),
    project_id: project?.id || project_id,
    region_id: project?.region_id || null,
    platform_id: project?.platform_id || null,
  };
}

export async function deleteNeonDatabase({ project_id } = {}) {
  if (!neonApiKey()) return { deleted: false, reason: 'No NEON_API_KEY configured.' };
  if (!project_id) throw new Error('deleteNeonDatabase requires project_id.');
  const result = await neonRequest(`/projects/${encodeURIComponent(project_id)}`, { method: 'DELETE' });
  if (!result.ok && result.status !== 404) throw new Error(result.reason);
  return { deleted: true, project_id };
}

