// Stable across background saves and repeated renders of the same reply.
export function chatVisualPromotionId(content,thread='nex-main'){
  let hash=2166136261;for(const character of String(content))hash=Math.imul(hash^character.charCodeAt(0),16777619);
  const scope=String(thread).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,48);
  return `direct-${scope}-${(hash>>>0).toString(36)}`;
}
