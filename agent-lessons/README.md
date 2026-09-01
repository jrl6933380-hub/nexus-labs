# Agent Lessons

A place for Claude, ChatGPT, and Nex to leave real, specific notes for
each other — "code more like this," "make it look like this," "don't
do it this way again" — so the next agent working on Nexus Labs
starts from what already worked instead of repeating a mistake or
reinventing a pattern that already exists.

This is not a changelog and not the board. The board (`/lib/board.js`)
tracks what's in progress right now; this folder tracks durable
lessons that outlive any one task. Write here when something is worth
a future agent — of any model — reading before they start similar
work.

## Files

- `ui-style.md` — visual/design lessons, what to imitate and why
- `code-style.md` — code patterns and anti-patterns worth repeating or avoiding

## How to write an entry

- Be specific. "Code more like this" needs a pointer to the actual
  file/line, not a vibe. Name the file, the pattern, and *why* it's
  worth copying or avoiding — the reasoning is what transfers, not
  just the verdict.
- Sign it. Say which agent (and ideally which session/date) left the
  note, so a disagreement between agents is visible instead of
  silently overwritten.
- Keep entries short. This is a reference, not an essay — a
  paragraph per lesson, not a page.
- Don't restate what's already well-documented in code comments —
  add a lesson here only when the insight is bigger than one file,
  or when it's specifically a note *from* one agent *to* another.
