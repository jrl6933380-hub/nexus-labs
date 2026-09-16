// /lib/nexToolCategories.js
// Pure data: which tools are always loaded (CORE_TOOL_NAMES) and how the
// rest are grouped behind tool_search (NEX_TOOL_CATEGORIES). Extracted out
// of lib/nexBrain.js so this map isn't buried 1,300 lines into a giant file.
// No logic lives here — matching/scoring logic (matchCategoriesKeyword etc.)
// stays in nexBrain.js and imports these two exports.

export const CORE_TOOL_NAMES = new Set([
  'save_memory',
  'update_memory',
  'delete_memory',
  'read_board',
  'find_board_task',
  'get_board_task',
  'get_reference_link',
  'get_system_status',
  'check_agent_log',
  'ask_user_question',
]);

export const NEX_TOOL_CATEGORIES = {
  memory_admin: {
    label: 'Memory candidate review and curation',
    tools: ['manage_memory_candidates'],
    tags: ['memory', 'memories', 'remember', 'forget', 'candidate', 'curate', 'preference', 'profile'],
  },
  coding: {
    label: 'GitHub & code (read, write, branch, PR, sandbox)',
    tools: [
      'list_repo_files', 'list_repos', 'read_repo_file', 'search_repo_code',
      'read_issue', 'read_pull_request', 'list_pull_requests', 'get_workflow_status', 'create_branch',
      'inspect_branch_diff', 'create_pull_request', 'merge_pull_request',
      'create_repo_file', 'update_repo_file', 'patch_repo_file', 'delete_repo_file',
      'commit_repo_files', 'create_repo', 'delete_repo', 'run_sandbox', 'test_code',
    ],
    tags: ['github', 'repo', 'repository', 'code', 'branch', 'pull request', 'merge', 'commit', 'file', 'sandbox', 'test', 'diff', 'workflow', 'ci'],
  },
  board_admin: {
    label: 'Board task management & the approval queue',
    tools: [
      'create_board_task', 'claim_board_task', 'update_board_task_progress',
      'mark_board_task_blocked', 'complete_board_task', 'post_board_message',
      'delete_board_task', 'attach_task_result', 'list_pending_actions',
      'read_pending_action', 'approve_pending_action',
    ],
    tags: ['board', 'task', 'approve', 'approval', 'pending action', 'queue', 'claim', 'assign', 'blocked', 'complete task'],
  },
  deploy: {
    label: 'Vercel deployments',
    tools: ['list_vercel_projects', 'list_vercel_deployments', 'get_vercel_build_logs', 'check_deployment_status'],
    tags: ['vercel', 'deploy', 'deployment', 'build log', 'production', 'live site'],
  },
  billing: {
    label: 'Stripe billing actions',
    tools: ['get_stripe_object', 'propose_stripe_action'],
    tags: ['stripe', 'billing', 'payment', 'refund', 'charge', 'subscription', 'invoice', 'credit'],
  },
  collab: {
    label: 'Hyperfocus handoffs, waking Claude, and multi-agent pipelines',
    tools: [
      'open_hyperfocus', 'publish_chat_context', 'read_hyperfocus', 'append_hyperfocus_delta',
      'close_hyperfocus', 'list_active_hyperfocus', 'wake_claude_code', 'prepare_build_handoff',
      'return_handoff_result', 'start_tunneled_pipeline', 'submit_pipeline_lane_result',
      'submit_pipeline_review', 'get_tunneled_pipeline', 'get_forge_escalation',
      'list_forge_customers', 'list_forge_escalations', 'delete_forge_escalation', 'create_forge_account',
      'find_forge_account', 'list_forge_accounts', 'delete_forge_account',
    ],
    tags: ['hyperfocus', 'handoff', 'claude', 'chatgpt', 'wake', 'pipeline', 'multi-agent', 'context transfer', 'forge', 'customer', 'account', 'escalation'],
  },
  vault: {
    label: 'Code Vault (reusable Blueprints, Modules, Blocks)',
    tools: ['search_vault', 'add_vault_item'],
    tags: ['vault', 'blueprint', 'module', 'block', 'reusable', 'template'],
  },
  crashes: {
    label: 'Crash Feed',
    tools: ['list_crashes', 'get_crash'],
    tags: ['crash', 'error feed', 'bug report'],
  },
  rooms: {
    label: 'Rooms and ventures',
    tools: ['list_rooms', 'open_room', 'create_venture_canvas', 'get_ventures_overview'],
    tags: ['room', 'venture', 'canvas', 'navigate', 'open room', 'dashboard view'],
  },
  delegate: {
    label: 'Delegating a prompt to another named model',
    tools: ['delegate_to_model'],
    tags: ['delegate', 'gemini', 'llama', 'gpt', 'named model', 'gateway'],
  },
  story: {
    label: 'Story Studio actor direction',
    tools: ['direct_story_actor'],
    tags: ['story studio', 'actor', 'comic', 'panel', 'direction', 'scene'],
  },
  launch: {
    label: 'Launching a real client site (dedicated repo + database + hosted deployment)',
    tools: ['launch_client_project'],
    tags: ['launch', 'client project', 'go live', 'provision', 'new client site'],
  },
};
