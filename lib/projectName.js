export function projectDocumentTitle(html,fallback='Untitled project'){
  const title=String(html).match(/<title[^>]*>([^<]+)<\/title>/iu)?.[1]?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
  return String(title || fallback || 'Untitled project').replace(/[\u0000-\u001f]/g,'').slice(0,80);
}
