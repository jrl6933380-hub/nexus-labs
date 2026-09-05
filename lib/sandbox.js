// Fresh, isolated E2B compute for Nex. No filesystem or process state
// survives a call, and every sandbox is killed in a finally block.
import * as E2B from 'e2b';
import { createWorkspace, addArtifact, closeWorkspace } from './workspaceManager.js';

const Sandbox = E2B.Sandbox || E2B.default;
const MAX_TIMEOUT_MS = 60_000;
const MAX_COMMANDS = 8;

function assertAvailable() {
  if (!process.env.E2B_API_KEY) throw new Error('E2B_API_KEY not configured.');
  if (!Sandbox || typeof Sandbox.create !== 'function') {
    throw new Error('Could not resolve a usable Sandbox class from the e2b package.');
  }
}

export async function runInSandbox({ commands, timeoutMs } = {}) {
  assertAvailable();
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('At least one command is required.');
  if (commands.length > MAX_COMMANDS) throw new Error(`At most ${MAX_COMMANDS} commands are allowed per run.`);
  if (!commands.every((command) => typeof command === 'string' && command.trim())) {
    throw new Error('Each command must be a non-empty string.');
  }

  const lifetime = Math.min(Math.max(Number(timeoutMs) || 30_000, 1_000), MAX_TIMEOUT_MS);
  const sandbox = await Sandbox.create({ timeoutMs: lifetime });
  try {
    const results = [];
    for (const command of commands) {
      const result = await sandbox.commands.run(command);
      results.push({ command, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
    }
    return { results };
  } finally {
    await sandbox.kill();
  }
}


// SECURITY FIX (task 10): this previously passed `max_commands:
// commands.length` into createWorkspace() — meaning whatever the caller
// sent always trivially satisfied its own cap, so no real ceiling ever
// existed here (unlike the sibling runInSandbox() above, which has
// always enforced a real MAX_COMMANDS). Now max_commands resolves to
// the workspace's real policy default/cap (see lib/workspaceManager.js
// policy()), and an over-limit request is rejected — closing the
// workspace first so nothing is left orphaned — instead of silently
// running everything anyway.
//
// BEHAVIOR CHANGE: a caller that doesn't explicitly pass max_commands
// is now capped at the policy default (8, matching runInSandbox) rather
// than an unlimited pass-through. Callers that legitimately need more
// must explicitly request it, up to workspaceManager's MAX_COMMANDS (32).
export async function runInWorkspace({
  tenant_id, project_id, task_id, agent_id, commands, timeoutMs,
  network_allowlist, public_preview, spend_cap_cents, template, max_commands,
} = {}) {
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('At least one command is required.');
  const { workspace, sandbox } = await createWorkspace({
    tenant_id, project_id, task_id, agent_id,
    timeout_ms: timeoutMs, network_allowlist, public_preview, spend_cap_cents, template,
    max_commands,
  });

  if (commands.length > workspace.policy.max_commands) {
    await closeWorkspace(workspace.id, { tenant_id, project_id, task_id, agent_id }, { sandbox });
    throw new Error(
      `Too many commands: ${commands.length} exceeds this workspace's max_commands policy of ` +
      `${workspace.policy.max_commands}. Pass an explicit higher max_commands (up to 32) if this ` +
      `run genuinely needs more, or split the work across multiple runs.`
    );
  }

  try {
    const results = [];
    for (const command of commands) {
      const result = await sandbox.commands.run(command);
      results.push({
        command,
        stdout: String(result.stdout || '').slice(0, workspace.policy.max_output),
        stderr: String(result.stderr || '').slice(0, workspace.policy.max_output),
        exitCode: result.exitCode,
      });
    }
    return { workspace, results };
  } finally {
    await closeWorkspace(workspace.id, { tenant_id, project_id, task_id, agent_id }, { sandbox });
  }
}
