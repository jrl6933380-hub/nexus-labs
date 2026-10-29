// Read only the public tool catalog. No wallet, session or model calls are needed.
(() => {
  const card = document.querySelector('.tools');
  const track = document.getElementById('tool-track');
  const list = document.getElementById('tool-names');
  const toggle = document.getElementById('motion-toggle');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function updateMotion() {
    const canMove = list.children.length > 1 && !reduced.matches;
    card.classList.toggle('is-moving', canMove);
    toggle.hidden = !canMove;
  }

  toggle.addEventListener('click', () => {
    const paused = card.classList.toggle('is-paused');
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.textContent = paused ? 'Resume scrolling' : 'Pause scrolling';
  });
  reduced.addEventListener('change', updateMotion);

  function populate(names) {
    const items = names.map(name => {
      const item = document.createElement('li');
      item.textContent = name;
      return item;
    });
    list.replaceChildren(...items);
    track.querySelector('.tool-copy')?.remove();
    const copy = list.cloneNode(true);
    copy.removeAttribute('id');
    copy.classList.add('tool-copy');
    copy.setAttribute('aria-hidden', 'true');
    track.append(copy);
    track.style.setProperty('--scroll-duration', Math.max(30, names.join('').length / 4) + 's');
    updateMotion();
  }

  // Keep the real, previously shipped examples if discovery is unavailable.
  populate(Array.from(list.children, item => item.textContent));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  fetch('/api/actor-credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'catalog' }),
    signal: controller.signal,
  }).then(async response => {
    if (!response.ok) return;
    const body = await response.json();
    if (!Array.isArray(body?.data?.actors)) return;
    const names = [...new Set(body.data.actors
      .filter(tool => tool && typeof tool.name === 'string' && tool.name.trim())
      .map(tool => tool.name.trim()))];
    if (names.length) populate(names);
  }).catch(() => {
    // The marketplace link and fallback examples continue to work offline.
  }).finally(() => clearTimeout(timeout));
})();
