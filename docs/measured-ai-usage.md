# Measured Nexus AI allowance

Nexus pays for Qwen by pod-hour. This policy allocates that shared capacity; it
is not a claim that the pod charges per token or that tokens precisely measure
GPU time. Calibrate the weights against measured throughput, concurrent load,
and hourly hosting cost before promising task/message counts.

Customers see 5-hour, weekly, and extra-usage percentages. Free retains Calendar,
Reminders, phone notifications and one demo project. Pro retains Life and three
projects; Plus retains six projects and twice Pro's included allowance.

Initial internal capacities remain Free 30/60, Pro 90/300, Plus 180/600 for the
5-hour/weekly windows. Existing balances and reset times are retained. Each $6
pack still adds 30 internal capacity units, carries forward and requires opt-in.
These quantities now represent measured AI work, not fixed action counts.

The initial policy charges one internal unit per 1,000 weighted tokens:
uncached input weight 0.25; reported cached input 0.05; generated output 1.
Reported completion totals include reasoning, so reasoning is not added twice.
The coefficients are maintained in `lib/aiWorkUsage.js`; changing them requires
recalibration and a policy version bump. No dollar-per-token price is advertised.

Before each customer model round, the server estimates a safe context envelope
from UTF-8 text bytes and image allowance, reserves the maximum permitted output,
and caps the inference output request to the remaining included + enabled extra
capacity. Concurrent reservations are checked atomically in Redis. Successful
rounds reconcile to runtime usage. Missing counters use conservative estimates
and are marked estimated in the private ledger. Idle/queue time and manual
Calendar/Reminder/Life operations do not invoke this meter.

Each build continuation is separately reserved and settled before another round
starts. A failed/stalled round is refunded; automatic failed retries are absorbed
by the platform. Prior successful rounds remain charged if a later round fails.
Cancellation retains its reserved envelope if final runtime usage is unavailable.
Settlement is awaited before closing the model stream. Unsettled reservations
stay deducted and are retained for reconciliation rather than silently refunded.
Closing the customer app cannot erase the server ledger.

Included capacity is consumed before packs, including tasks spanning both pools.
Settlement refunds unused extra capacity first. Refunds cannot credit a new
included window. Pack fulfillment remains server-validated and idempotent.
The existing free-tier global safety ceiling is retained. Owner accounts remain
exempt. Customer team execution remains protected by the existing access policy;
this change does not enable owner tools or make new customer agent features live.

Validation uses the production Lua ledger and actual Qwen adapter paths with
mocked runtime/network responses. It does not benchmark the live GPU or verify
production counters. The runtime must supply OpenAI-compatible usage; streaming
requests now ask for final usage packets with `stream_options.include_usage`.
