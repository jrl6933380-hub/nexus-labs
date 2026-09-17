// /lib/nex/tools/agentMisc.js
// Slice 13 of the nexBrain.js TOOLS-array extraction: three small,
// non-contiguous inline schemas that each sit at a different point in
// the original TOOLS array, separated by other tool-group spreads
// (MEMORY_TOOLS.../HYPERFOCUS_TOOLS.../HANDOFF_TOOLS.../ROOMS_TOOLS...).
// Pure move — schemas only, verbatim from nexBrain.js, no behavior
// change. Dispatch logic stays in nexBrain.js; these files only hold
// the tool schema declarations. Split into three exported groups
// (rather than one) so spreading them back in at their exact original
// positions preserves the original array order exactly — same
// discipline documented in systemOps.js and vercel.js.

export const STORY_ACTOR_TOOLS = [
  {
    name: 'direct_story_actor',
    description: "Direct one intelligent character actor inside the operator's currently open Story Studio comic. The actor interprets Nex's note through its own personality, objective, instincts, voice, movement style, emotions, and relationships, then updates its scene performance and actor-owned bubble. Use this when Justin asks Nex to move, pose, emote, speak through, or otherwise direct a comic character. Signed-in ownership and the active Story Studio project are enforced server-side.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type:'string', description:'Story Studio project id. Omit when the active project is already identified in live workspace context.' },
        panel_index: { type:'number', description:'Zero-based panel index to direct.' },
        actor: { type:'string', description:'Character actor id or exact character name.' },
        direction: { type:'string', description:'Nex direction covering movement, pose, emotion, dialogue, bubble behavior, or camera intent.' },
        at_ms: { type:'number', description:'Optional moment in the scene timeline, in milliseconds.' },
      },
      required: ['panel_index', 'actor', 'direction'],
    },
  },
];

export const WAKE_CLAUDE_TOOLS = [
  {
    name: 'wake_claude_code',
    description: "Wake a real Claude Code session to pick up and work on something — fires the actual Claude Routine wake mechanism (proven end-to-end in epic task 03), not just a board task nobody comes to work on. This starts a real, billed Claude session, so ONLY call this when Mr. Lopez has explicitly asked you to wake, bring in, or get Claude on something right now — never propose or call this on your own initiative, and never chain it automatically off of some other action. If it's not clear he means right now, ask him first instead of calling this.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the board task this creates, e.g. "Finish the room-timeout test with Justin and ChatGPT".' },
        description: { type: 'string', description: "Real context for the woken Claude session: what's being worked on, what still needs finishing, and anything relevant from this conversation (repo/branch, what's already been tried, what to check first). Write it so a Claude session with no other context can actually pick up the work correctly." },
      },
      required: ['title', 'description'],
    },
  },
];

export const HYPERFOCUS_LIST_TOOLS = [
  {
    name: 'list_active_hyperfocus',
    description: "List every currently active Hyperfocus focus (title, participants, status) — use this when Mr. Lopez asks to see active hyperfocus, or when you need to find the right focus_id for this conversation before appending to or closing one and you don't already know it. Executes immediately.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];
