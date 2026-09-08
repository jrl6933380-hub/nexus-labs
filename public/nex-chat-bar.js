/**
 * Nex Chat Bar Component
 * A creative, stylized chat interface for direct communication with Nex.
 * Embedded in the Conference Room and other rooms.
 */

export function createNexChatBar() {
  const container = document.createElement('div');
  container.className = 'nex-chat-bar-container';
  container.id = 'nexChatBar';

  container.innerHTML = `
    <div class="nex-chat-wrapper">
      <div class="nex-chat-header">
        <div class="nex-chat-title">
          <span class="nex-drag-grip" aria-hidden="true">⠿</span>
          <span class="nex-orb" aria-hidden="true"></span>
          <span>Nex</span>
          <span class="nex-status">Operational</span>
        </div>
        <div class="nex-chat-actions">
          <button class="nex-voice-toggle" id="nexVoiceToggle" aria-label="Toggle spoken replies" title="Toggle spoken replies"><span aria-hidden="true">Audio</span></button>
          <button class="nex-chat-toggle" aria-label="Toggle chat" title="Open or minimize Nex chat">
            <span class="nex-toggle-icon">⌃</span>
          </button>
        </div>
      </div>
      
      <div class="nex-chat-messages" id="nexMessages" role="log" aria-live="polite" aria-label="Conversation with Nex" tabindex="0">
        <div class="nex-message nex-system">
          <span class="nex-timestamp">now</span>
          <span class="nex-text">Ready for input. Type below to send a task or question.</span>
        </div>
      </div>
      
      <div class="nex-chat-input-area">
        <input 
          type="text" 
          class="nex-chat-input" 
          id="nexInput" 
          placeholder="Command or question…" 
          autocomplete="off"
        />
        <button class="nex-mic-btn" id="nexMic" aria-label="Speak to Nex" title="Tap to speak">
          <span aria-hidden="true">Mic</span>
        </button>
        <button class="nex-chat-send" id="nexSend" aria-label="Send message" title="Send">
          <span>→</span>
        </button>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    :root {
      --nex-bg: rgba(12, 17, 25, .97);
      --nex-panel: #151c28;
      --nex-border: rgba(148, 163, 184, .2);
      --nex-text: #F4F7FB;
      --nex-text-dim: #A0ABBA;
      --nex-text-faint: #738094;
      --nex-accent: #5DB8FF;
      --nex-mono: 'JetBrains Mono', monospace;
      --nex-sans: 'Inter', -apple-system, sans-serif;
    }

    .nex-chat-bar-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 380px;
      max-height: 500px;
      display: flex;
      flex-direction: column;
      background: var(--nex-bg);
      border: 1px solid var(--nex-border);
      border-radius: 16px;
      box-shadow: 0 24px 70px rgba(0, 0, 0, .52), inset 0 1px 0 rgba(255, 255, 255, .035);
      backdrop-filter: blur(18px) saturate(110%);
      font-family: var(--nex-sans);
      transition: width 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
      color: var(--nex-text);
      z-index: 9999;
      overflow: hidden;
    }

    .nex-chat-bar-container.collapsed {
      width: 196px;
      max-height: none;
      border-color: rgba(148, 163, 184, .26);
      box-shadow: 0 14px 38px rgba(0, 0, 0, .42);
    }

    .nex-chat-bar-container.collapsed .nex-chat-wrapper > div:not(.nex-chat-header) {
      display: none;
    }

    .nex-chat-bar-container.collapsed .nex-chat-header {
      padding: 10px 12px;
      border-bottom: 0;
    }

    .nex-chat-bar-container.collapsed .nex-status,
    .nex-chat-bar-container.collapsed .nex-drag-label,
    .nex-chat-bar-container.collapsed .nex-voice-toggle {
      display: none;
    }

    .nex-chat-wrapper {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .nex-chat-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--nex-border);
      background: linear-gradient(90deg, rgba(93, 184, 255, .07), transparent 72%);
      flex-shrink: 0;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }

    .nex-chat-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--nex-sans);
      font-size: 13px;
      font-weight: 650;
      letter-spacing: .01em;
    }

    .nex-chat-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .nex-drag-grip {
      color: var(--nex-text-faint);
      font-size: 15px;
      letter-spacing: -3px;
      cursor: grab;
    }

    .nex-orb {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #4de8a0;
      box-shadow: 0 0 0 3px rgba(77, 232, 160, 0.12), 0 0 15px rgba(77, 232, 160, 0.92);
      animation: nex-pulse 2.2s ease-in-out infinite;
    }

    @keyframes nex-pulse {
      50% { box-shadow: 0 0 0 5px rgba(77, 232, 160, 0.04), 0 0 22px rgba(77, 232, 160, 0.85); }
    }

    @media (prefers-reduced-motion: reduce) {
      .nex-orb {
        animation: none;
      }

      .nex-message {
        animation: none;
      }
    }

    .nex-status,
    .nex-drag-label {
      color: #56d6a0;
      font-size: 9px;
      font-family: var(--nex-mono);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .nex-chat-toggle,
    .nex-voice-toggle {
      background: none;
      border: none;
      color: var(--nex-text-dim);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 1px solid var(--nex-border);
      border-radius: 8px;
      transition: color 0.2s, transform 0.2s, border-color 0.2s, background 0.2s;
      font-family: var(--nex-mono);
    }

    .nex-voice-toggle {
      width: auto;
      min-width: 46px;
      padding: 0 8px;
      font: 650 9px var(--nex-sans);
      letter-spacing: .01em;
    }

    .nex-chat-toggle:hover,
    .nex-voice-toggle:hover {
      color: #fff;
      border-color: var(--nex-accent);
      background: rgba(46, 127, 255, 0.13);
    }

    .nex-voice-toggle.active {
      color: #56d6a0;
      border-color: rgba(86, 214, 160, .42);
      background: rgba(86, 214, 160, .08);
    }

    .nex-chat-bar-container.collapsed .nex-toggle-icon {
      transform: rotate(180deg);
    }

    .nex-chat-messages {
      flex: 1 1 0;
      height: 0;
      overflow-y: scroll;
      overflow-x: hidden;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
      overscroll-behavior-y: contain;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }

    .nex-message {
      font-size: 13px;
      line-height: 1.5;
      padding: 10px 11px;
      border-radius: 10px;
      animation: nex-message-in 0.3s ease-out;
    }

    @keyframes nex-message-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .nex-message.nex-system {
      background: rgba(93, 184, 255, .06);
      border-left: 2px solid var(--nex-accent);
      color: var(--nex-text-dim);
    }

    .nex-message.nex-user {
      background: rgba(93, 184, 255, .11);
      border-left: 2px solid var(--nex-accent);
      color: var(--nex-text);
      align-self: flex-end;
      max-width: 85%;
    }

    .nex-message.nex-response {
      background: rgba(86, 214, 160, .065);
      border-left: 2px solid #56d6a0;
      color: var(--nex-text);
      align-self: flex-start;
      max-width: 85%;
    }

    .nex-timestamp {
      font-family: var(--nex-mono);
      font-size: 10px;
      color: var(--nex-text-faint);
      display: block;
      margin-bottom: 2px;
    }

    .nex-text {
      display: block;
      word-wrap: break-word;
    }

    .nex-chat-input-area {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--nex-border);
      background: rgba(18, 25, 42, 0.5);
      flex-shrink: 0;
    }

    .nex-chat-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--nex-border);
      border-radius: 10px;
      padding: 8px 12px;
      color: var(--nex-text);
      font-family: var(--nex-sans);
      font-size: 13px;
      transition: all 0.2s;
    }

    .nex-chat-input::placeholder {
      color: var(--nex-text-faint);
    }

    .nex-chat-input:focus {
      outline: none;
      border-color: var(--nex-accent);
      background: rgba(46, 127, 255, 0.08);
      box-shadow: 0 0 0 2px rgba(46, 127, 255, 0.2);
    }

    .nex-mic-btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--nex-border);
      border-radius: 10px;
      color: var(--nex-text-dim);
      cursor: pointer;
      font: 650 10px var(--nex-sans);
      padding: 8px 9px;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .nex-mic-btn:hover {
      border-color: var(--nex-accent);
      color: var(--nex-text);
    }

    .nex-mic-btn.listening {
      background: rgba(232, 93, 93, 0.15);
      border-color: #E85D5D;
      color: #E85D5D;
      animation: nex-mic-pulse 1.4s ease-in-out infinite;
    }

    @keyframes nex-mic-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(232, 93, 93, 0.35); }
      50% { box-shadow: 0 0 0 6px rgba(232, 93, 93, 0); }
    }

    .nex-chat-send {
      background: linear-gradient(135deg, rgba(46, 127, 255, 0.2), rgba(46, 127, 255, 0.08));
      border: 1px solid var(--nex-accent);
      border-radius: 10px;
      color: var(--nex-accent);
      cursor: pointer;
      font-family: var(--nex-mono);
      font-size: 15px;
      font-weight: 600;
      padding: 8px 12px;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .nex-chat-send:hover {
      background: linear-gradient(135deg, rgba(46, 127, 255, 0.3), rgba(46, 127, 255, 0.15));
      box-shadow: 0 0 12px rgba(46, 127, 255, 0.4);
    }

    .nex-chat-send:active {
      transform: scale(0.95);
    }

    /* Scrollbar styling */
    .nex-chat-messages::-webkit-scrollbar {
      width: 6px;
    }

    .nex-chat-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .nex-chat-messages::-webkit-scrollbar-thumb {
      background: rgba(46, 127, 255, 0.3);
      border-radius: 3px;
    }

    .nex-chat-messages::-webkit-scrollbar-thumb:hover {
      background: rgba(46, 127, 255, 0.5);
    }

    @media (max-width: 640px) {
      .nex-chat-bar-container {
        width: calc(100% - 20px);
        height: min(500px, 70vh);
        max-height: 70vh;
        bottom: 10px;
        right: 10px;
        border-radius: 12px;
      }

      .nex-chat-bar-container.collapsed {
        width: min(196px, calc(100% - 20px));
        height: auto;
      }

      .nex-chat-messages {
        min-height: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // Event handlers
  const input = container.querySelector('#nexInput');
  const sendBtn = container.querySelector('#nexSend');
  const micBtn = container.querySelector('#nexMic');
  const voiceToggle = container.querySelector('#nexVoiceToggle');
  const messagesEl = container.querySelector('#nexMessages');
  const toggleBtn = container.querySelector('.nex-chat-toggle');
  const header = container.querySelector('.nex-chat-header');
  const positionKey = 'nex-chat-dock-position-v1';

  function keepOnScreen(left, top) {
    const width = container.offsetWidth || 196;
    const height = container.offsetHeight || 52;
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
    };
  }

  function setDockPosition(left, top) {
    const next = keepOnScreen(left, top);
    container.style.left = `${next.left}px`;
    container.style.top = `${next.top}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';
    return next;
  }

  function restoreDockPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(positionKey));
      if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
        // Apply the raw position immediately so there's no visible flash at
        // the default bottom-right spot, then re-clamp on the next frame
        // once the element is connected and its real size is measurable.
        container.style.left = `${saved.left}px`;
        container.style.top = `${saved.top}px`;
        container.style.right = 'auto';
        container.style.bottom = 'auto';
        requestAnimationFrame(() => setDockPosition(saved.left, saved.top));
      }
    } catch {
      // A default bottom-right dock is still available when storage is blocked.
    }
  }

  function addMessage(text, type = 'nex-system') {
    const msgEl = document.createElement('div');
    msgEl.className = `nex-message ${type}`;
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    msgEl.innerHTML = `
      <span class="nex-timestamp">${timeStr}</span>
      <span class="nex-text">${escapeHtml(text)}</span>
    `;
    
    messagesEl.appendChild(msgEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function shorten(value, limit) {
    return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
  }

  function isVisibleInViewport(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < window.innerHeight && rect.left < window.innerWidth
      && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function isPrivateControl(element) {
    const signal = [element.type, element.name, element.id, element.autocomplete, element.getAttribute('aria-label'), element.placeholder].filter(Boolean).join(' ');
    return /password|passcode|secret|token|api.?key|authorization|credit|card|cvv|ssn/i.test(signal);
  }

  function describeControl(element) {
    const tag = element.tagName.toLowerCase();
    const type = element.type ? ` type=${element.type}` : '';
    const label = shorten(element.getAttribute('aria-label') || element.getAttribute('title') || element.placeholder || element.labels?.[0]?.innerText || element.innerText || element.name || element.id, 100);
    const value = !isPrivateControl(element) && /^(input|textarea|select)$/i.test(tag) && element.value ? ` value="${shorten(element.value, 180)}"` : '';
    return `<${tag}${type}>${label ? ` ${label}` : ''}${value}`;
  }

  function captureWorkspaceSnapshot() {
    const inNexChat = (element) => element.closest('#nexChatBar');
    const viewportText = [...document.querySelectorAll('h1,h2,h3,h4,p,li,dt,dd,th,td,label,[role="status"],[data-nex-context]')]
      .filter((element) => !inNexChat(element) && isVisibleInViewport(element))
      .map((element) => shorten(element.innerText || element.textContent, 240))
      .filter(Boolean).filter((text, index, all) => all.indexOf(text) === index).slice(0, 30);
    const controls = [...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[contenteditable="true"]')]
      .filter((element) => !inNexChat(element) && isVisibleInViewport(element))
      .map(describeControl).filter(Boolean).slice(0, 40);
    const focusedElement = document.activeElement;
    const focused = focusedElement && !inNexChat(focusedElement) && !isPrivateControl(focusedElement) ? describeControl(focusedElement) : '';
    return {
      title: shorten(document.title, 180), viewport_text: viewportText, controls, focused,
      viewport: { width: window.innerWidth, height: window.innerHeight, scroll_y: Math.round(window.scrollY) },
    };
  }

  async function loadHistory() {
    try {
      const response = await fetch('/api/chat');
      if (!response.ok) return;
      const data = await response.json();
      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (!messages.length) return;

      messagesEl.innerHTML = '';
      for (const message of messages) {
        const type = message.role === 'user' ? 'nex-user'
          : (message.role === 'assistant' ? 'nex-response' : 'nex-system');
        addMessage(message.content, type);
      }
    } catch {
      // The live chat is still usable when history cannot be loaded.
    }
  }

  // Voice output — Web Speech API's SpeechSynthesis. Off by default and
  // persisted once toggled: auto-speaking every reply the moment the
  // dock loads would be a jarring surprise on first use, not a delight,
  // so this is opt-in via the Audio button in the header.
  const voiceOutputKey = 'nex-voice-output-v1';
  let voiceEnabled = localStorage.getItem(voiceOutputKey) === 'true';
  const speechSupported = 'speechSynthesis' in window;

  function updateVoiceToggleUI() {
    voiceToggle.querySelector('span').textContent = voiceEnabled ? 'Audio on' : 'Audio';
    voiceToggle.classList.toggle('active', voiceEnabled);
    voiceToggle.setAttribute('aria-pressed', String(voiceEnabled));
  }

  if (speechSupported) {
    updateVoiceToggleUI();
    voiceToggle.addEventListener('click', () => {
      voiceEnabled = !voiceEnabled;
      try { localStorage.setItem(voiceOutputKey, String(voiceEnabled)); } catch {}
      updateVoiceToggleUI();
      if (!voiceEnabled) window.speechSynthesis.cancel();
    });
  } else {
    voiceToggle.remove();
  }

  function speak(text) {
    if (!voiceEnabled || !speechSupported || !text) return;
    window.speechSynthesis.cancel(); // one reply speaking at a time, never stacked
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
  }

  // Voice input — Web Speech API's SpeechRecognition. Feature-detected:
  // the mic button simply isn't shown in browsers without support
  // (Firefox desktop, most non-Chromium browsers) rather than exposing
  // a control that would just fail silently.
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (SpeechRecognitionImpl) {
    recognition = new SpeechRecognitionImpl();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.addEventListener('start', () => {
      listening = true;
      micBtn.classList.add('listening');
    });
    recognition.addEventListener('end', () => {
      listening = false;
      micBtn.classList.remove('listening');
    });
    recognition.addEventListener('error', () => {
      listening = false;
      micBtn.classList.remove('listening');
    });
    recognition.addEventListener('result', (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      input.value = transcript;
      const lastResult = event.results[event.results.length - 1];
      if (lastResult.isFinal) send();
    });

    micBtn.addEventListener('click', () => {
      if (listening) {
        recognition.stop();
        return;
      }
      // Never let the mic pick up Nex's own spoken reply mid-sentence.
      if (speechSupported) window.speechSynthesis.cancel();
      input.value = '';
      recognition.start();
    });
  } else {
    micBtn.remove();
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'nex-user');
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          message: text,
          workspace: {
            active_view: window.location.pathname,
            screen: captureWorkspaceSnapshot(),
          },
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Nex could not process that message.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Nex could not start the live build stream.');
      const decoder = new TextDecoder();
      let buffer = '';
      let data = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const raw of events) {
          const type = raw.match(/^event: (.+)$/m)?.[1];
          const payload = raw.match(/^data: (.+)$/m)?.[1];
          if (!type || !payload) continue;
          const eventData = JSON.parse(payload);
          if (type === 'stage') window.dispatchEvent(new CustomEvent('nexus:build-feedback', { detail: eventData }));
          else if (type === 'result') data = eventData;
          else if (type === 'error') throw new Error(eventData.error || 'Nex could not process that message.');
        }
      }
      if (!data) throw new Error('Nex did not return a response.');
      const replyText = data.reply || 'Nex completed the request without a text reply.';
      addMessage(replyText, 'nex-response');
      speak(replyText);
      if (data.navigation?.type === 'room' && typeof data.navigation.url === 'string') {
        const event = new CustomEvent('nexus:navigate', { detail: data.navigation });
        window.dispatchEvent(event);
        if (!window.NexusSpace && data.navigation.url.startsWith('/') && !data.navigation.url.startsWith('//')) {
          window.location.assign(data.navigation.url);
        }
      }
    } catch (err) {
      addMessage(err.message || 'Message failed to send. Try again.', 'nex-system');
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  toggleBtn.addEventListener('click', () => {
    container.classList.toggle('collapsed');
    const rect = container.getBoundingClientRect();
    const next = setDockPosition(rect.left, rect.top);
    try { localStorage.setItem(positionKey, JSON.stringify(next)); } catch {}
  });

  let drag = null;
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button, input')) return;
    const rect = container.getBoundingClientRect();
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
    header.setPointerCapture(event.pointerId);
    header.style.cursor = 'grabbing';
  });

  header.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const distanceX = event.clientX - drag.startX;
    const distanceY = event.clientY - drag.startY;
    if (Math.abs(distanceX) + Math.abs(distanceY) > 3) drag.moved = true;
    if (!drag.moved) return;
    event.preventDefault();
    setDockPosition(drag.left + distanceX, drag.top + distanceY);
  });

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
    header.style.cursor = 'grab';
    if (drag.moved) {
      const rect = container.getBoundingClientRect();
      try { localStorage.setItem(positionKey, JSON.stringify({ left: rect.left, top: rect.top })); } catch {}
    }
    drag = null;
  }

  header.addEventListener('pointerup', finishDrag);
  header.addEventListener('pointercancel', finishDrag);
  window.addEventListener('resize', () => {
    if (!container.style.left) return;
    const rect = container.getBoundingClientRect();
    const next = setDockPosition(rect.left, rect.top);
    try { localStorage.setItem(positionKey, JSON.stringify(next)); } catch {}
  });

  restoreDockPosition();

  // Keep the room visible on phones. The bar expands only after the user taps it.
  if (window.matchMedia('(max-width: 640px)').matches) {
    container.classList.add('collapsed');
  }

  loadHistory();
  return container;
}

// Auto-initialize if imported in HTML
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('nexChatBar')) {
      document.body.appendChild(createNexChatBar());
    }
  });
} else {
  if (!document.getElementById('nexChatBar')) {
    document.body.appendChild(createNexChatBar());
  }
}
