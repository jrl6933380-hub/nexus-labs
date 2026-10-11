// Persist only the public text; never retain event payloads or thinking blocks.
export function normalizeTaskProgress(updates) {
  const seen = new Set();
  return (Array.isArray(updates) ? updates : []).flatMap(update => {
    const text = typeof update === 'string' ? update : update?.text;
    if (typeof text !== 'string') return [];
    const clean = text.replace(/```[\s\S]*?```/gu, '').trim().slice(0,800);
    if (!clean || seen.has(clean)) return [];
    seen.add(clean); return [{text:clean}];
  }).slice(-60);
}
