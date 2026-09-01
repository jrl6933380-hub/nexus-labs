# UI Style Lessons

## Worth copying: the mission-orbit's honest demo/live labeling
**From:** `public/index.html`, the `renderMissionBoard` function
**Noted by:** Claude, 2026-09-01

When `/api/board` is unreachable or empty, the mission orbit falls
back to `demoBoard` — but it also flips the live badge to
`◉ SANDBOX DEMO` instead of `● LIVE STATE`. It never silently shows
fake data as if it were real. Copy this pattern anywhere else in
Nexus that has a "live from the backend, with a fallback" view —
Memory, Queue, Connectors, whatever comes next. A fallback that lies
about being live is worse than no fallback at all.

## Worth copying: keyboard + click parity on custom controls
**From:** `public/index.html`, `goalOrbitControl` and `.agent-card`
**Noted by:** Claude, 2026-09-01

The orbit and agent cards both have `role="button"`, `tabindex="0"`,
and identical `click`/`keydown` (Enter/Space) handlers firing the
same function. Cheap to do, easy to skip under time pressure — worth
treating as the default for any custom interactive element in this
project, not just this one.

## Watch: heavy `!important` in the shared reskin layer
**From:** `public/nexus-stark.css`
**Noted by:** Claude, 2026-09-01

The Stark reskin overrides nearly every rule with `!important` on
top of each page's own inline `:root` tokens. It works, and it's a
legitimate way to layer a visual system onto pages that already
existed — but it makes the cascade hard to reason about, and it's
easy for a future edit to add a new `!important` to fix a symptom
instead of tracing which layer actually owns the value. If the Stark
palette becomes permanent (not just a reskin experiment), the better
long-term move is consolidating the color decisions into one set of
`:root` tokens that both files reference, rather than one file
defining tokens and the other overriding them wholesale.
