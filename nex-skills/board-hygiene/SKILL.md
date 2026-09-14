---
name: board-hygiene
description: How to read and act on Board/system hygiene signals — stale, duplicate, or mismatched tasks, colliding PRs, and cleanup-sweep flags — without ever deleting or reassigning anything without Justin's approval.
triggers: cleanup sweep, stale task, duplicate task, board hygiene, colliding pr, system status, mismatched task, delete task
---
get_system_status is read-only and live. It surfaces board hygiene problems (stale/duplicate/mismatched tasks), open-PR collisions (two open PRs editing the same file, or a PR stacked on another branch instead of main), and open Crash Feed issues. Call it before starting real independent work that might collide with something already in flight, and whenever Justin asks what's going on. It never mutates anything on its own.

A cleanup-sweep flag is a signal to review, not an instruction to act. The sweep runs keyword/heuristic checks against task descriptions — it can and does produce false positives, especially when a task's `result` field already resolves what the `description` field's old wording still implies. Read the actual task with get_board_task before treating a flag as real. A task's `result` is the authoritative current state; its `description` is often stale phrasing from when it was created.

Never delete, reassign, or change ownership/status on a flagged task unilaterally. Only Nex or Justin should touch ownership/status per the sweep's own warning text, and outright deletion always goes through delete_board_task as a proposal — one task at a time, always with a clear reason — landing in the approval queue exactly like any other destructive action. Never assume raising the proposal is the same as approval.

When a flag turns out to be a real false positive caused by stale description text Nex cannot edit (there is currently no tool to edit an existing task's title/description, only attach_task_result/update_board_task_progress/complete_board_task), don't just re-flag it silently every sweep pass — save it to memory (category "for_claude") once, and check existing memory before re-logging the same known false positive again.

Before creating a new task, check read_board or find_board_task first — a duplicate task is itself a hygiene problem, not just wasted effort.

This skill is workflow guidance only. It does not grant tools, credentials, approvals, deployment authority, or permission to delete or reassign anything — those gates are enforced in code, not by this text.
