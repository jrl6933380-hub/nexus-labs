const DEFAULT_WRITE_TOOLS = new Set([
  'direct_story_actor', 'save_memory', 'update_memory', 'delete_memory', 'manage_memory_candidates',
  'create_repo_file', 'update_repo_file', 'patch_repo_file', 'delete_repo_file', 'commit_repo_files',
  'create_repo', 'delete_repo', 'create_branch', 'create_pull_request', 'merge_pull_request',
  'propose_stripe_action', 'approve_pending_action', 'create_board_task', 'claim_board_task',
  'update_board_task_progress', 'mark_board_task_blocked', 'complete_board_task', 'post_board_message',
  'delete_board_task', 'attach_task_result', 'wake_claude_code', 'open_hyperfocus',
  'publish_chat_context', 'append_hyperfocus_delta', 'close_hyperfocus', 'return_handoff_result',
  'start_tunneled_pipeline', 'submit_pipeline_lane_result', 'submit_pipeline_review',
  'add_vault_item', 'create_venture_canvas', 'direct_story_actor', 'launch_client_project',
  'create_forge_account', 'delete_forge_account', 'delete_forge_escalation', 'log_exchange',
]);

const CHECKPOINT_TOOLS = new Set([
  'tool_search', 'create_branch', 'create_repo_file', 'update_repo_file', 'patch_repo_file',
  'delete_repo_file', 'commit_repo_files', 'run_sandbox', 'test_code', 'inspect_branch_diff',
  'create_pull_request', 'merge_pull_request', 'launch_client_project',
]);

const HIGH_RISK_TOOLS = new Set([
  'delete_repo', 'merge_pull_request', 'approve_pending_action', 'propose_stripe_action',
  'launch_client_project', 'delete_forge_account', 'delete_forge_escalation',
]);

function categoriesByTool(categories = {}) {
  const result = new Map();
  for (const [category, definition] of Object.entries(categories)) {
    for (const name of definition.tools || []) {
      if (result.has(name)) throw new Error(`Nex tool ${name} appears in more than one category.`);
      result.set(name, category);
    }
  }
  return result;
}

export function createNexToolRegistry({ tools = [], coreToolNames = new Set(), categories = {} } = {}) {
  const categoryByTool = categoriesByTool(categories);
  const registry = new Map();
  for (const schema of tools) {
    const name = schema?.name;
    if (!name) throw new Error('Every Nex tool schema requires a name.');
    if (registry.has(name)) throw new Error(`Duplicate Nex tool schema: ${name}`);
    const core = coreToolNames.has(name);
    const category = categoryByTool.get(name) || null;
    registry.set(name, Object.freeze({
      name,
      schema,
      core,
      category,
      reachable: core || Boolean(category),
      sideEffect: DEFAULT_WRITE_TOOLS.has(name) ? 'write' : 'read',
      risk: HIGH_RISK_TOOLS.has(name) ? 'high' : DEFAULT_WRITE_TOOLS.has(name) ? 'medium' : 'low',
      checkpoint: CHECKPOINT_TOOLS.has(name),
    }));
  }

  const unknown = [...coreToolNames, ...categoryByTool.keys()].filter((name) => !registry.has(name));
  if (unknown.length) throw new Error(`Tool registry metadata references missing schemas: ${unknown.join(', ')}`);
  return registry;
}

export function activeToolSchemas(registry, unlockedCategories = new Set()) {
  return [...registry.values()]
    .filter((tool) => tool.core || (tool.category && unlockedCategories.has(tool.category)))
    .map((tool) => tool.schema);
}

export function toolRegistryManifest(registry) {
  return [...registry.values()].map(({ name, core, category, reachable, sideEffect, risk, checkpoint }) => ({
    name, core, category, reachable, sideEffect, risk, checkpoint,
  }));
}
