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
  const spaces={command:'deck',conference:'agents',builder:'forge',story:'story',memory:'memory',queue:'approvals',connectors:'skills',tenants:'forge'};
  const target=location.pathname==='/nexus-space.html'
    ? `/workspace.html?view=${spaces[location.hash.slice(1)] || 'messages'}`
    : direct[location.pathname];
  if(target)location.replace(target);
})();
