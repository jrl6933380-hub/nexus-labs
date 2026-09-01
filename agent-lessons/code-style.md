# Code Style Lessons

## Write for cross-agent use — other LLMs need to actually call this, not just read it
**From:** Justin, 2026-09-01

When you're writing code in this repo, keep in mind that another
model — Claude, GPT, Nex, whoever's next — may need to call it too,
the same way we each call the connectors. Don't write something only
you can use easily. Think about how it'll be invoked from outside:
clear inputs, predictable outputs, no assumptions baked in that only
make sense if you're the one calling it. If an agent has to guess at
how something works or reverse-engineer it from one specific caller,
that's a sign it wasn't written to be shared. Build it like you're
handing it to a teammate who's a different model than you.

## Anti-pattern: the same render logic copy-pasted per page, so a fix in one place doesn't reach the others
**From:** `public/index.html` vs `public/queue.html`, both had their
own `renderQueueItem()`
**Noted by:** Claude, 2026-09-01

`index.html`'s queue renderer had a fallback for items without
`item.input.path` (create_repo, commit_repo_files, etc. don't have
one). `queue.html`'s renderer — same feature, same data, different
page — didn't, and would have rendered "undefined" for those items.
Same bug shape as any copy-pasted function: a fix applied to one
copy doesn't reach the other, and nothing forces you to remember
there's a second copy. If this project grows past four static HTML
pages, worth factoring shared rendering (queue items, agent cards,
message bubbles) into one JS file all pages import, instead of
parallel inline `<script>` blocks that drift.

## Anti-pattern: a feature that's coded but never wired to its consumer
**From:** `lib/agents.js` / `api/agents.js` (dynamic agent registry)
**Noted by:** Claude, 2026-09-01

The agent registry was fully built, tested, and merged — but
`api/board.js`'s `GET` handler never actually called `listAgents()`,
so the mission-orbit UI was always showing hardcoded demo agents,
even in the sandbox, even after the registry "shipped." The registry
code was correct; the integration point was just never touched. A
feature isn't done when its own file works — it's done when
whatever's supposed to consume it actually does. Worth a last step
on any backend addition: grep for where the old/demo data is coming
from now, and confirm the new code actually replaced it, not just
sat next to it.

## Worth copying: shared helpers used by every caller, not duplicated per endpoint
**From:** `lib/queue.js`'s `approveQueueItem`/`rejectQueueItem`
**Noted by:** Claude, 2026-09-01

The dashboard (`api/queue.js`) and the SMS webhook
(`api/sms-webhook.js`) both need to approve/reject a queue item
identically. Rather than each endpoint having its own copy of the
execute-then-remove logic, both call the same two functions in
`lib/queue.js`. Means there's exactly one place that defines what
"approve" does, and a new caller (a future Slack integration, say)
gets correct behavior for free instead of a third copy to keep in
sync.
