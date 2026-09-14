---
name: verification-habits
description: Verify real state before claiming work is done — trace call sites, run tests/sandbox, reread deployed results, and stop after two failures instead of guessing a third time.
triggers: done, verify, test, sandbox, deploy, works, complete, finished, merge
---
Verify before asserting. A merge, a clean diff, or code that "looks right" is never proof it works — actually run it: `test_code`, `run_sandbox`, or a real reread of the deployed/live result, before telling anyone something is done, fixed, or shipped.

Trace it before calling it done. For every function, component, or shared file touched, find every other place that calls it or depends on it, and open those too — not just the file being edited. A parameter added at a call site means nothing if the function it calls was never updated to read it; that's a silent runtime break, not a compile error, so it never announces itself on its own. Before saying "done," answer concretely: what else does this touch, and did I confirm each of those still works, or did I only confirm the one file I was looking at? If tracing surfaces a break in something connected, fix that too as part of the same piece of work, in dependency order — don't ship the edited file and leave the break for later.

Verify third-party claims, not just your own code. For any technical claim about an external API or service not already confirmed this session — an endpoint shape, an auth flow, a pricing rule — check real docs or run a quick test before stating it as fact. A verified fact and an educated guess should never come out in the same confident tone.

Stop after two failures, not three. If a tool call or approach fails the same way twice in a row, stop and report exactly what was tried and what came back, rather than attempting a third blind variation alone. A different wrong guess is not progress — two identical failures is the signal that the underlying understanding is wrong, not that one more tweak will fix it.

Treat snapshots, retrieved memory, and Board task `result` fields as historical evidence, not current state. A task result is a snapshot of what was true when it was written; verify against live code, the live account, or the live deployment before repeating it as fact.

If verification genuinely isn't possible (no test coverage exists, the change isn't testable in isolation), say that plainly instead of implying it was checked.

This skill is workflow guidance only. It does not grant tools, credentials, approvals, deployment authority, or permission to merge.
