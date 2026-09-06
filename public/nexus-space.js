import { safeText, startPolling, visualFor, currentTaskFor } from '/mission-engine.js';

const scenes = {
  command: { nav:'Mission', title:'COMMAND DECK', eyebrow:'Nexus Labs // Persistent Control Plane', summary:'One shared surface for your agents, work, approvals, memory, and active rooms.', detail:'/mission-control.html', action:'Open detailed Mission Control', cards:[['LIVE BOARD','Agent work and decisions stay visible'],['SYSTEM MAP','Every room is one part of the same system'],['NEX DOCK','Talk to Nex without leaving the board']] },
  conference: { nav:'Conference', title:'CONFERENCE ROOM', eyebrow:'Nexus Labs // Live Agent Table', summary:'The living round table. Agents stay seated around the current mission while you keep control of the whole space.', detail:'/conference-room.html', action:'Open conference detail', cards:[['ROUND TABLE','Live seats reflect the active agents'],['MISSION CORE','Current objective stays in the center'],['HANDOFFS','Work moves through the shared Board']] },
  builder: { nav:'Builder', title:'ROOM BUILDER', eyebrow:'Nexus Labs // Spatial Canvas', summary:'Turn the board into a build surface. Nex can help shape rooms, tools, client spaces, and visual states from here.', detail:'/room.html', action:'Open live Builder', cards:[['CANVAS','Shape the current environment'],['COMPONENTS','Make system pieces visual and reusable'],['PREVIEW','Move from idea to live room']] },
  memory: { nav:'Memory', title:'MEMORY ARCHIVE', eyebrow:'Nexus Labs // Durable Context', summary:'A visual archive of project decisions, lessons, handoffs, and the context your agents share.', detail:'/memory.html', action:'Open Memory Archive', cards:[['PROJECT MEMORY','Durable facts without bloated chat'],['DECISIONS','Keep the why beside the work'],['HANDOFFS','Bring the right context forward']] },
  queue: { nav:'Approvals', title:'APPROVAL QUEUE', eyebrow:'Nexus Labs // Human Gate', summary:'The room where you stay in the loop. Review anything that needs your explicit yes before it changes live work.', detail:'/queue.html', action:'Open Approval Queue', cards:[['NEEDS YOU','Actions wait here for your call'],['SAFE EXECUTION','No silent live changes'],['AUDIT TRAIL','Every decision has a record']] },
  connectors: { nav:'Connectors', title:'CONNECTOR BAY', eyebrow:'Nexus Labs // Capabilities', summary:'See the connections and tools that let your agents work against the real world, repos, previews, and services.', detail:'/connectors.html', action:'Open Connector Bay', cards:[['GITHUB','Source, branches, commits, and PRs'],['VERCEL','Deployments, previews, and production'],['TOOLS','Capabilities routed through Nex']] },
  tenants: { nav:'Tenants', title:'TENANT HUB', eyebrow:'Nexus Labs // Workspaces', summary:'A dedicated control surface for hosted or bring-your-own workspaces, providers, usage, and future Glass Wing clients.', detail:'/tenants.html', action:'Open Tenant Hub', cards:[['WORKSPACES','Keep each environment distinct'],['PROVIDERS','Bring the model or service you need'],['USAGE','Make activity visible and manageable']] }
};

const root = document.getElementById('nexusSpace');
root.innerHTML = '<header class="space-topbar"><div class="space-brand"><i class="space-reactor"></i><div><strong>NEXUS</strong><span>VISUAL DEVELOPMENT SYSTEM</span></div></div><div class="space-workspace">WORKSPACE · NEXUS LABS</div><div class="space-now"><i></i>LIVE SPACE</div></header><div class="space-layout"><aside class="space-rail"><div class="rail-label">Transform board</div><nav class="scene-nav" aria-label="Nexus rooms"></nav><div class="rail-live"><strong>ONE PERSISTENT SURFACE</strong><p>Change rooms in place. Your agent context and system state stay connected.</p></div></aside><section class="space-stage-wrap"><header class="scene-head"><div><div class="scene-eyebrow"></div><h1 class="scene-title"></h1><p class="scene-summary"></p></div><span class="scene-status">● SYNCHRONIZED</span></header><section class="scene" aria-label="Nexus visual workspace"><div class="scene-grid"></div><div class="scene-halo"></div><div class="scene-visuals"><div class="scene-floor"></div><div class="scene-extra"></div><div class="core"></div><div class="core-label"></div><div class="agent-orbit"></div></div><div class="scene-panel"></div></section></section><aside class="space-sidebar"><div class="side-kicker">Current room</div><div class="side-title"></div><a class="open-detail" target="_self"></a><section class="side-section"><h2>Live work</h2><div class="task-list"></div></section><section class="side-section"><h2>System signal</h2><div class="signal-list"></div></section></aside></div>';

