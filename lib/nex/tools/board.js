// /lib/nex/tools/board.js
// Agent Board tool schemas, split out of lib/nexBrain.js. Pure move: these
// objects are byte-for-byte what TOOLS already contained, and are spread back
// into TOOLS at their original position.
//
// Only the nine CONTIGUOUS board schemas moved here. `delete_board_task` and
// `attach_task_result` are board-related but live elsewhere in TOOLS; moving
// them would reorder the effective tool list, which is not a pure move.
//
// All of these execute immediately by design — board coordination is not a
// write to Mr. Lopez's repos. That behavior lives in the dispatch logic and in
// lib/board.js, not in this schema file.

export const BOARD_TOOLS = [
  {
    name: 'read_board',
    description: "Read the shared Agent Board — every task Claude, GPT, or Nex has created, its status and owner, plus recent messages posted between agents. Check this before creating a task or claiming one, so you don't collide with work already in progress. Executes immediately.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'find_board_task',
    description: "Look up a specific Agent Board task by a title/description keyword (optionally narrowed by status) without paging through the full read_board dump. Use this when you need one task's exact id (e.g. to mark it complete) and read_board's full list is too large or you only remember roughly what it's called. Returns lightweight matches (id/title/status/owner), not full task objects. Executes immediately.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or phrase to match against task title or description, e.g. "progressive tool architecture".' },
        status: { type: 'string', enum: ['idle', 'planning', 'building', 'testing', 'blocked', 'waiting_for_justin', 'complete'], description: 'Optional — narrow to tasks in this exact status.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_board_task',
    description: "Read one Agent Board task in full by id — its complete description and result text, not just title/status/owner. Use this once you have an id (from find_board_task or read_board) and read_board's own dump got cut off before reaching that task's detail. Executes immediately.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The exact task id to read in full.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_board_task',
    description: "Create a new task on the shared Agent Board, visible to Claude, GPT, and Nex. This is real inter-agent coordination, not a change to Mr. Lopez's files or repos, so it executes immediately and does not go through the approval queue. Use this before starting real work another agent might also pick up, so everyone can see it.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title.' },
        description: { type: 'string', description: 'More detail on what the task involves.' },
        owner: { type: 'string', description: 'Who is doing this, e.g. "nex", "claude", "chatgpt". Omit to leave unclaimed.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'claim_board_task',
    description: 'Claim an existing task on the Agent Board as your own, so other agents know not to also start it. Executes immediately.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to claim.' },
        owner: { type: 'string', description: 'Who is claiming it — use "nex".' },
      },
      required: ['id', 'owner'],
    },
  },
  {
    name: 'update_board_task_progress',
    description: 'Update the status and/or leave a short progress note on a task you own on the Agent Board — e.g. moving it from "planning" to "building" or "testing". Executes immediately. Valid statuses: idle, planning, building, testing, blocked, waiting_for_justin, complete.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to update.' },
        status: { type: 'string', enum: ['idle', 'planning', 'building', 'testing', 'blocked', 'waiting_for_justin', 'complete'], description: 'New status. Omit to leave unchanged.' },
        note: { type: 'string', description: 'Short progress note. Omit to leave unchanged.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mark_board_task_blocked',
    description: 'Mark a task you own as blocked on the Agent Board, with a reason — so Claude or Mr. Lopez knows to step in. Executes immediately.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to mark blocked.' },
        reason: { type: 'string', description: 'Why it is blocked.' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'complete_board_task',
    description: 'Mark a task as complete on the Agent Board, optionally attaching a short final result summary. Executes immediately.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to complete.' },
        result: { type: 'string', description: 'A short summary of what was done, shown on the board.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'post_board_message',
    description: 'Post a short message to the shared Agent Board log, visible to Claude, GPT, and Nex — e.g. "about to edit lib/board.js, hold off" — so everyone stays coordinated in real time, not just through task status. Executes immediately, and always posts under your own name ("nex").',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to post.' },
      },
      required: ['message'],
    },
  },
];
