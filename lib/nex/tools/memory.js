// Memory tool schemas for Nex.
// Pure extraction from lib/nexBrain.js — schemas are byte-for-byte identical to
// the originals; no wording, field, or logic changes. Re-spread into TOOLS.

export const MEMORY_TOOLS = [
  {
    name: 'save_memory',
    description:
      "Immediately save a durable fact the user explicitly asked you to remember. Use category \"fact\" for general info/preferences about Mr. Lopez or how Nex should operate, \"project\" for notes tied to a specific client project, or \"for_claude\" specifically when you hit a real capability wall. Ordinary conversation is staged automatically for later conservative review, so do not call this for casual chat or your own suggestions.",
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact to remember, written clearly and standalone (should make sense read alone, out of context).',
        },
        category: {
          type: 'string',
          enum: ['fact', 'project', 'for_claude'],
          description: '"fact" for general info/preferences. "project" for a specific client project. "for_claude" for a capability wall you hit that needs Claude\'s help to fix.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional — 2-5 short topic tags (e.g. ["vercel","billing"]) to help this memory surface later for the right questions. If omitted, tags are auto-derived from the content.',
        },
        scope: {
          type: 'string',
          enum: ['profile', 'preference', 'project', 'topic', 'person', 'system'],
          description: 'The narrowest durable scope for this memory.',
        },
        project: { type: 'string', description: 'Optional project name for project-scoped memory.' },
        topic: { type: 'string', description: 'Optional topic name for topic-scoped memory.' },
        provenance: {
          type: 'string',
          enum: ['stated', 'explicit_decision', 'observed_result'],
          description: 'Why this is trustworthy: directly stated, explicitly decided, or verified from a real result.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'update_memory',
    description: "Edit one of your own existing memories by id — correct something inaccurate, or update it as things change. List what you remember by checking your own memory context above; you'll need the exact id, which isn't shown there — ask Mr. Lopez to check the memory dashboard if you don't already know it from earlier in this conversation.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the memory to update.' },
        content: { type: 'string', description: 'New content. Omit to leave unchanged.' },
        category: { type: 'string', enum: ['fact', 'project', 'for_claude'], description: 'New category. Omit to leave unchanged.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags. Omit to leave unchanged.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_memory',
    description: 'Permanently delete one of your own memories by id. Use this to remove something incorrect, resolved, or no longer relevant.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the memory to delete.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'manage_memory_candidates',
    description: 'Inspect or review Nex memory candidates. Use list to see pending candidates, curate to run the conservative curator now, promote only when the user confirms a candidate is durable, and reject to discard one. Candidate review never treats Nex\'s own suggestions as facts about the user.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'curate', 'promote', 'reject'] },
        id: { type: 'string', description: 'Candidate id; required for promote or reject.' },
        content: { type: 'string', description: 'Optional corrected standalone memory text when promoting.' },
        category: { type: 'string', enum: ['fact', 'project'], description: 'Optional category when promoting.' },
        scope: { type: 'string', enum: ['profile', 'preference', 'project', 'topic', 'person'], description: 'Optional scope when promoting.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional topic tags when promoting.' },
      },
      required: ['action'],
    },
  },
];

export default MEMORY_TOOLS;