const nav = root.querySelector('.scene-nav');
const state = { key:null, board:{ tasks:[], agents:[], telemetry:{} } };
Object.entries(scenes).forEach(([key, scene]) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.scene = key;
  button.innerHTML = safeText(scene.nav) + '<small>' + safeText(scene.title) + '</small>';
  button.addEventListener('click', () => openScene(key, true));
  nav.appendChild(button);
});

function sceneFromLocation() {
  const key = location.hash.replace(/^#/u, '').trim().toLowerCase();
  return scenes[key] ? key : 'command';
}

function renderBoard(board) {
  state.board = board || { tasks:[], agents:[], telemetry:{} };
  const tasks = Array.isArray(state.board.tasks) ? state.board.tasks : [];
  const agents = Array.isArray(state.board.agents) ? state.board.agents : [];
  const open = tasks.filter((task) => task.status !== 'complete');
  const displayAgents = agents.slice(0, 5);
  root.querySelector('.agent-orbit').innerHTML = displayAgents.map((agent) => {
    const visual = visualFor(agent);
    const task = currentTaskFor(agent, tasks);
    const active = ['planning','building','testing'].includes(task?.status || agent.status);
    const name = agent.display_name || visual.label;
    return '<article class="agent-node ' + (active ? 'active' : '') + '" style="--agent:' + safeText(visual.color) + '"><div class="agent-avatar">' + safeText(name.slice(0,1).toUpperCase()) + '</div><div class="agent-name">' + safeText(name) + '</div><div class="agent-task">' + safeText(task?.title || agent.status || 'Standing by') + '</div></article>';
  }).join('') || '<div class="empty">No agents are reporting to the Board right now.</div>';
  root.querySelector('.scene-panel').innerHTML = [
    [String(open.length), 'Open work'],
    [String(state.board.telemetry?.needs_approval || 0), 'Needs approval'],
    [String(displayAgents.length), 'Agents live']
  ].map((metric) => '<div class="metric"><b>' + safeText(metric[0]) + '</b><span>' + safeText(metric[1]) + '</span></div>').join('');
  root.querySelector('.task-list').innerHTML = open.slice(0, 5).map((task) => '<article class="task-row" data-status="' + safeText(task.status || 'idle') + '"><b>' + safeText(task.title || 'Untitled task') + '</b><span>' + safeText(task.status || 'idle') + (task.owner ? ' · ' + safeText(task.owner) : '') + '</span></article>').join('') || '<p class="empty">Nothing is waiting on the Board.</p>';
  root.querySelector('.signal-list').innerHTML = '<p class="empty">' + (state.board.disconnected ? 'Board telemetry is reconnecting.' : safeText((state.board.telemetry?.completed_tasks || 0) + ' complete · ' + (state.board.telemetry?.total_tasks || tasks.length) + ' tracked · ' + (state.board.telemetry?.crash_count || 0) + ' crash alerts')) + '</p>';
  const current = scenes[state.key] || scenes.command;
  root.querySelector('.core-label').innerHTML = safeText(open[0]?.title || current.nav) + '<small>' + safeText(open[0]?.status || 'READY FOR NEXT MOVE') + '</small>';
}

function renderSceneContent(scene) {
  root.querySelector('.scene-extra').innerHTML = '<div class="extra-grid">' + scene.cards.map((card) => '<article class="extra-card"><i></i><b>' + safeText(card[0]) + '</b><span>' + safeText(card[1]) + '</span></article>').join('') + '</div>';
}

function openScene(key, push) {
  const next = scenes[key] ? key : 'command';
  state.key = next;
  const scene = scenes[next];
  document.body.dataset.scene = next;
  document.title = 'Nexus // ' + scene.title;
  root.querySelector('.scene-eyebrow').textContent = scene.eyebrow;
  root.querySelector('.scene-title').textContent = scene.title;
  root.querySelector('.scene-summary').textContent = scene.summary;
  root.querySelector('.side-title').textContent = scene.nav;
  const detail = root.querySelector('.open-detail');
  detail.href = scene.detail;
  detail.textContent = scene.action + ' →';
  root.querySelectorAll('.scene-nav button').forEach((button) => button.classList.toggle('active', button.dataset.scene === next));
  renderSceneContent(scene);
  renderBoard(state.board);
  if (push && location.hash !== '#' + next) history.pushState({ scene:next }, '', '#' + next);
}

window.NexusSpace = { open:(reference) => {
  const raw = String(reference || '').toLowerCase();
  const key = Object.keys(scenes).find((scene) => raw.includes(scene)) || (raw.includes('approval') ? 'queue' : raw.includes('room') ? 'conference' : 'command');
  openScene(key, true);
}};
window.addEventListener('popstate', () => openScene(sceneFromLocation(), false));
window.addEventListener('nexus:navigate', (event) => {
  const room = event.detail?.room || event.detail?.url || '';
  window.NexusSpace.open(room);
});
openScene(sceneFromLocation(), false);
startPolling(renderBoard, { intervalMs:3000 });
const nexChat = document.createElement('script');
nexChat.type = 'module';
nexChat.src = '/nex-chat-bar.js';
document.body.appendChild(nexChat);
