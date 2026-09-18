export const ROOMS_TOOLS = [
  {
    name: 'list_rooms',
    description: "List the rooms currently available in Nexus. Use this when Mr. Lopez asks what rooms exist or when you need the exact room name before opening one. Executes immediately.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'open_room',
    description: "Look up a Nexus room and return its safe in-app URL. Use this when Mr. Lopez says to bring up, open, or go to a named room (for example, 'bring up the conference room'). Never invent a URL: resolve the room first and then give him the returned link. Executes immediately.",
    input_schema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room name or slug, such as "conference room" or "conference-room".' },
      },
      required: ['room'],
    },
  },
  {
    name: 'render_visual',
    description: 'Render a self-contained HTML visual into the persistent Nexus workspace. Use command-center for the universal Thoughtspace surface unless Mr. Lopez explicitly names another room. Use this whenever he asks to show, map, break down, inspect visually, diagram, plan, preview, or create an interactive working view. The visual should replace the workspace content rather than navigating him into a static control page. Include all CSS and JavaScript inside widget_code and never include secrets. If the visual is locked, save the new render to its five-item history without replacing the active view.',
    input_schema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'Stable room slug. Default to command-center for the universal Thoughtspace workspace; use another slug only when the user explicitly names that room.' },
        widget_code: { type: 'string', description: 'Self-contained HTML fragment or document with inline CSS and optional JavaScript.' },
        source: { type: 'string', description: 'Short label describing what produced the visual. Defaults to nex.' },
      },
      required: ['room_id', 'widget_code'],
    },
  },
];
