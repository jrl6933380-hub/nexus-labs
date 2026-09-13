// lib/clientLaunch.js
// The actual "launch a real client site, not another cheap single-page
// demo" pipeline: dedicated Postgres (lib/neonProvisioning.js) + a
// dedicated GitHub repo, auto-linked to its own Vercel project with
// the database wired in as DATABASE_URL from the moment it's created
// (lib/github.js's createRepo already does the GitHub-repo-creation +
// Vercel-linking half of this — this just adds the database and the
// initial file commit on top).
//
// Runs entirely on this account's own GitHub/Vercel/Neon credentials
// (Tier 1 from the operator's plan) — no client OAuth involved.

import { createRepo, commitFiles } from './github.js';
import { createNeonDatabase } from './neonProvisioning.js';

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `client-${Date.now()}`;
}

// files: [{ path, content }] — the generated site's actual files.
// A single index.html works today (that's all the site generator
// produces yet); this pipeline doesn't care how many files there are,
// so it's ready for real multi-file backend code the moment the
// generation side produces it.
export async function launchClientProject({ clientName, files, description } = {}) {
  if (!Array.isArray(files) || !files.length) {
    throw new Error('launchClientProject requires at least one file.');
  }
  const slug = slugify(clientName);

  const database = await createNeonDatabase({ name: slug });

  const envVars = database.provisioned
    ? [{ key: 'DATABASE_URL', value: database.connection_string }]
    : [];

  const repo = await createRepo({
    name: slug,
    description: description || `Client site: ${clientName}`,
    private: true,
    envVars,
  });

  await commitFiles({
    owner: repo.full_name.split('/')[0],
    repo: repo.name,
    branch: repo.default_branch,
    message: 'Initial site content',
    files,
  });

  return {
    client_name: clientName,
    slug,
    repo: { html_url: repo.html_url, full_name: repo.full_name },
    vercel: repo.vercel,
    database: database.provisioned
      ? { provisioned: true, project_id: database.project_id }
      : { provisioned: false, reason: database.reason },
  };
}
