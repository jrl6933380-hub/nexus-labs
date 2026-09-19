const stage = document.getElementById('nexus-visual-stage');
const viewTitle = document.getElementById('workspaceViewTitle');
const latestVisualButton = document.getElementById('workspaceLatestVisual');

const SYSTEMS = [
  { id: 'forge', title: 'Nexus Forge', icon: 'FG', hue: 205, featured: true, status: 'BUILD ENGINE', href: '/room.html', description: 'Site creation, visual editing, assets, previews, publishing, and customer AI in one pipeline.', sections: [
    ['Intent & Scope', 'Turns a conversation into a build brief, requirements, and a safe execution plan.'],
    ['Visual Builder', 'Creates and edits the live site surface while proven structure stays reusable underneath.'],
    ['Assets & Context', 'Accepts images and project context so Nex and the builder can see what the customer means.'],
    ['Preview & Publish', 'Keeps preview, pull request, approval, and production release as separate safe steps.'],
    ['Customer AI', 'Adds the optional embedded assistant without exposing the Nexus operator workspace.'],
    ['Vault Reuse', 'Pulls proven blueprints and modules before generating another version of the same structure.'],
  ] },
  { id: 'operations', title: 'Command Deck', icon: 'OP', hue: 188, status: 'LIVE CONTROL', href: '/mission-control.html', description: 'Tasks, deployments, health signals, approvals, and active work distilled into one operational view.', sections: [
    ['Live Board', 'Tracks tasks, handoffs, progress, and the next item that needs operator attention.'],
    ['Deployments', 'Surfaces production and preview state without making the Vercel dashboard the workspace.'],
    ['Agent Runs', 'Shows what Nex and the AI team are doing, paused on, or waiting for.'],
    ['System Health', 'Brings crashes, collisions, and failing checks into the same visual surface.'],
  ] },
  { id: 'story', title: 'Story Studio', icon: 'ST', hue: 276, featured: true, status: 'CREATIVE ENGINE', href: '/story-studio.html', description: 'Characters, scenes, comics, and cinematic story direction controlled as a live visual world.', sections: [
    ['Story Intake', 'Breaks an idea or chapter into scenes, dialogue, characters, and visual beats.'],
    ['Actor Intelligence', 'Keeps each character controllable while Nex directs the whole scene.'],
    ['Scene Composer', 'Combines likeness, background, action, and dialogue into editable story panels.'],
    ['Final Sequence', 'Assembles panels into a readable comic or an exportable visual sequence.'],
  ] },
  { id: 'agents', title: 'AI Team', icon: 'AI', hue: 154, status: 'ORCHESTRATED', href: '/conference-room.html', description: 'Nex, builders, reviewers, and cleaner roles working through shared tasks and handoffs.', sections: [
    ['Nex', 'Owns intent, routing, context, tool choice, approvals, and the final operator response.'],
    ['Build Lanes', 'Splits large work into focused structure, design, research, and implementation lanes.'],
    ['Review & Clean', 'Checks collisions, tests the merged result, and packages one clean handoff.'],
    ['Conference View', 'Shows team reasoning and progress without exposing internal static control pages.'],
  ] },
  { id: 'memory', title: 'Memory & Vault', icon: 'MV', hue: 42, status: 'PERSISTENT', href: '/memory.html', description: 'Long-term memory, snapshots, reusable code, proven blueprints, and continuity across agents.', sections: [
    ['Long-Term Memory', 'Preserves durable preferences, decisions, systems, and project context.'],
    ['Code Vault', 'Versions reusable blueprints, modules, and blocks instead of regenerating known patterns.'],
    ['Snapshots', 'Captures working system states so large edits start from a reliable checkpoint.'],
    ['Context Compiler', 'Loads only the relevant memory, files, tools, and skills for the active job.'],
  ] },
  { id: 'access', title: 'Access & Connectors', icon: 'AC', hue: 330, status: 'CONTROLLED', href: '/connectors.html', description: 'OAuth, tool access, tenants, approvals, and guarded connections to external systems.', sections: [
    ['Connector Bay', 'Controls GitHub, Vercel, model providers, and future external capabilities.'],
    ['Approval Queue', 'Keeps consequential actions behind explicit operator review.'],
    ['Tenant Boundary', 'Separates customer products from the private Nexus operator control plane.'],
    ['Capability Gateway', 'Gives agents scoped actions without copying credentials into prompts or UI.'],
  ] },
];

let boardSnapshot = null;
let activeView = 'overview';
let activeSection = null;
const backStack = [];
const forwardStack = [];

