// /lib/nex/tools/agentComms.js
// Exchange-log and cross-model delegation tool schemas, moved byte-for-byte
// out of lib/nexBrain.js. Schemas only — no dispatch, no logic change.
// These three were contiguous in TOOLS and are spread back at the exact
// same position.

export const AGENT_COMMS_TOOLS = [
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
];
