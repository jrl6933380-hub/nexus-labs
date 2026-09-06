(() => {
  const route = location.pathname;
  const items = [
    ['/#command', 'Mission', 'command'],
    ['/#memory', 'Memory', 'memory'],
    ['/#queue', 'Approvals', 'queue'],
    ['/#tenants', 'Tenants', 'tenants'],
    ['/#connectors', 'Connectors', 'connectors'],
    ['/#conference', 'Rooms', 'conference'],
  ];
  const activePath = route === '/index.html' ? '/' : route;
  const activeScene = (activePath === '/' || route === '/nexus-space.html') ? location.hash.replace(/^#/u, '') || 'command' : null;
  const bar = document.createElement('header');
  bar.className = 'nexus-command-bar';
  bar.innerHTML = `
    <div class="nexus-brand"><span class="reactor-mini"></span><span class="brand-copy"><strong>NEXUS</strong><span>AI DEVELOPMENT SYSTEM</span></span></div>
    <div class="workspace-pill"><span>WORKSPACE</span><b>Nexus Labs</b></div>
    <div class="command-actions"><span class="system-online">SYSTEM ONLINE</span><select class="theme-select" id="nexus-theme-select" aria-label="Mission Control theme"><option value="stark">Stark</option><option value="ice">Ice</option><option value="ember">Ember</option><option value="violet">Violet</option></select><button class="operator-chip" id="nexus-operator" type="button" title="Mission Control session">JL</button></div>`;
  const dock = document.createElement('nav');
  dock.className = 'nexus-dock';
  dock.setAttribute('aria-label', 'Nexus workspace');
  dock.innerHTML = items.map(([href,label,scene]) => `<a href="${href}" class="${activeScene ? (activeScene === scene ? 'active' : '') : ''}">${label}</a>`).join('');
  document.body.prepend(bar);
  document.body.appendChild(dock);

  const themes = {
    stark: { reactor: '#5de7ff', blue: '#2e7fff', amber: '#e8a94d' },
    ice: { reactor: '#b9f3ff', blue: '#6ba8ff', amber: '#c7e6ff' },
    ember: { reactor: '#ffb36b', blue: '#ff6b4a', amber: '#ffd166' },
    violet: { reactor: '#d0a2ff', blue: '#8f7cff', amber: '#f0b8ff' },
  };
  const themeSelect = document.getElementById('nexus-theme-select');
  const savedTheme = localStorage.getItem('nexus-theme') || 'stark';
  function applyTheme(name) {
    const theme = themes[name] || themes.stark;
    document.body.dataset.nexusTheme = name;
    document.documentElement.style.setProperty('--reactor', theme.reactor);
    document.documentElement.style.setProperty('--blue', theme.blue);
    document.documentElement.style.setProperty('--amber', theme.amber);
    localStorage.setItem('nexus-theme', name);
    if (themeSelect) themeSelect.value = name;
  }
  themeSelect?.addEventListener('change', () => applyTheme(themeSelect.value));
  applyTheme(savedTheme);

  fetch('/api/room-auth', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((user) => { if (user?.username) document.getElementById('nexus-operator').textContent = user.username.slice(0, 2).toUpperCase(); })
    .catch(() => {});
  document.body.dataset.nexusScreen = activeScene || 'workspace';

  // Mission Control already has the full-size Nex conversation column. Every
  // other shell-backed workspace gets the same compact chat bar, which shares
  // /api/chat history and reports location.pathname with every message.
  const hasMissionControlChat = activePath === '/' || activePath === '/mission-control.html';
  const isLoginScreen = activePath === '/room-login.html';
  if (!hasMissionControlChat && !isLoginScreen && !document.getElementById('nexChatBar')) {
    const nexChat = document.createElement('script');
    nexChat.type = 'module';
    nexChat.src = '/nex-chat-bar.js';
    document.body.appendChild(nexChat);
  }
})();