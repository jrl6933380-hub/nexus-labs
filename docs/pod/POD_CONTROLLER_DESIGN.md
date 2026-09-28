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

## Pod Room (owner-only room in the Nexus)

Justin's call: the pod is **manual-first**. He turns it on and off whenever he wants; the schedule and automations are helpers, never the boss. Everything lives in one owner-gated room in the Nexus (never on Forge customer surfaces).

### Power
- **On / Off / Restart** buttons — work anytime, regardless of schedule.
- **Keep on until…** — manual override that holds the pod on past the schedule or idle timer (e.g. "until 11pm").
- **Emergency kill** — stops the pod immediately and routes everyone to OpenRouter.
- **Auto-on toggle for the schedule** — schedule can be switched off entirely so the pod only runs when Justin flips it.

### Calling hours
- Per-day editor (Mon–Sun, start/end, Central time), with day-off toggles.
- Pod warms up a set number of minutes **before** calling hours start so callers never hit a cold boot.
- "Calling now" indicator for the caller team.

### Live status
- State: off / booting / loading model / ready / unhealthy.
- GPU utilization + memory, active requests, requests today.
- Uptime this session, and a health check result (last ping, latency).

### Money
- Spend this session, today, this month.
- RunPod balance remaining.
- Daily spend cap (editable) + idle-stop timer (editable).

### Who uses it
- Toggle per account: callers, picked Forge users.
- One switch: "send everyone to OpenRouter" (pod stays on, nobody routed).

### Model
- Shows the model currently served.
- Switch between models already on the volume (base → fine-tuned Nex later) with a restart.
- Quick test chat box to talk to the pod model directly.

### Activity log
- Every start, stop, restart, schedule change, cap hit, and fallback — who did it (Justin / schedule / idle timer / Nex) and when.

### Needs Justin's approval (button creates a request, never auto-runs)
- New pod, different GPU type, second pod for scaling, deleting a pod or the volume.

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
4. Pod Room in the Nexus (owner-gated only — never on Forge customer surfaces), per the Pod Room section above. Manual controls ship first, then schedule, then automations.
5. Tests: fallback when pod is down, cap enforcement, customers can't reach pod controls, key never logged.

## Later (Phase 3)

Swap `nex-base` for the fine-tuned Nex on the same endpoint. No routing changes needed.

## Open questions for Justin

1. ~~Calling hours~~ → answered: set from the Pod Room, editable anytime; manual on/off always wins.
2. Daily spend cap — is $25 right?
3. Which accounts get the pod first (callers + who else)?
