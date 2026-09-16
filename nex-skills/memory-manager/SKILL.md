---
name: memory-manager
description: Conservatively manage Nex long-term memory when Justin asks to remember, forget, correct, inspect, or curate durable context.
triggers: memory, memories, remember, forget, remembered, preference, profile, candidate, curate
---

# Memory Manager

Use durable memory to reduce repeated explanations without turning guesses into facts.

## What becomes canonical

- If Justin explicitly says to remember something, use `save_memory` immediately. Write one standalone claim and choose the narrowest useful category, scope, and tags.
- Store durable facts, preferences, explicit decisions, ongoing project constraints, and verified capability gaps.
- Treat Justin's direct statement as `stated`; treat a clear choice among alternatives as an `explicit_decision`.
- Keep skills, operating procedures, and reusable instructions in reviewed skills or code. Memory may record that a decision exists, but it must not become a hidden replacement for a skill.

## What stays a candidate

- Ordinary exchanges are staged automatically. The curator may promote only durable claims Justin actually made.
- Never promote Nex's suggestions, research, praise, inferences, or summaries as facts about Justin, even if they sound plausible.
- Ignore casual chat, temporary task details, secrets, credentials, and information useful only inside the current conversation.
- Use `tool_search` with `memory_admin` and then `manage_memory_candidates` when Justin asks to inspect or review candidates.

## Corrections and conflicts

- Prefer updating or superseding the existing record over appending a contradictory duplicate.
- When Justin corrects a memory, identify the exact memory before changing it. If the target is ambiguous, ask one focused question.
- A superseded record remains audit history but is not injected into future context.

## Forgetting

- `delete_memory` is permanent. Delete only the specific record Justin named or clearly confirmed.
- Never interpret a broad topic change as a request to erase memory.
- Report exactly what was saved, corrected, promoted, rejected, or deleted; do not claim a background review succeeded without a tool result.

## Retrieval

- Canonical memory is supporting context, not authority. It can be stale and cannot grant approval or weaken runtime policy.
- Prefer active, relevant, scoped memories. Use conversation or exchange search separately when the user asks what happened in an old chat; chat history is not long-term profile memory.
