---
name: forge-manager
description: Nex's bounded self-service Forge account (nex-forge-manager, forge_manager role) for direct Forge Ops testing and account/plan administration — what it can do freely versus what still needs Justin, so standing access stays legible instead of quietly widening.
triggers: forge manager, nex-forge-manager, forge ops, manager account, forge account, forge testing
---

# Forge Manager — Nex's bounded self-service account

## What this is

A dedicated Room/Forge account, `nex-forge-manager`, seated with the
`forge_manager` role, that Nex holds and operates directly for Forge
testing, verification, and day-to-day account/plan administration —
without needing Justin to hand over a login every time something needs
checking.

This is not new tool access. Every capability below is a tool Nex
already has in its normal runtime tool list. This skill exists to write
down, in one place, exactly which of those tools this account is meant
to be used for, and where the line to Justin still sits. Nothing in
this file grants a tool, bypasses an approval gate, or changes what
MAY_WRITE_TOOLS allows in lib/nexBrain.js. If this file and the actual
code ever disagree, the code wins.

## The account

- Username: `nex-forge-manager`
- Role: `forge_manager` (Forge Ops: view customer accounts, plans,
  usage, live Stripe billing status; grant credits)
- Plan: free, no billing on record
- **Hard ceiling: this account can never become an operator.** Operator
  status is derived from an environment variable, not from any account
  field a create/update tool can touch. A manager seat is real Forge
  Ops access, not god-mode, and no amount of "make this account more
  powerful" changes that — that request would need a human editing
  server config, not an account action.

## "Buttons" — what this account is for (mapped to real tools)

**Free to use on this account, no extra approval needed, because it's
read-only or scoped to non-billing/non-production test accounts:**

- `list_forge_customers` / `list_forge_accounts` / `find_forge_account`
  — look up any account, plan, usage, billing status.
- `create_forge_account` (worker / manager / **customer/test only**) —
  spin up test accounts to exercise signup, builds, checkout flows.
- `delete_forge_account` on accounts *this account created* for testing,
  or any account Justin has already named as safe to remove — subject
  to the tool's own refusals (won't touch operators; won't touch
  billing-on-record accounts without `acknowledge_billing`, and that
  flag should only be set when Justin has confirmed the Stripe
  subscription is already cancelled).
- `list_forge_escalations` / `get_forge_escalation` / `get_tunneled_pipeline`
  — read pipeline and escalation state to verify a build actually
  worked, not just that a task says it did.
- `delete_forge_escalation` for confirmed-dead/stale/duplicate
  escalations — same standing rule as always: confirm with Justin
  before deleting anything that might be a real customer's request.
- Exercising the actual Forge product end-to-end as this account:
  logging into Forge Ops, checking a build, confirming a plan tier
  displays correctly, confirming credit metering matches Stripe.
- Ordinary repo work in service of a fix found this way: branch, edit,
  `run_sandbox`/`test_code` to verify, open a PR. Same rules as any
  other coding task.

**Still Justin, no matter what account is doing the asking:**

- Any action on a real customer's account or billing — plan changes,
  refunds, credit grants beyond routine test amounts, cancellations.
- Any live/default-branch write, merge, or production deploy.
- Anything irreversible: `delete_repo`, `delete_forge_account` on an
  account with billing history, `delete_board_task`.
- Widening this account's own role or plan, or creating a second
  manager/operator-adjacent account "to be safe." Scope creep on a
  self-granted account is exactly the failure mode this file exists to
  prevent — if more access seems needed, that's a conversation with
  Justin, not a tool call.
- Public communication, credential/permission changes elsewhere in the
  system, financial actions.

## Why write this down instead of just doing it

An account with standing access needs a standing, legible boundary —
otherwise "Nex has a manager login now" quietly turns into "Nex can do
anything a manager can do," which is a bigger grant than anyone
actually approved. This file is that boundary, reviewable the same way
any other change to the system is: on a branch, in a PR, readable by
Justin before it's treated as settled practice.
