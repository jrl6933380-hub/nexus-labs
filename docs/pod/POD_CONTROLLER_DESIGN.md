# Pod Controller — Design (for review, not built yet)

Owner: Claude · Board card: Pod Controller — self-hosted Nex on RunPod

## What it is

A small server-side module that runs Justin's RunPod pod like a switch Forge controls: on for working hours, off otherwise, with OpenRouter catching everything the pod can't. Built on RunPod's API. Nothing customer-facing ever depends on the pod being up.

## Who gets the pod

- **Callers** during calling hours (speed matters on live calls — no cold starts).
- **Hand-picked Forge users** flagged by the owner.
- **Everyone else → OpenRouter**, same as today.

Routing is a per-account flag the owner sets in the operator panel. Default is off.

## Routing rule (every model call)

```
if account.podEnabled AND pod.status == READY AND pod.healthy:
    send to pod (nex-base / nex)
else:
    send to OpenRouter (current behavior)

if the pod call errors or times out:
    retry once on OpenRouter — the user never sees the failure
```

## Controls

| Control | Behavior |
|---|---|
| Schedule | Auto-start before calling hours, auto-stop after. Times set in operator panel (Central time). |
| Idle stop | No pod traffic for N minutes (default 45) → stop. |
| Wake on demand | Enabled user hits Nex while pod is off → start it, serve from OpenRouter while it boots. |
| Daily spend cap | Hard stop when today's pod hours × rate passes the cap (default $25/day). Owner can raise it. |
| Health check | Ping `/v1/models` every few minutes; unhealthy → route to OpenRouter and alert. |
| Operator panel | Status, hours today, spend today, start/stop buttons, schedule, cap, user flags. |

## Permissions

- Nex **may** start and stop the existing pod.
- Nex **may not** create new pods, change GPU type, or scale up without Justin's approval (same rule as merges).
- Customers have no pod controls at all.

## Secrets (Vercel env, sensitive)

- `RUNPOD_API_KEY` — for start/stop/status.
- `NEX_POD_KEY` — the key vLLM requires on every request.
- `NEX_POD_ID` — which pod to control.

Never in code, chat, or the board.

## Build plan (Phase 2, separate PR after this is approved)

1. `lib/podController.js` — RunPod API wrapper: status, start, stop, health, spend tracking.
2. Routing hook in the model-call path: pod-first for flagged accounts, OpenRouter fallback.
3. Scheduler + idle-stop + spend cap (cron route).
4. Operator panel view (owner-gated only — never on Forge customer surfaces).
5. Tests: fallback when pod is down, cap enforcement, customers can't reach pod controls, key never logged.

## Later (Phase 3)

Swap `nex-base` for the fine-tuned Nex on the same endpoint. No routing changes needed.

## Open questions for Justin

1. Calling hours to schedule around (e.g. 8am–6pm Central?).
2. Daily spend cap — is $25 right?
3. Which accounts get the pod first (callers + who else)?
