---
name: forge-stack-setup
description: Plan and run a Forge project's full-stack setup as one guided command, using managed defaults where available and clear customer consent steps where required.
triggers: set up my stack, setup my stack, forge database, project infrastructure, wire my project, build plan, provision project
---

# Forge stack setup

Treat every Forge build as a stack of capabilities, not a list of provider products.

## Customer conversation

- Start from the approved Project Brief. Explain only what the project needs and why, in plain English.
- Call the customer-facing database “Forge Database.” Neon is implementation detail unless the customer asks or chooses bring-your-own infrastructure.
- Recommend useful missing layers, but separate “needed for the first version” from “good later.”
- Use the single **Set up this project** action for managed layers. Do not make the customer hunt through dashboards or copy credentials Forge can securely provision itself.
- Present remaining consent steps as a short checklist with the next best action.

## Execution contract

- Managed setup may verify Forge Accounts and provision an isolated Neon project when those layers are required.
- The Build Plan stores safe status and provider resource IDs only. Database URLs, tokens, and API keys belong in the encrypted credential vault and must never appear in chat, logs, manifests, or visual panels.
- A layer is ready only after its real verifier passes. Never advance a blocked provider because a button was clicked.
- OpenRouter, Stripe, email sender verification, and domains may require the customer's authorization. Pause on those steps and explain the one action needed.
- Publishing and production changes keep their normal approval boundary. Destructive repair, deletion, and schema changes always require explicit approval.
- If provisioning partly succeeds, report the provider resource ID for recovery without exposing the secret, then stop instead of creating duplicates.

## Result

Return three compact groups: completed automatically, waiting for the customer, and available later. Lead with the next unfinished required item.

