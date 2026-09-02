# nexus-labs

## Nex reasoning-provider failover

Nex keeps Anthropic as his primary reasoning provider and can fail over to
Vercel AI Gateway without changing his identity, memory, tools, Board, or
approval rules.

Required for the existing primary route:

- `ANTHROPIC_API_KEY`

Required to enable the independent backup route:

- `AI_GATEWAY_API_KEY`

Optional controls:

- `NEX_GATEWAY_CHEAP_MODEL` (default: `openai/gpt-5.4-nano`)
- `NEX_GATEWAY_STANDARD_MODEL` (default: `openai/gpt-5.6-sol`)
- `NEX_GATEWAY_HEAVY_MODEL` (default: `openai/gpt-5.6-sol`)
- `NEX_GATEWAY_FALLBACK_MODELS` (comma-separated additional Gateway models)
- `NEX_PROVIDER_TIMEOUT_MS` (5,000–90,000; default: 45,000)
- `NEX_FORCE_GATEWAY=true` (controlled failover test; bypasses Anthropic
  without removing its key)

If neither provider can answer, Nex returns a successful safe-mode response
instead of disappearing behind a generic server error. Safe mode never runs
additional model-selected tools; the Board and approval queue remain available
for checking anything already recorded before the outage.

Run the regression suite with:

```sh
node --test
```
