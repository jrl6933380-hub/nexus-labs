// scripts/seed-code-vault.mjs
// One-off seed script for the Glass Wing Code Vault's first two
// Blueprints — both genuinely proven tonight, not placeholder content.
// Run manually: node scripts/seed-code-vault.mjs
// Same "manual fallback script" pattern as scripts/register-claude-routine-agent.mjs.

import { addVaultItem } from '../lib/codeVault.js';

async function main() {
  const siteShell = await addVaultItem({
    level: 'blueprint',
    name: 'Business Site Shell',
    purpose:
      'Single-page local-business site — hero, services, contact, reviews — generated live via patch-based streaming edits. The default starting structure for a new client site request.',
    when_to_use:
      'First choice for any client with no existing website and good reviews/ratings — the core business use case. Use instead of generating page structure from scratch.',
    language: 'HTML/CSS/JS (static, no build step)',
    framework: null,
    dependencies: [],
    env_vars: [],
    inputs_outputs:
      'Input: business name, services offered, contact info, review highlights. Output: a single deployable static HTML page.',
    source:
      'The Room mechanic — patch-based generation format (<<<OLD>>>/<<<NEW>>>/<<<REWRITE>>>), proven across nexus-labs PRs #12-#22.',
    verification:
      'Manually verified via live preview render in the Room; no automated test suite yet for generated page output.',
    security_notes:
      'Generated and rendered client-side in a sandboxed iframe with no allow-same-origin — generated code has no access to server credentials or the parent page.',
    provenance: ['Room build history (lib/roomHistory.js)', "tonight's Room PR series (#12-#22)"],
    lifecycle_status: 'proven',
    tags: ['site', 'business', 'landing-page', 'room', 'client-site'],
    changelog: 'Initial seed — first Blueprint in the Vault.',
  });

  const dashboardShell = await addVaultItem({
    level: 'blueprint',
    name: 'Agent Dashboard Shell',
    purpose:
      'Live task/agent status dashboard — task board, per-agent presence, progress — the Stark/JARVIS-themed Mission Control UI pattern.',
    when_to_use:
      'Client wants a real-time ops/status view (e.g. a small business tracking jobs/orders) rather than a marketing site.',
    language: 'HTML/CSS/JS',
    framework: null,
    dependencies: [],
    env_vars: [],
    inputs_outputs: 'Input: reads /api/board-shaped task/agent state. Output: a live-updating status dashboard page.',
    source: 'public/nexus-stark.css, public/nexus-shell.js — the mission-orbit dashboard pattern.',
    verification: 'Verified reaching a READY Vercel deployment; responsive/mobile interaction manually confirmed.',
    security_notes: 'Read-only against its data source for display purposes — no write access required for this shell alone.',
    provenance: ['nexus-labs-sandbox Mission Control UI build'],
    lifecycle_status: 'proven',
    tags: ['dashboard', 'status', 'agent', 'mission-control', 'ops'],
    changelog: 'Initial seed — second Blueprint in the Vault.',
  });

  console.log('Seeded:', siteShell, dashboardShell);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
