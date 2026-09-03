// api/room-push.js
// Takes a redesigned copy of the real index.html (built in the Room,
// imported via the "Import Home" action and safety-shim-stripped) and
// opens a real PR against public/index.html — same branch -> PR ->
// Justin's review -> merge pipeline as every other change tonight,
// never auto-merge. Reuses lib/github.js, the same GITHUB_TOKEN-backed
// helpers Nex's own repo tools already use — no new credentials.

import { getRequestUser } from '../lib/roomAuth.js';
import { createBranch, commitFiles, createPullRequest } from '../lib/github.js';

const OWNER = 'jrl6933380-hub';
const REPO = 'nexus-labs';
const TARGET_PATH = 'public/index.html';

// Defensive strip, in case a client sends something that still has the
// safety shim in it — never trust the client did its own cleanup.
function stripSafetyShim(html) {
  return html.replace(/<!-- NEXUS_SAFETY_SHIM_START -->[\s\S]*?<!-- NEXUS_SAFETY_SHIM_END -->\n?/i, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const username = await getRequestUser(req);
  if (!username) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  const { html } = req.body || {};
  if (!html || typeof html !== 'string' || !html.toLowerCase().includes('<!doctype')) {
    return res.status(400).json({ error: 'Missing or invalid html.' });
  }

  const cleaned = stripSafetyShim(html);
  const branchName = `room-push/${username}-${Date.now()}`;

  try {
    await createBranch({ owner: OWNER, repo: REPO, branch: branchName });
    await commitFiles({
      owner: OWNER,
      repo: REPO,
      branch: branchName,
      message: `Room design push by ${username}: redesigned public/index.html`,
      files: [{ path: TARGET_PATH, content: cleaned }],
    });
    const pr = await createPullRequest({
      owner: OWNER,
      repo: REPO,
      title: `Room design push: ${username}'s redesign of the home page`,
      head: branchName,
      body: `Opened automatically from the live-canvas Room by ${username}, who imported the real public/index.html, redesigned it live inside the Room, and pushed it here.\n\nNot merged — needs review like any other change.`,
    });
    return res.status(200).json({ html_url: pr.html_url, number: pr.number });
  } catch (err) {
    console.error('room-push failed:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to open the PR.' });
  }
}
