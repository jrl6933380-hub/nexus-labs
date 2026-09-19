const VIEW_ALIASES = Object.freeze({
  forge: ['forge', 'builder', 'website builder', 'room builder'],
  operations: ['command deck', 'operations', 'mission control'],
  story: ['story studio', 'story', 'comic studio'],
  agents: ['ai team', 'agent team', 'conference room', 'team', 'agents'],
  memory: ['memory', 'vault', 'code vault', 'memory and vault'],
  access: ['access', 'connectors', 'connector bay'],
  overview: ['overview', 'home', 'dashboard', 'system overview'],
  blank: ['blank', 'blank canvas', 'empty canvas'],
});

const FOCUS_COMMANDS = Object.freeze({
  approvals: { view: 'operations', section: 'Live Board' },
  tasks: { view: 'operations', section: 'Live Board' },
  deployments: { view: 'operations', section: 'Deployments' },
  agents: { view: 'agents', section: 'Build Lanes' },
  health: { view: 'operations', section: 'System Health' },
  crashes: { view: 'operations', section: 'System Health' },
  memories: { view: 'memory', section: 'Long-Term Memory' },
  snapshots: { view: 'memory', section: 'Snapshots' },
  connectors: { view: 'access', section: 'Connector Bay' },
});

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[!?.,]+$/gu, '').replace(/\s+/gu, ' ').trim();
}

function viewForName(value) {
  const target = normalized(value).replace(/^the /u, '');
  return Object.entries(VIEW_ALIASES).find(([, aliases]) => aliases.includes(target))?.[0] || null;
}

export function interpretWorkspaceCommand(input) {
  const text = normalized(input);
  if (!text) return { handled: false };

  if (/^(?:go )?back$/u.test(text)) return { handled: true, command: { type: 'back' } };
  if (/^(?:go )?forward$/u.test(text)) return { handled: true, command: { type: 'forward' } };
  if (/^(?:where am i|what(?:'s| is) open|current view)$/u.test(text)) return { handled: true, command: { type: 'where' } };
  if (/^(?:system status|status|what(?:'s| is) going on)$/u.test(text)) return { handled: true, command: { type: 'status' } };
  if (/^(?:help|what can i say|system commands)$/u.test(text)) return { handled: true, command: { type: 'help' } };
  if (/^(?:save (?:this )?(?:view|layout)|remember (?:this )?(?:view|layout))$/u.test(text)) return { handled: true, command: { type: 'save' } };
  if (/^(?:restore|load) (?:my )?(?:saved )?(?:view|layout)$/u.test(text)) return { handled: true, command: { type: 'restore' } };
  if (/^(?:run|open|start) (?:the )?launch checklist$/u.test(text)) return { handled: true, command: { type: 'routine', routine: 'launch-checklist' } };
  if (/^(?:show|open) (?:the )?(?:latest )?visual$/u.test(text)) return { handled: true, command: { type: 'latest-visual' } };

  const focus = text.match(/^(?:show|open|focus on|take me to|bring up) (?:the )?(approvals|tasks|deployments|agents|health|crashes|memories|snapshots|connectors)$/u);
  if (focus) return { handled: true, command: { type: 'focus', ...FOCUS_COMMANDS[focus[1]] } };

  const navigation = text.match(/^(?:open|show|go to|take me to|bring up|focus on) (.+)$/u);
  const direct = viewForName(navigation?.[1] || text);
  if (direct) return { handled: true, command: { type: 'navigate', view: direct } };

  return { handled: false };
}

function statusReply(snapshot) {
  const telemetry = snapshot?.telemetry || {};
  const open = Math.max(0, Number(telemetry.total_tasks || 0) - Number(telemetry.completed_tasks || 0));
  return `System live: ${open} open task${open === 1 ? '' : 's'}, ${Number(telemetry.active_agents || 0)} active agent${Number(telemetry.active_agents || 0) === 1 ? '' : 's'}, and ${Number(telemetry.needs_approval || 0)} approval${Number(telemetry.needs_approval || 0) === 1 ? '' : 's'} waiting.`;
}

export function createWorkspaceDirector({ workspace, storage, confirmAction = () => true } = {}) {
  if (!workspace) throw new Error('Workspace Director requires a workspace');
  const store = storage || { getItem() { return null; }, setItem() {} };

  async function execute(command) {
    if (command.type === 'navigate') {
      workspace.showView(command.view);
      return { handled: true, reply: `${workspace.labelForView(command.view)} opened.` };
    }
    if (command.type === 'focus') {
      workspace.showView(command.view);
      workspace.focusSection(command.section);
      return { handled: true, reply: `${command.section} is in focus.` };
    }
    if (command.type === 'back') return { handled: true, reply: workspace.back() ? `Back to ${workspace.labelForView(workspace.getState().view)}.` : 'There is no earlier workspace view.' };
    if (command.type === 'forward') return { handled: true, reply: workspace.forward() ? `Forward to ${workspace.labelForView(workspace.getState().view)}.` : 'There is no later workspace view.' };
    if (command.type === 'where') return { handled: true, reply: `You are in ${workspace.labelForView(workspace.getState().view)}.` };
    if (command.type === 'latest-visual') return { handled: true, reply: workspace.showLatestVisual() ? 'Latest live visual opened.' : 'There is no live visual yet.' };
    if (command.type === 'status') return { handled: true, reply: statusReply(await workspace.getLiveState()) };
    if (command.type === 'help') return { handled: true, reply: 'Try: “open Forge,” “show deployments,” “go back,” “system status,” “save this view,” “restore my layout,” or “run launch checklist.”' };
    if (command.type === 'save') {
      store.setItem('nexus-director-layout-v1', JSON.stringify(workspace.getState()));
      return { handled: true, reply: 'This workspace view is saved.' };
    }
    if (command.type === 'restore') {
      let saved = null;
      try { saved = JSON.parse(store.getItem('nexus-director-layout-v1')); } catch {}
      if (!saved?.view) return { handled: true, reply: 'No saved workspace view was found.' };
      workspace.showView(saved.view);
      if (saved.section) workspace.focusSection(saved.section);
      return { handled: true, reply: `${workspace.labelForView(saved.view)} restored.` };
    }
    if (command.type === 'routine' && command.routine === 'launch-checklist') {
      if (!confirmAction('Open the live launch checklist?')) return { handled: true, reply: 'Launch checklist cancelled.' };
      workspace.showView('operations');
      workspace.focusSection('Deployments');
      return { handled: true, reply: 'Launch checklist ready: review health, tests, approvals, preview, then production.' };
    }
    return { handled: false };
  }

  return {
    execute,
    async handle(text) {
      const parsed = interpretWorkspaceCommand(text);
      if (!parsed.handled) return parsed;
      return execute(parsed.command);
    },
  };
}

if (typeof window !== 'undefined') {
  const install = () => {
    if (!window.NexusWorkspace || window.NexusDirector) return;
    window.NexusDirector = createWorkspaceDirector({ workspace: window.NexusWorkspace, storage: window.localStorage, confirmAction: window.confirm.bind(window) });
    window.dispatchEvent(new CustomEvent('nexus:director-ready'));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}
