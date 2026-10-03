// Shared Schedule tools for Nex Chat and Nexus Life. These affect only the
// signed-in account's private Nexus schedule; they do not touch an external
// calendar. Read first, protect fixed blocks, and disclose conflicts.

export const PLANNER_TOOLS = [
  {
    name: 'read_planner',
    description: 'Read the private Nexus Schedule, optionally limited to a date range or status. Always read it before arranging or rebalancing time so existing commitments, protected blocks, flexible time, and conflicts are respected. For a whole-day or whole-week review, use render_visual in the planner room when a time-split, capacity, or before/after chart would make the tradeoffs clearer.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Optional inclusive ISO date/time lower bound.' },
        to: { type: 'string', description: 'Optional exclusive ISO date/time upper bound.' },
        status: { type: 'string', enum: ['planned', 'done', 'cancelled'] },
      },
    },
  },
  {
    name: 'create_planner_item',
    description: 'Add one approved event, task, reminder, or time block to the private Nexus Schedule. This changes the schedule immediately, so summarize a multi-item plan and get approval before creating several blocks. It does not write to an external calendar.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        starts_at: { type: 'string', description: 'ISO date/time with a timezone whenever possible.' },
        ends_at: { type: 'string', description: 'Optional ISO date/time.' },
        all_day: { type: 'boolean' },
        notes: { type: 'string' },
        category: { type: 'string', enum: ['work', 'project', 'gym', 'health', 'family', 'social', 'appointment', 'errands', 'learning', 'creative', 'rest', 'travel', 'other'] },
        kind: { type: 'string', enum: ['event', 'task', 'reminder', 'time_block'] },
        flexibility: { type: 'string', enum: ['fixed', 'flexible'] },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        repeat_mode: { type: 'string', enum: ['none', 'every_week', 'ask_weekly'] },
        protected: { type: 'boolean' },
        reminder_minutes: { type: 'integer', minimum: 0, maximum: 10080 },
        project_id: { type: 'string', description: 'Optional Workbench project id when this time supports a project path.' },
      },
      required: ['title', 'starts_at'],
    },
  },
  {
    name: 'update_planner_item',
    description: 'Update an existing Nexus Schedule item, including rescheduling, categorizing, protecting, repeating, or marking it done. Never move a protected or fixed block without explicit approval.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        starts_at: { type: 'string' },
        ends_at: { type: 'string' },
        all_day: { type: 'boolean' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['planned', 'done', 'cancelled'] },
        category: { type: 'string', enum: ['work', 'project', 'gym', 'health', 'family', 'social', 'appointment', 'errands', 'learning', 'creative', 'rest', 'travel', 'other'] },
        kind: { type: 'string', enum: ['event', 'task', 'reminder', 'time_block'] },
        flexibility: { type: 'string', enum: ['fixed', 'flexible'] },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        repeat_mode: { type: 'string', enum: ['none', 'every_week', 'ask_weekly'] },
        protected: { type: 'boolean' },
        reminder_minutes: { type: 'integer', minimum: 0, maximum: 10080 },
        project_id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_planner_item',
    description: 'Permanently remove one item from the built-in Nex Chat planner. Use only when the user has clearly asked to delete that specific item. This never affects an external calendar.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];
