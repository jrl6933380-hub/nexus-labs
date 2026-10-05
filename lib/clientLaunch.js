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

import { createRepo, commitFiles, deleteRepo } from './github.js';
import { createNeonDatabase, deleteNeonDatabase } from './neonProvisioning.js';

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
//
// NOT atomic in the database-transaction sense -- it's three real,
// independent side-effecting calls (Neon, GitHub, GitHub again) with
// no distributed-transaction coordinator behind them. What this DOES
// guarantee: a failure partway through rolls back whatever already
// succeeded rather than leaving it orphaned and billed with nothing
// pointing to it. If a rollback step itself fails, that failure is
// surfaced explicitly in the thrown error rather than swallowed --
// silent partial cleanup would be worse than no cleanup, since it
// would look like the whole launch failed cleanly when it didn't.
// Known remaining gap: a Vercel project linked during a successful
// createRepo is not torn down on a later failure (no verified delete-
// project capability exists in this codebase yet) -- worth a follow-up
// if orphaned Vercel projects turn out to be a real problem in practice.
export async function launchClientProject({ clientName, files, description } = {}) {
  if (!Array.isArray(files) || !files.length) {
    throw new Error('launchClientProject requires at least one file.');
  }
  const slug = slugify(clientName);

  const database = await createNeonDatabase({ name: slug });

  const envVars = database.provisioned
    ? [{ key: 'DATABASE_URL', value: database.connection_string }]
    : [];

  let repo;
  try {
    repo = await createRepo({
      name: slug,
      description: description || `Client site: ${clientName}`,
      private: true,
      envVars,
    });
  } catch (err) {
    if (database.provisioned) {
      try {
        await deleteNeonDatabase({ project_id: database.project_id });
      } catch (cleanupErr) {
        throw new Error(`${err.message} (additionally, rollback of the orphaned database ${database.project_id} failed: ${cleanupErr.message} -- needs manual cleanup in the Neon dashboard)`);
      }
    }
    throw err;
  }

  try {
    await commitFiles({
      owner: repo.full_name.split('/')[0],
      repo: repo.name,
      branch: repo.default_branch,
      message: 'Initial site content',
      files,
    });
  } catch (err) {
    const cleanupFailures = [];
    if (database.provisioned) {
      try {
        await deleteNeonDatabase({ project_id: database.project_id });
      } catch (cleanupErr) {
        cleanupFailures.push(`database ${database.project_id}: ${cleanupErr.message}`);
      }
    }
    try {
      await deleteRepo({ owner: repo.full_name.split('/')[0], repo: repo.name });
    } catch (cleanupErr) {
      cleanupFailures.push(`repo ${repo.full_name}: ${cleanupErr.message}`);
    }
    if (cleanupFailures.length) {
      throw new Error(`${err.message} (additionally, rollback failed for: ${cleanupFailures.join('; ')} -- these need manual cleanup)`);
    }
    throw err;
  }

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
