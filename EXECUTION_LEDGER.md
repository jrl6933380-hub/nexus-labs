# Execution Ledger — Test Branch

Status: proposed test implementation
Branch: test/execution-ledger
Base: main at the latest Claude merge

## Purpose

Record the execution state of every agent run so an interrupted ChatGPT, Claude, or Nex session can resume without guessing. The ledger is separate from the human-readable BRIDGE.md handoff:

- BRIDGE.md stays concise and narrative.
- The ledger is structured, append-only run history.
- The board shows the current resume pointer and recent tool activity.

## One record per tool call

Each call produces a start event and exactly one terminal event.

```json
{
  "run_id": "run-...",
  "sequence": 17,
  "task_id": "board-task-id",
  "agent": "chatgpt",
  "tool": "nexus_github_write_get_file",
  "purpose": "Read lib/board.js before editing",
  "target": "jrl6933380-hub/nexus-labs:main:lib/board.js",
  "status": "started|completed|failed|cancelled",
  "started_at": 0,
  "finished_at": 0,
  "result_summary": "short redacted summary",
  "artifact_refs": ["commit:..."],
  "error_code": null,
  "next_action": "Create test branch after confirming current main SHA",
  "approval": "not_required|pending|approved|declined",
  "redactions": ["authorization", "token", "cookie", "private_key"]
}
```

Never store prompt transcripts, OAuth/API tokens, cookies, private keys, raw authorization headers, or unrestricted tool output. Store only a bounded summary, safe identifiers, and links/SHAs.

## Resume pointer

Every meaningful update writes one current pointer:

```json
{
  "run_id": "run-...",
  "task_id": "board-task-id",
  "agent": "chatgpt",
  "state": "running|paused|blocked|complete",
  "last_sequence": 17,
  "last_completed_tool": "nexus_github_write_get_file",
  "last_result": "Read the current board implementation",
  "next_safe_action": "Run syntax tests on test/execution-ledger",
  "working_branch": "test/execution-ledger",
  "files_touched": ["EXECUTION_LEDGER.md"],
  "blocker": null,
  "updated_at": 0
}
```

The next agent reads the pointer first, then the last few ledger events, then the task/bridge context. It must not repeat a completed write unless the event is marked failed or the result is unknown.

## Event lifecycle

1. `tool_started`: intent, target, branch, task, and approval state.
2. `tool_completed`: bounded result summary, artifact refs, and next action.
3. `tool_failed`: safe error code/message, whether the write may have happened, and recovery action.
4. `checkpoint`: current resume pointer before a long operation or usage limit.
5. `run_paused`: written automatically when the agent is cut off or voluntarily yields.
6. `run_completed`: acceptance criteria and verification evidence.

If a write times out, the next action is always “re-read target and compare SHA/state before retrying.” This prevents duplicate commits.

## Board integration

The board should expose:

- `execution_run_id`
- `last_tool`
- `last_tool_status`
- `last_tool_at`
- `resume_next_action`
- `working_branch`
- `checkpoint_state`

The visible Activity panel can show a compact stream such as:

`GPT → get_file → completed → lib/board.js read → next: create ledger module`

Full details remain available through the run's ledger ID.

## Safe implementation order

1. Add the ledger storage/helper with bounded redaction.
2. Add start/complete/fail/checkpoint actions to the board service.
3. Wrap Nexus MCP tool dispatch so every tool call emits events in a finally-safe path.
4. Add resume loading before an agent begins work.
5. Add UI activity rows and a “resume from checkpoint” action.
6. Test duplicate-write timeout, failed tool, approval pause, and cut-off/resume.

## Acceptance tests

- A read call appears with purpose, target, status, and result summary.
- A successful write records its commit/PR reference without raw output.
- A failed or timed-out write tells the next agent to re-read before retrying.
- A cut-off run leaves a durable resume pointer.
- A new agent can identify the exact next safe action from the pointer alone.
- Secrets never appear in ledger data.
- Existing board tasks and BRIDGE.md remain readable.
- This branch can be discarded without affecting main.
