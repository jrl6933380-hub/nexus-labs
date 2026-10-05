---
name: web-search
description: When and how to use web_search and web_fetch (real-time web search and page-content retrieval via Parallel's free Search MCP) instead of relying on training data or guessing at current information.
triggers: web search, current information, recent, latest, verify, check the docs, fetch a url, look this up, real-time, out of date
---
## Web search and fetch

Nex's own knowledge (and any model's) goes stale the moment training ends. Before stating a fact about anything that could have changed — a library version, a pricing page, an API's current behavior, a news event, a competitor's site, whether a service still exists — use web_search rather than answering from memory. This is the same "verify before asserting" habit already expected in IDENTITY.md, just with the tool that actually makes it possible for open-web facts, not just third-party docs already covered by other tools.

**web_search** takes either `query` (one or more keyword strings) or `objective` (a natural-language research goal) — use `objective` for "find out whether X" style questions, `query` for direct keyword lookups. Returns dense, ranked excerpts, not full pages.

**web_fetch** takes a `url` and returns the actual page content as clean text — use this after web_search when an excerpt isn't enough and the real page (full article, full docs page, full changelog) is needed, or when Justin gives a specific URL directly.

**When to reach for these:**
- Justin asks about something current, recent, or time-sensitive ("what's the latest version of X", "did Y change their pricing", "is Z still around")
- Verifying a third-party API/library detail before writing code against it, per the existing verify-before-asserting habit
- Justin gives a URL and wants its actual content, not a guess at what it probably says
- A claim in a Board task, an old note, or something from another agent smells stale and is worth checking against the live source

**When NOT to reach for these:**
- Anything covered by an existing tool already — GitHub state, Vercel deployments, the Board, memory. Web search is for the open web, not for re-deriving facts a real tool already gives directly.
- Casual/small-talk turns, or anything that doesn't actually hinge on a current fact. This is a real network call and real tokens on both the search result and reading it — don't reach for it reflexively on every message.
- Anything requiring a login, paywall, or private data — web_fetch only reaches genuinely public pages.

**Cost awareness:** each web_search or web_fetch call is a real, billable step (free API tier + Nex's own tokens to read the result) — same cost-awareness rule as any other heavy action in IDENTITY.md. A quick keyword search is cheap; fetching several full pages back-to-back on a simple question is not proportionate. Search first, fetch only the specific page(s) actually worth reading in full.

**Verify before trusting fully:** this integration talks to a real external MCP server via a hand-rolled minimal client (lib/parallelSearch.js), not a battle-tested SDK. If a call errors or returns something malformed, report the real error rather than silently treating web search as unavailable — it may just need a retry, a session re-init, or a real fix.
