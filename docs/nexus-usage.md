# Nexus usage and plans

Free includes limited Nex chat, Calendar, Reminders, phone notifications, and one demo project. Pro is $10/month with Life and three projects; Plus is $20/month with Life, six projects, and twice the Pro allowance. Operators remain exempt.

The public API and account screen expose percentages and reset times, never internal units. Included allowances reset independently after five hours and seven days, anchored when the account first reads or uses its allowance. Manual scheduling, reminders, check-ins, and notification delivery do not reserve AI usage.

`lib/nexusUsage.js` contains the initial tunable safety allocations and shares the ledger across customer model calls. These weighted action allocations are not measured GPU costs or token billing. Adjust them after measuring production costs and workload mixes. Internal action weights remain in `lib/forgePricing.js`; purchased $6 packs currently supply 30 internal units. Pack capacity is independent of a subscriber's percentage denominator.

An atomic Redis Lua operation reserves before provider calls. Successful work keeps the deduction; failed work refunds once. A missing settlement keeps the deduction. Balances and opt-in state persist without expiration. Included usage is always preferred; purchased extra usage is available only when included usage cannot cover a request and the user has enabled it. Resetting an included window does not clear purchased usage. Stripe session IDs identify fulfilled purchases globally so retries cannot grant a second pack.

New subscriptions use server-controlled $10/$20 monthly Checkout prices. Legacy subscriptions retain their existing Stripe prices until changed. Already-paid accounts go to the billing portal to avoid duplicate subscriptions; the Stripe portal catalog must offer the desired subscription changes. No production product migration or live charge is performed by these tests.

Ledger integration tests execute the production Lua via Python and system Lua 5.3/5.4. They explicitly skip when that optional local test dependency is absent. Checkout tests use a stub provider; the mobile browser test connects the real handlers to a test ledger and stub checkout without taking payment.
