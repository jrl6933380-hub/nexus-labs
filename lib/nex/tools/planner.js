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
        end_reminder: { type: 'boolean', description: 'Opt-in in-app reminder when the planned block duration is up. Requires ends_at; this is a planning cue, not a hard deadline.' },
        project_id: { type: 'string', description: 'Optional Workbench project id when this time supports a project path.' },
      },
      required: ['title', 'starts_at'],
    },
  },
  {
    name: 'update_planner_item',
    description: 'Update an existing Nexus Schedule item, including rescheduling, categorizing, protecting, repeating, or marking it done. For a running-over block, read the schedule, extend its planned duration as requested, and propose shifts to later flexible blocks. Ask for approval before applying those shifts; disclose unresolved conflicts. Never move a protected or fixed block without explicit approval.',
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
        end_reminder: { type: 'boolean', description: 'Opt-in in-app reminder when the planned block duration is up. Requires ends_at; this is a planning cue, not a hard deadline.' },
        project_id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'adjust_schedule_overrun',
    description: 'Preview an extension to a running-over Schedule block and reflow later flexible activities. Fixed/protected blocks stay put. Default preview is read-only: show the proposed changes and unresolved conflicts, then obtain approval. Apply with the same ends_at/day_end and returned baseline only after approval. If conflicts remain, scope a resolution with the user; do not apply automatically. Duration is a planning guide, not a hard finish deadline.',
    input_schema: {
      type: 'object',
      properties: {
        id: {type:'string'},
        ends_at: {type:'string',description:'New planned end as ISO date/time, at most 12 hours beyond the previous planned end.'},
        day_end: {type:'string',description:'Local midnight following the affected schedule day, as ISO with timezone. Limits flexible shifts to this day.'},
        apply: {type:'boolean',description:'False or omitted for preview. True only after the user approves the shown changes.'},
        baseline: {type:'string',description:'Exact baseline returned by the approved preview; required when apply is true.'},
      },
      required: ['id','ends_at','day_end'],
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
