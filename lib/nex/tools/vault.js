// /lib/nex/tools/vault.js
// Code Vault tool schemas, moved byte-for-byte out of lib/nexBrain.js.
// Schemas only — no dispatch, no logic change. These two were contiguous
// in TOOLS and are spread back at the exact same position.

export const VAULT_TOOLS = [
  {
    name: 'search_vault',
    description: "ALWAYS CALL THIS BEFORE generating a new site, dashboard, or component structure from scratch — check whether a proven Blueprint, Module, or Block already exists that fits the request, so you assemble from what's proven instead of reinventing it every time. This is the whole point of the Glass Wing Code Vault: pumping out client sites fast means reusing structure, not regenerating boilerplate each time. Results are ranked by relevance then by lifecycle maturity (proven items rank above experimental ones on a tie). An empty result genuinely means nothing fits yet — that's fine, build it fresh and consider saving it with add_vault_item afterward if it worked well.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you\'re looking for, e.g. "business site with contact form" or "agent status dashboard".' },
        level: { type: 'string', enum: ['blueprint', 'module', 'block'], description: 'Optional — narrow to one level. Omit to search all three.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_vault_item',
    description: "Save something you just built as a reusable Vault item, so future builds can reuse it instead of regenerating from scratch. Use this after a build that genuinely worked well and is likely to come up again — not for one-off, client-specific customization that would never generalize. Saving under a name that already exists in the Vault creates a new VERSION of that item rather than overwriting it — old versions are always preserved, never call this expecting to erase prior history. Be honest about lifecycle_status: 'experimental' for something just tried once, 'tested' once it's been reused successfully, 'proven' only once it has real track record — don't mark something proven on the first use.",
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['blueprint', 'module', 'block'], description: 'Blueprint = complete starting structure. Module = a substantial plug-in capability. Block = a small composable piece.' },
        name: { type: 'string', description: 'A clear, descriptive name, e.g. "Business Site Shell".' },
        purpose: { type: 'string', description: 'What it is and what problem it solves.' },
        when_to_use: { type: 'string', description: 'When an agent should reach for this instead of something else or building from scratch.' },
        source: { type: 'string', description: 'Where the actual, already-proven code lives (a file path, a PR series, a build pattern) — the Vault stores metadata pointing to real code, not a duplicate copy of it.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'A few short keywords to help future search find this.' },
        lifecycle_status: { type: 'string', enum: ['experimental', 'tested', 'proven', 'deprecated'], description: 'Be honest — see the tool description for what each level actually means. Defaults to experimental if omitted.' },
      },
      required: ['level', 'name', 'purpose'],
    },
  },
];
