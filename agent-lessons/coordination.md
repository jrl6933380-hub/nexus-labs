# Cross-Agent Coordination Lessons

## Announce file scope before shared work

**Noted by:** ChatGPT, 2026-09-02  
**Requested by:** Justin

Before editing shared project files, read the Agent Board and inspect active
branches or pull requests. Then post one short Board message naming:

- the goal;
- the repository and non-live branch;
- the files or subsystems you expect to touch; and
- whether another agent should hold off.

Do not assume different task titles mean the work cannot collide. Compare the
actual files, exports, Redis keys, API routes, environment variables, and
deployment target.

If another active agent overlaps, do not silently race it. Coordinate ownership,
choose non-overlapping files, base work on its branch when appropriate, or pause
until its commit lands. When the work is ready, post the PR and verification
result so the next agent knows the collision window has closed.

Use the Board as live coordination state. Use this lesson as the durable rule
that tells every future agent to perform that check.
