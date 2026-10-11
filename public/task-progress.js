// Public task updates only. Never pass model reasoning or tool payloads here.
export function createTaskProgress(updates = [], {running = false, open = running} = {}) {
  const element = document.createElement('details');
  element.className = 'task-progress'; element.open = open;
  const summary = document.createElement('summary'), list = document.createElement('ol');
  element.append(summary, list);
  const saved = [], seen = new Set();
  function label() { summary.textContent = running ? 'Working…' : `${element.open ? 'Hide' : 'Show'} progress · ${saved.length} ${saved.length === 1 ? 'update' : 'updates'}`; }
  function add(update) {
    const text = String(typeof update === 'string' ? update : update?.text || '').trim().slice(0,800);
    if (!text || seen.has(text) || saved.length >= 60) return;
    seen.add(text); saved.push({text});
    const item = document.createElement('li'); item.textContent = text; list.append(item);
    element.hidden = false; label();
  }
  element.addEventListener('toggle', label);
  element.hidden = true; updates.forEach(add); label();
  return {element, add, updates: saved, finish() { running = false; element.open = false; label(); }};
}
