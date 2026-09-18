// /lib/nex/tools/agentTools.js
// Slice 14 (final slice) of the nexBrain.js TOOLS-array extraction: the
// last 7 schemas that sat inline at the tail of the array — rolling
// agent-log tools, model delegation, the Code Vault pair, client-site
// launch, and the tappable-question tool. Pure move — schemas only,
// verbatim from nexBrain.js, no behavior change. Dispatch logic stays
// in nexBrain.js; this file only holds the tool schema declarations.
// These 7 were contiguous in the original array (no other tool-group
// spread interleaved), so they move together as one exported group and
// spread back in at their exact original position.

export const AGENT_TOOLS = [
  {
    name: 'log_exchange',
    description: "Manually add a summary to an agent's lightweight rolling context log. Normal Nex exchanges are logged automatically by the backend after the substantive reply is complete, so do not call this as routine bookkeeping or treat it as task completion. Use it only when Mr. Lopez explicitly asks to record or repair a particular exchange summary.",
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Whose conversation this is — use "nex" for your own exchange with Mr. Lopez.' },
        summary: { type: 'string', description: 'A short, standalone summary of what just happened in this exchange — what he asked, what you did or decided, and the real state it left things in.' },
      },
      required: ['agent', 'summary'],
    },
  },
  {
    name: 'check_agent_log',
    description: 'Read back the current rolling exchange log for a given agent conversation (nex/claude/chatgpt) — e.g. when Mr. Lopez says "check what me and Chat were doing." Returns the last few logged exchanges, wrapped as untrusted context like Hyperfocus. Executes immediately.',
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Which agent\'s log to check — "nex", "claude", or "chatgpt".' },
      },
      required: ['agent'],
    },
  },
  {
    name: 'delegate_to_model',
    description: "Send a single, self-contained prompt to a SPECIFIC named model — e.g. Gemini or Llama — through the same Vercel AI Gateway already used as the OpenAI fallback, and get its real text reply back. Use this for genuine delegation Mr. Lopez has asked for (\"have Llama look at this\", \"ask Gemini to summarize this file\") or clear cheap grunt work worth offloading (bulk tagging, sorting, digging through a large file) rather than burning your own turn on it. This is a REAL separate model answering — always attribute its output to that model by name when relaying it to Mr. Lopez, never present it as your own reasoning. This is NOT free just because the underlying provider has a free tier — whether it actually costs anything depends on Vercel account billing/BYOK configuration you cannot see or control, so never tell Mr. Lopez a delegated call was free; if asked, say you cannot confirm the cost from here. No tool call/board/approval queue integration — a one-shot answer, not a sub-agent with its own tools.",
    input_schema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'The model to delegate to, in "creator/model-name" format, e.g. "google/gemini-2.5-flash", "meta/llama-3.3-70b-instruct", "openai/gpt-5.6-sol". Get the exact current name from Mr. Lopez if unsure — do not guess an outdated one.' },
        prompt: { type: 'string', description: 'The complete, self-contained prompt for that model — it has no memory, tools, or context beyond exactly what you put here.' },
        max_tokens: { type: 'number', description: 'Max tokens for the reply. Defaults to 2048. Keep it modest for grunt work.' },
      },
      required: ['model', 'prompt'],
    },
  },
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
  {
    name: 'launch_client_project',
    description: "Launch a real, full-stack client site — not a single-page demo. Provisions a dedicated Postgres database, creates a dedicated private GitHub repo, links it to its own Vercel project with the database wired in as DATABASE_URL, and commits the site's files. Use this once a site is ready to actually go live for a real client (as opposed to a Forge sales preview, which stays a demo on purpose). If no NEON_API_KEY is configured, the database step is skipped and this still launches everything else — check the returned database.provisioned field and tell Mr. Lopez if it came back false.",
    input_schema: {
      type: 'object',
      properties: {
        clientName: { type: 'string', description: 'The client/business name — used to slug the repo and database.' },
        files: {
          type: 'array',
          description: 'The site\'s files. A single index.html is fine today; this also accepts real multi-file backend code once you\'re generating it.',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
        },
        description: { type: 'string', description: 'Optional short repo description.' },
      },
      required: ['clientName', 'files'],
    },
  },
  {
    name: 'ask_user_question',
    description: "Offer Mr. Lopez tappable options instead of making him type — mid-task or at the end of a normal reply. Every option is exactly its label text; tapping one sends that exact text as the next message, same as if he'd typed it — there's no other kind of button to invent, just good short labels for whatever the moment calls for. Two modes, controlled by `blocking`: blocking (default true) actually PAUSES and waits for his real answer before you continue — use this only for a genuine fork you're prepared to act differently on (a naming/style choice, whether to also do an adjacent thing, which of two approaches to take). blocking:false does NOT pause — use it to decorate the end of a complete, normal answer with quick-tap shortcuts for likely next things he'd say, the same way you'd finish speaking and just happen to offer a couple of options; he can tap one or ignore them and type or say something else entirely. Keep it to one question and 2-4 short options either way — this is for real forks and genuinely likely next steps, not a way to avoid making a reasonable default yourself.",
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The actual question, or (for blocking:false) a short lead-in to the options — short and specific either way.' },
        options: {
          type: 'array',
          description: '2-4 short, tappable option labels. Mr. Lopez can also just type a free-text answer instead of tapping one.',
          items: { type: 'string' },
        },
        blocking: { type: 'boolean', description: 'true (default): pause and wait for his real answer before continuing. false: non-blocking quick-reply shortcuts alongside your normal complete answer.' },
      },
      required: ['question', 'options'],
    },
  },
];
