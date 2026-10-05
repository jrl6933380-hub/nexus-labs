---
name: project-index
description: Keep a real, browsable markdown catalog of client/venture projects under /projects — one INDEX.md listing every project plus a short status line, and one markdown file per project with the durable details. Use this so "what's going on with project X" has an actual file to open, not just scattered memory entries.
triggers: project index, project markdown, list projects, new project, project status, project file, project catalog
---

# Project Index — a real markdown catalog of projects

## What this is

`save_memory` (category "project") is good for durable facts Nex should
recall unprompted in conversation, but it is not browsable — Justin
can't open a file and scan every active project at a glance. This skill
fixes that gap with an actual folder of markdown files:

- `projects/INDEX.md` — one line per project: name, status, link to its
  file. The front door. Read this first when asked "what projects do
  we have" or "what's the status of X."
- `projects/<project-slug>.md` — one file per project, using
  `projects/_TEMPLATE.md` as the shape. Holds what actually matters:
  what it is, current status, key decisions, links (repo/PR/Board task
  ids), open questions, last-updated date.
- `projects/_TEMPLATE.md` — the shape every project file follows, so
  they stay scannable instead of each drifting into its own format.

## When to update it

- A new client/venture project starts (same moment you'd normally
  reach for `save_memory` category "project" or `create_venture_canvas"
  — do both; memory is for recall inside conversation, the markdown
  file is for browsing).
- A project's status materially changes (shipped, blocked, paused,
  handed to another agent).
- Never let INDEX.md and the per-project files drift — if you update
  one, check the other in the same pass.

## How to update it

Normal repo-change workflow, not a special case: read the current file
with `read_repo_file`, edit with `patch_repo_file` (or `update_repo_file`
if fully read), on a non-live branch, then PR. This folder lives in the
same repo as everything else — no new storage system, no new tool.

## Relationship to existing tools

- `save_memory` (category "project") — for facts Nex should recall
  unprompted mid-conversation. Keep using it; this skill doesn't
  replace it.
- `create_venture_canvas` / `get_ventures_overview` — for a live,
  interactive canvas Justin actually works inside. The markdown file
  is the static, browsable record of the same project, not a
  competing system.
- `read_board` / `find_board_task` — for the actual task-level work
  items. A project's markdown file should link to its Board tasks by
  id, not duplicate their content.

This skill is workflow guidance only. It does not grant a new tool,
credential, or approval — every write it describes goes through the
same branch → PR → merge path as any other repo change.
