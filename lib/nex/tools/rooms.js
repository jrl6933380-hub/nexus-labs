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
    description: 'Render a self-contained HTML visual in the persistent pinned panel for a Nexus room. Use this for diagrams, plans, dashboards, previews, interactive widgets, or other visual explanations that should remain visible while Mr. Lopez keeps working. Include all CSS and JavaScript inside widget_code and never include secrets. If the room panel is locked, the visual is saved to its five-item history without replacing the active visual.',
    input_schema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'Stable room slug such as command-center, conference-room, or room-builder.' },
        widget_code: { type: 'string', description: 'Self-contained HTML fragment or document with inline CSS and optional JavaScript.' },
        source: { type: 'string', description: 'Short label describing what produced the visual. Defaults to nex.' },
      },
      required: ['room_id', 'widget_code'],
    },
  },
];
