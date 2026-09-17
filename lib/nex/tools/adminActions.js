// /lib/nex/tools/adminActions.js
// Schemas only — extracted verbatim from lib/nexBrain.js's inline TOOLS
// array (slice 10 of the ongoing extraction). Dispatch logic for these
// tool names still lives in nexBrain.js; this file exists purely so the
// giant array doesn't have to hold every schema by hand.

export const ADMIN_ACTION_TOOLS = [
  {
    name: 'create_repo',
    description: 'Propose creating a brand new GitHub repository. This does NOT execute immediately — it adds the proposed repo to Mr. Lopez\'s approval queue, and only actually gets created once he approves (dashboard, text, or a yes/go ahead right here in the conversation — see approve_pending_action). Use this before creating files when the target repo does not exist yet.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner — should match the connected GitHub account.' },
        name: { type: 'string', description: 'Name for the new repository.' },
        description: { type: 'string', description: 'Short description of the repo itself (what it is for).' },
        private: { type: 'boolean', description: 'Whether the repo should be private. Defaults to false (public).' },
      },
      required: ['owner', 'name'],
    },
  },
  {
    name: 'delete_repo',
    description: 'Propose deleting an ENTIRE GitHub repository. This is irreversible once approved — GitHub does not support undoing it. This does NOT execute immediately — it adds the proposal to Mr. Lopez\'s approval queue, and only actually happens once he approves (dashboard, text, or a yes/go ahead right here in the conversation — see approve_pending_action). Only propose this when Mr. Lopez has clearly and explicitly asked for a specific repo to be deleted — never suggest this proactively.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string', description: 'Repo name to delete.' },
        description: { type: 'string', description: 'A short summary of why this repo is being deleted, shown to Mr. Lopez in the approval queue.' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'delete_board_task',
    description: "Propose deleting one or more tasks from the shared Agent Board by id. This does NOT execute immediately — each id is added to Mr. Lopez's approval queue as its own item, and only actually gets deleted once he approves it (dashboard, text, or a yes/go ahead right here in the conversation — see approve_pending_action). Irreversible once approved: the task and its whole history (notes, results, flags) are gone, not archived. Use this to propose cleaning up stale, duplicate, or genuinely obsolete tasks — always name the specific task(s) and why, so Mr. Lopez can see exactly what he's approving. Never propose deleting a task that is still owned/in-progress without saying so plainly.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id to delete.' },
        description: { type: 'string', description: 'Why this task should be deleted (e.g. "stale test task from task 03, already superseded"). Shown to Mr. Lopez in the approval queue.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_venture_canvas',
    description: "Provision a brand new, empty Nexus canvas for a new idea, project, or venture — its own persistent, live-editable surface (like the main dashboard canvas, but separate) that starts with one blank Notes panel and a real URL Mr. Lopez can open immediately. Executes immediately, no approval needed: creating an empty canvas is purely additive and can't break or overwrite anything (idempotent by id — calling this again with the same name returns the existing canvas untouched rather than resetting it). Also creates a matching Board task, linked to this canvas via canvas_id, so the new venture shows up in normal tracking AND in get_ventures_overview. Use this the moment Mr. Lopez names a new venture or idea he wants to start building out, not just discussing in the abstract.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short, human-readable name for the venture, e.g. "Glass Wing Landing Page" or "Client X Onboarding". Used as both the canvas display name and (slugified) its id.' },
        description: { type: 'string', description: 'Optional — a bit more detail on what this venture is, used as the linked Board task description.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_ventures_overview',
    description: "Get a standing, read-only summary across EVERY venture canvas — not just the one Mr. Lopez happens to be looking at right now. For each venture: total/open Board tasks, how many need his attention (blocked or waiting_for_justin), whether the canvas has gone quiet (no activity in a week), and a direct URL. Use this whenever he asks something like \"how's everything looking?\", \"what needs my attention?\", or \"what's going on across my ventures\" — from any canvas, not only when he's already on one. Purely informational, never mutates anything. Honest limitation: only Board tasks created with a canvas_id (e.g. via create_venture_canvas) show up linked to a venture — older tasks with no canvas_id aren't counted here, though they still show up on the plain Board.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'approve_pending_action',
    description: "Approve and immediately execute one specific pending item from the approval queue (something proposed by create_repo_file, update_repo_file, delete_repo_file, commit_repo_files, create_repo, delete_repo, or delete_board_task because it targeted the live branch, was a repo create/delete, or was a board task deletion). This runs the exact same execution path as the dashboard Approve button and the SMS 'ship it' reply — it does not weaken or bypass that gate, it just gives Mr. Lopez a third way to trigger it: saying yes right here in the chat. ONLY call this the moment Mr. Lopez has just said yes, go ahead, approved, do it, or clearly equivalent to that EXACT proposal, in this same conversation, right after you described it or reminded him of it. Never call this for something proposed in an earlier session you were not part of. Never chain it automatically after describing a new proposal — always wait for his actual reply first. If more than one item is pending and it is not obvious which one he means, ask him to confirm which one instead of guessing.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the pending queue item to approve — you were given this id in the tool_result text when the action was originally proposed.' },
      },
      required: ['id'],
    },
  },
];
