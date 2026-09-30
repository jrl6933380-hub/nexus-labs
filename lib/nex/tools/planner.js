// Built-in Nex Chat planner tools. These affect only the user's private Nexus
// planner; they do not touch an external calendar or create a Nexus Life item.

export const PLANNER_TOOLS = [
  {
    name: 'read_planner',
    description: 'Read the built-in Nex Chat planner, optionally limited to a date range or status. Use this when discussing the user\'s day, week, schedule, appointments, reminders, or upcoming plans. Executes immediately.',
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
    description: 'Add an event, appointment, reminder, or scheduled task to the built-in Nex Chat planner. This changes the private planner immediately; it does not write to an external calendar.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        starts_at: { type: 'string', description: 'ISO date/time with a timezone whenever possible.' },
        ends_at: { type: 'string', description: 'Optional ISO date/time.' },
        all_day: { type: 'boolean' },
        notes: { type: 'string' },
      },
      required: ['title', 'starts_at'],
    },
  },
  {
    name: 'update_planner_item',
    description: 'Update an existing built-in Nex Chat planner item, including rescheduling it or marking it done. Executes immediately.',
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
