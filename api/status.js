// /api/status.js
// Public, read-only system status — the live version of Cleaner's daily
// report, queryable on demand instead of only once a day. No mutation,
// no LLM, no secrets: task/crash content is already redacted before it
// reaches storage (lib/secretScan.js, lib/crashFeed.js), and PR data is
// just titles and filenames from GitHub. Deliberately unauthenticated,
// same as the existing public Mission Control telemetry — the whole
// point is that Claude, ChatGPT, or Nex can pull this without needing a
// secret handed to them out of band.

import { readBoard } from '../lib/board.js';
import { buildSystemStatus } from '../lib/cleanupAgent.js';
import { listCrashes } from '../lib/crashFeed.js';
import { getDefaultBranch, listPullRequests, listPullRequestFiles } from '../lib/github.js';

const OWNER = process.env.NEXUS_REPO_OWNER || 'jrl6933380-hub';
const REPO = process.env.NEXUS_REPO_NAME || 'nexus-labs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const status = await buildSystemStatus({
      readBoard,
      listCrashes,
      github: { getDefaultBranch, listPullRequests, listPullRequestFiles },
      owner: OWNER,
      repo: REPO,
    });
    return res.status(200).json(status);
  } catch (err) {
    console.error('status endpoint failed:', err.message);
    return res.status(500).json({ error: 'Status unavailable' });
  }
}
