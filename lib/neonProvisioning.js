// lib/neonProvisioning.js
// Provisions a real, dedicated Postgres database per client project —
// the piece "launch real full-stack sites, not cheap single-page
// demos" actually needs. Neon over a self-managed Postgres because it
// has a purpose-built API for exactly this ("create a new isolated
// database on demand"), a generous free tier per project, and it's
// the same underlying engine Vercel's own Postgres offering runs on.
//
// Best-effort by design, same pattern as lib/vercel.js: no
// NEON_API_KEY configured means "not provisioned," not a hard crash —
// a client site can still launch as a static-only deploy while the
// key gets set up, rather than the whole launch failing.

const NEON_API = 'https://console.neon.tech/api/v2';
const NEON_API_KEY = process.env.NEON_API_KEY;
const NEON_ORG_ID = process.env.NEON_ORG_ID;

export async function createNeonDatabase({ name, regionId = 'aws-us-east-1' } = {}) {
  if (!NEON_API_KEY) {
    return { provisioned: false, reason: 'No NEON_API_KEY configured.' };
  }
  if (!name || typeof name !== 'string') {
    throw new Error('createNeonDatabase requires a project name.');
  }

  let data;
  try {
    const res = await fetch(`${NEON_API}/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NEON_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project: { name, region_id: regionId, pg_version: 17 },
        // Some Neon API keys (org-scoped, or personal keys on an account
        // that belongs to an org) require org_id explicitly — confirmed
        // live: Neon rejects project creation with a 400 ("org_id is
        // required") without it. Omitted entirely when not configured,
        // so a personal key that doesn't need it is unaffected.
        ...(NEON_ORG_ID ? { org_id: NEON_ORG_ID } : {}),
      }),
    });
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new Error(`Neon API error (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
    }
  } catch (err) {
    console.error('createNeonDatabase failed:', err.message);
    return { provisioned: false, reason: err.message };
  }

  // Creating a project also creates a default branch, compute endpoint,
  // database, and role in the same call — the connection string is
  // ready to use immediately, no follow-up calls needed.
  const uri = data?.connection_uris?.[0] || {};
  return {
    provisioned: true,
    project_id: data.project?.id || null,
    connection_string: uri.connection_uri || null,
    database_name: uri.database_name || 'neondb',
    region_id: data.project?.region_id || regionId,
  };
}

export async function deleteNeonDatabase({ project_id } = {}) {
  if (!NEON_API_KEY) return { deleted: false, reason: 'No NEON_API_KEY configured.' };
  if (!project_id) throw new Error('deleteNeonDatabase requires project_id.');
  const res = await fetch(`${NEON_API}/projects/${encodeURIComponent(project_id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${NEON_API_KEY}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Neon API error deleting project (${res.status}): ${text.slice(0, 300)}`);
  }
  return { deleted: true, project_id };
}