function element(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clearStage() {
  for (const child of [...stage.children]) {
    if (!child.classList.contains('pinned-visual-panel')) child.remove();
  }
}

function setTitle(title) {
  viewTitle.textContent = title;
  document.title = `${title} — Nexus`;
}

function hidePinnedVisual() {
  document.getElementById('nexPinnedVisualPanel')?.classList.add('workspace-hidden');
}

function promptNex(text) {
  window.dispatchEvent(new CustomEvent('nexus:nex-prompt', { detail: { text } }));
}

function systemPrompt(system, focus, mode = 'control') {
  const base = `Work from the Nexus Thoughtspace visual layer. ${mode === 'edit' ? 'Help me change' : 'Render a live interactive control panel for'} ${system.title} — ${focus}.`;
  return `${base} Read the real current state first. Keep me on this visual surface; do not navigate to a legacy page. Use live buttons for every useful operation and preserve the normal approval gate for consequential actions.`;
}

function metric(label, value) {
  const card = element('div', 'workspace-metric');
  card.append(element('span', '', label), element('strong', '', String(value ?? 0)));
  return card;
}

function renderOverview() {
  clearStage();
  hidePinnedVisual();
  setTitle('System Overview');
  const surface = element('div', 'workspace-surface');
  const hero = element('header', 'workspace-hero');
  const copy = element('div');
  copy.append(element('div', 'workspace-kicker', 'ONE SURFACE · EVERY SYSTEM'));
  copy.append(element('h1', '', 'Your whole operation, tuned into one view.'));
  copy.append(element('p', '', 'The static rooms still power the system underneath. This is the layer you work from: ask Nex, open a system, inspect it, or draw a completely new view without leaving Thoughtspace.'));
  hero.append(copy, element('div', 'workspace-pulse', 'SYSTEM ONLINE'));
  surface.append(hero);

  if (boardSnapshot) {
    const metrics = element('section', 'workspace-metrics');
    const telemetry = boardSnapshot.telemetry || {};
    metrics.append(
      metric('Open work', Math.max(0, (telemetry.total_tasks || 0) - (telemetry.completed_tasks || 0))),
      metric('Completed', telemetry.completed_tasks),
      metric('Approvals', telemetry.needs_approval),
      metric('Active agents', telemetry.active_agents),
    );
    surface.append(metrics);
  }

  const grid = element('section', 'workspace-grid');
  for (const system of SYSTEMS) {
    const card = element('button', `workspace-card${system.featured ? ' featured' : ''}`);
    card.type = 'button';
    card.style.setProperty('--card-hue', system.hue);
    card.dataset.systemId = system.id;
    const top = element('div', 'workspace-card-top');
    top.append(element('span', 'workspace-card-icon', system.icon), element('span', 'workspace-card-status', system.status));
    card.append(top, element('h2', '', system.title), element('p', '', system.description));
    const footer = element('footer');
    footer.append(element('span', '', 'CONNECTED ENGINE'), element('span', '', 'Tune in →'));
    card.append(footer);
    grid.append(card);
  }
  surface.append(grid);
  stage.prepend(surface);
}

function renderSystem(system) {
  clearStage();
  hidePinnedVisual();
  setTitle(system.title);
  const surface = element('div', 'workspace-surface');
  const back = element('button', 'workspace-back', '← System overview');
  back.type = 'button';
  back.addEventListener('click', () => showView('overview'));
  const hero = element('header', 'workspace-hero');
  const copy = element('div');
  copy.append(element('div', 'workspace-kicker', system.status), element('h1', '', system.title), element('p', '', system.description));
  hero.append(copy, element('div', 'workspace-pulse', 'CONNECTED'));
  const sections = element('section', 'workspace-section-grid');
  for (const [title, description] of system.sections) {
    const section = element('article', 'workspace-section');
    section.dataset.sectionTitle = title;
    const header = element('header');
    header.append(element('h2', '', title), element('small', '', 'READY'));
    const controls = element('div', 'workspace-section-actions');
    const open = element('button', '', 'Open live panel');
    open.type = 'button';
    open.addEventListener('click', () => promptNex(systemPrompt(system, title)));
    const edit = element('button', '', 'Change this');
    edit.type = 'button';
    edit.addEventListener('click', () => promptNex(systemPrompt(system, title, 'edit')));
    controls.append(open, edit);
    section.append(header, element('p', '', description), controls);
    sections.append(section);
  }
  const actions = element('div', 'workspace-detail-actions');
  const inspect = element('button', 'primary', `Open ${system.title} controls`);
  inspect.type = 'button';
  inspect.addEventListener('click', () => promptNex(systemPrompt(system, 'the whole system, its live state, current work, editable settings, and the best upgrades')));
  actions.append(inspect);
  const fallback = element('details', 'workspace-engine-fallback');
  const summary = element('summary', '', 'Developer fallback');
  const engine = element('a', '', `Open the ${system.title} engine page`);
  engine.href = system.href;
  engine.title = 'Fallback access to the underlying engine';
  fallback.append(summary, engine);
  surface.append(back, hero, sections, actions, fallback);
  stage.prepend(surface);
}

function renderBlank() {
  clearStage();
  hidePinnedVisual();
  setTitle('Blank Canvas');
  const surface = element('div', 'workspace-surface');
  const blank = element('section', 'workspace-blank');
  const copy = element('div', 'workspace-blank-copy');
  copy.append(element('div', 'workspace-blank-orb'), element('div', 'workspace-kicker', 'UNCOMMITTED SPACE'), element('h1', '', 'Start with nothing.'), element('p', '', 'Use the Nex dock to draw a plan, map a product, review a system, or build a temporary interactive workspace. The result takes over this canvas and stays in visual history.'));
  const ask = element('button', '', 'Open Nex and describe the view');
  ask.type = 'button';
  ask.addEventListener('click', () => window.dispatchEvent(new CustomEvent('nexus:open-dock')));
  copy.append(ask);
  blank.append(copy);
  surface.append(blank);
  stage.prepend(surface);
}

function showLatestVisual() {
  const panel = document.getElementById('nexPinnedVisualPanel');
  if (!panel || panel.classList.contains('is-empty')) return false;
  clearStage();
  panel.classList.remove('workspace-hidden', 'is-minimized');
  setTitle('Live Nex Visual');
  document.querySelectorAll('[data-workspace-view]').forEach((button) => button.classList.remove('is-active'));
  return true;
}

function resolvedView(view) {
  return view === 'overview' || view === 'blank' || SYSTEMS.some((system) => system.id === view) ? view : 'overview';
}

function showView(view, { record = true } = {}) {
  view = resolvedView(view);
  if (record && view !== activeView) {
    backStack.push(activeView);
    if (backStack.length > 30) backStack.shift();
    forwardStack.length = 0;
  }
  const previous = activeView;
  activeView = view;
  activeSection = null;
  document.querySelectorAll('[data-workspace-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.workspaceView === view));
  if (view === 'overview') renderOverview();
  else if (view === 'blank') renderBlank();
  else {
    const system = SYSTEMS.find((item) => item.id === view);
    if (system) renderSystem(system);
    else renderOverview();
  }
  history.replaceState({ nexusView: view }, '', view === 'overview' ? location.pathname : `#${view}`);
  window.dispatchEvent(new CustomEvent('nexus:workspace-view-changed', { detail: { view, previous } }));
}

function focusSection(title) {
  const wanted = String(title || '').toLowerCase();
  const sections = [...stage.querySelectorAll('[data-section-title]')];
  const target = sections.find((section) => section.dataset.sectionTitle.toLowerCase() === wanted);
  sections.forEach((section) => section.classList.toggle('is-focused', section === target));
  if (!target) return false;
  activeSection = target.dataset.sectionTitle;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

function moveHistory(from, to) {
  if (!from.length) return false;
  to.push(activeView);
  showView(from.pop(), { record: false });
  return true;
}

async function getLiveState() {
  try {
    const response = await fetch('/api/nex/action', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verb: 'snapshot', room_id: 'command-center' }),
    });
    const data = await response.json();
    if (response.ok && data.snapshot) {
      boardSnapshot = { ...(boardSnapshot || {}), ...data.snapshot };
      return boardSnapshot;
    }
  } catch {}
  return boardSnapshot || { telemetry: {} };
}

