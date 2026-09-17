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
];
