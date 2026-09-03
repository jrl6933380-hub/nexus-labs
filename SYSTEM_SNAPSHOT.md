# Nexus System Snapshots — Test Branch

## Goal

Give every agent a compact, verified starting picture of the system so it can begin useful work without repeatedly scanning the repository, board, bridge, connector list, and deployment history.

A snapshot is an accelerator, not authority. GitHub, Redis, and Vercel remain authoritative.

## Snapshot sections

- `source`: repository, branch, commit SHA, generated time
- `project`: active task, working files, current resume pointer
- `repositories`: relevant repos and branch/commit SHAs
- `capabilities`: available tools and read/write/approval class; never credentials
- `architecture`: routes, modules, Redis namespaces, and dependency edges
- `verification`: last syntax/test/deployment checks and their commit SHAs
- `freshness`: TTL and sources that must be rechecked before writes

Every section carries a source SHA or timestamp. A snapshot is stale when its TTL expires, a source SHA changes, or a requested target is outside its recorded scope.

## Read order

1. Load the latest snapshot.
2. Compare its source commit and branch against the requested work.
3. Refresh only stale sections.
4. Read the exact target file before editing.
5. Write a checkpoint to the execution ledger before a long or risky call.

## Cost controls

- Cache stable architecture and dependency data for longer.
- Refresh active branch, task, ledger, and deployment data more often.
- Store hashes, names, links, and short summaries rather than full files or transcripts.
- Pass only the relevant snapshot sections to a worker.
- Never put secrets, raw connector output, or private prompts in a snapshot.

## Planned runtime flow

`load snapshot -> validate freshness -> targeted refresh -> scoped worker context -> tool calls -> ledger checkpoint -> snapshot patch`

This branch is intentionally a non-live test. It does not alter main, production Redis, or deployment configuration.
