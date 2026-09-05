(() => {
  const route = location.pathname;
  const items = [
    ['/', 'Mission'],
    ['/memory.html', 'Memory'],
    ['/queue.html', 'Approvals'],
    ['/connectors.html', 'Connectors'],
  ];
  const activePath = route === '/index.html' ? '/' : route;
  const bar = document.createElement('header');
  bar.className = 'nexus-command-bar';
  bar.innerHTML = `
    <div class="nexus-brand"><span class="reactor-mini"></span><span class="brand-copy"><strong>NEXUS</strong><span>AI DEVELOPMENT SYSTEM</span></span></div>
    <div class="workspace-pill"><span>WORKSPACE</span><b>Nexus Labs</b></div>
    <div class="command-actions"><span class="system-online">SYSTEM ONLINE</span><select class="theme-select" id="nexus-theme-select" aria-label="Mission Control theme"><option value="stark">Stark</option><option value="ice">Ice</option><option value="ember">Ember</option><option value="violet">Violet</option></select><button class="operator-chip" id="nexus-operator" type="button" title="Mission Control session">JL</button></div>`;
  const dock = document.createElement('nav');
  dock.className = 'nexus-dock';
  dock.setAttribute('aria-label', 'Nexus workspace');
  dock.innerHTML = items.map(([href,label]) => `<a href="${href}" class="${activePath === href ? 'active' : ''}">${label}</a>`).join('');
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
  document.body.dataset.nexusScreen = items.find(([href]) => href === activePath)?.[1]?.toLowerCase() || 'workspace';
})();