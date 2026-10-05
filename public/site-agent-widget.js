// public/site-agent-widget.js
// Embedded on a customer's PUBLISHED site (a different domain than
// this one) as: <script src="https://nexus-labs-sigma.vercel.app/site-agent-widget.js" data-project="..."></script>
// Renders a small chat bubble that talks to /api/site-agent-chat.
// Deliberately no dependencies, no build step \u2014 this has to run
// unmodified inside whatever a client's generated site looks like.
(() => {
  const scriptTag = document.currentScript;
  const projectId = scriptTag?.dataset?.project;
  if (!projectId) {
    console.error('Nexus site agent: missing data-project on the widget script tag.');
    return;
  }
  const API_BASE = new URL(scriptTag.src).origin;

  const style = document.createElement('style');
  style.textContent = `
    .nx-agent-launcher { position: fixed; right: 20px; bottom: 20px; z-index: 999999; width: 56px; height: 56px; border-radius: 50%; background: #2E7FFF; color: #fff; border: none; box-shadow: 0 8px 24px rgba(0,0,0,.25); cursor: pointer; font-size: 24px; }
    .nx-agent-panel { position: fixed; right: 20px; bottom: 88px; z-index: 999999; width: min(340px, calc(100vw - 40px)); max-height: 60vh; display: none; flex-direction: column; background: #fff; border-radius: 14px; box-shadow: 0 16px 48px rgba(0,0,0,.28); overflow: hidden; font-family: -apple-system, sans-serif; }
    .nx-agent-panel.open { display: flex; }
    .nx-agent-header { padding: 12px 14px; background: #111827; color: #fff; font-size: 13px; font-weight: 700; }
    .nx-agent-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .nx-agent-msg { max-width: 85%; padding: 8px 11px; border-radius: 10px; font-size: 13px; line-height: 1.4; }
    .nx-agent-msg.user { align-self: flex-end; background: #2E7FFF; color: #fff; }
    .nx-agent-msg.bot { align-self: flex-start; background: #F1F3F6; color: #111; }
    .nx-agent-inputrow { display: flex; border-top: 1px solid #eee; }
    .nx-agent-inputrow input { flex: 1; border: none; padding: 10px 12px; font-size: 13px; outline: none; }
    .nx-agent-inputrow button { border: none; background: #2E7FFF; color: #fff; padding: 0 14px; font-weight: 700; cursor: pointer; }
  `;
  document.head.appendChild(style);

  const launcher = document.createElement('button');
  launcher.className = 'nx-agent-launcher';
  launcher.setAttribute('aria-label', 'Chat with us');
  launcher.textContent = '\uD83D\uDCAC';

  const panel = document.createElement('div');
  panel.className = 'nx-agent-panel';
  panel.innerHTML = `
    <div class="nx-agent-header">Chat with us</div>
    <div class="nx-agent-messages"></div>
    <div class="nx-agent-inputrow">
      <input type="text" placeholder="Ask a question\u2026" maxlength="800">
      <button type="button">Send</button>
    </div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector('.nx-agent-messages');
  const inputEl = panel.querySelector('input');
  const sendBtn = panel.querySelector('.nx-agent-inputrow button');

  function addMessage(text, role) {
    const bubble = document.createElement('div');
    bubble.className = 'nx-agent-msg ' + role;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  launcher.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !messagesEl.children.length) {
      addMessage('Hi! Ask me anything about this business.', 'bot');
    }
  });

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    try {
      const res = await fetch(API_BASE + '/api/site-agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      addMessage(data.message || data.error || "Sorry, I couldn't answer that right now.", 'bot');
    } catch {
      addMessage("Sorry, I couldn't reach the assistant right now.", 'bot');
    } finally {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
})();
