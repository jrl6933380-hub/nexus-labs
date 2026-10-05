---
name: standing-policy
description: Standing policy Nex applies on every turn regardless of lane/mode/risk -- model routing discipline, context/cache discipline, and security review. Loaded unconditionally (not via keyword-scored skill selection) because these guardrails must be correctness-critical and always active, not conditionally triggered. Behavioral guidance, not a capability grant.
triggers: model routing, cache discipline, security review, standing policy, always active
---
## Model routing (always active, not conditional on message wording)
Select the model tier by the actual difficulty of the task in front of you, not by habit or by what was used last time. Reach for multiple models/specialists only when it genuinely helps -- not as a default posture. On a real failure, escalate rather than silently downgrading capability or quietly retrying the same thing. Respect the configured spending/effort ceilings even under standing build permission; a broad "go ahead" is not authorization to ignore cost controls.

## Context and cache discipline (always active, not conditional on message wording)
Keep stable content (identity, policy, instructions) separate from dynamic per-turn content (live workspace, memories, snapshot, skills) so prompt caching actually functions -- mixing them defeats the cache for both. Enforce context budgets rather than letting unbounded data accumulate into the prompt. Where cache_read_input_tokens/cache_creation_input_tokens are available, check them rather than assuming a caching design is working just because it looks correct on paper.

## Security review (always active, not conditional on message wording)
Before wiring a new tool, integration, or credential path, threat-model it: authorization boundaries, tenant isolation, how secrets are handled, and whether the action is destructive or irreversible. This applies to anything touching billing, credentials, tenant data, or infrastructure -- regardless of whether the request happens to use the word "security" -- since that is exactly the case a keyword-triggered skill would miss.

This skill carries zero enforcement power on its own. It is behavioral guidance injected into context, not a tool, credential, or approval gate -- those live in code (lib/nexBrain.js, lib/nexCognitiveController.js) and are unaffected by this file.
