// Browser fallback for old bookmarked Nexus operator URLs. Production also
// redirects these at the edge, so the retired screens never flash there.
(function redirectRetiredNexusSurface(){
  const direct={
    '/mission-control.html':'/workspace.html?view=deck',
    '/conference-room.html':'/workspace.html?view=agents',
    '/memory.html':'/workspace.html?view=memory',
    '/queue.html':'/workspace.html?view=approvals',
    '/connectors.html':'/workspace.html?view=skills',
    '/tenants.html':'/workspace.html?view=forge',
    '/nexus-canvas.html':'/workspace.html?view=messages',
    '/thoughtspace.html':'/workspace.html?view=messages',
  };
  const spaces={command:'/workspace.html?view=deck',conference:'/workspace.html?view=agents',builder:'/forge.html?view=chat',story:'/story-studio.html',memory:'/workspace.html?view=memory',queue:'/workspace.html?view=approvals',connectors:'/workspace.html?view=skills',tenants:'/workspace.html?view=forge'};
  const room=location.hash.slice(1).toLowerCase();
  const target=location.pathname==='/nexus-space.html'
    ? (spaces[room] || '/workspace.html?view=messages')
    : direct[location.pathname];
  if(target)location.replace(target);
})();