function systemForReference(reference) {
  const raw = String(reference || '').toLowerCase();
  return SYSTEMS.find((system) => raw.includes(system.id) || raw.includes(system.title.toLowerCase()) || raw.includes(system.href.replace(/^\//u, '').replace(/\.html$/u, '')));
}

stage.addEventListener('click', (event) => {
  const card = event.target.closest('[data-system-id]');
  if (card) showView(card.dataset.systemId);
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-workspace-view]');
  if (button) showView(button.dataset.workspaceView);
});
latestVisualButton.addEventListener('click', showLatestVisual);

window.addEventListener('nexus:navigate', (event) => {
  const system = systemForReference(event.detail?.url || event.detail?.room);
  if (!system) return;
  event.preventDefault?.();
  showView(system.id);
});
window.addEventListener('nexus:visual-updated', () => {
  latestVisualButton.hidden = false;
  showLatestVisual();
});
window.addEventListener('nexus:workspace-overview', () => showView('overview'));

window.NexusSpace = { openRoom(reference) { const system = systemForReference(reference); if (system) showView(system.id); } };
window.NexusWorkspace = {
  showView,
  showLatestVisual,
  focusSection,
  back: () => moveHistory(backStack, forwardStack),
  forward: () => moveHistory(forwardStack, backStack),
  getState: () => ({ view: activeView, section: activeSection }),
  getLiveState,
  labelForView(view) { return view === 'overview' ? 'System Overview' : view === 'blank' ? 'Blank Canvas' : SYSTEMS.find((system) => system.id === view)?.title || 'Thoughtspace'; },
  systems: SYSTEMS.map(({ id, title }) => ({ id, title })),
};

try {
  const response = await fetch('/api/board', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (response.ok) boardSnapshot = await response.json();
} catch {}

const initial = location.hash.replace(/^#/u, '');
showView(initial === 'blank' || SYSTEMS.some((system) => system.id === initial) ? initial : 'overview', { record: false });
