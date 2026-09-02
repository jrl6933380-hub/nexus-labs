// Fresh, isolated E2B compute for Nex. No filesystem or process state
// survives a call, and every sandbox is killed in a finally block.
import * as E2B from 'e2b';

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
