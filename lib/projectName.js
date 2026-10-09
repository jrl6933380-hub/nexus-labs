export function projectDocumentTitle(html,fallback='New project'){
  const title=String(html).match(/<title[^>]*>([^<]+)<\/title>/iu)?.[1]?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
  return String(title || fallback || 'New project').replace(/[\u0000-\u001f]/g,'').slice(0,80);
}
