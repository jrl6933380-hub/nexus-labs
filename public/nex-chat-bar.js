/**
 * Nex Chat Bar Component
 * A creative, stylized chat interface for direct communication with Nex.
 * Embedded in the Conference Room and other rooms.
 */

export function canSendNexMessage({ typedText, attachedVisual, visionMode }) {
  return Boolean(typedText || attachedVisual || visionMode);
}

export async function handleAttachmentSelection({ file, prepareAttachment, clearAttachment, addMessage }) {
  if (!file) {
    return false;
  }
  try {
    await prepareAttachment(file);
    return true;
  } catch (err) {
    clearAttachment();
    addMessage(err.message || 'That image could not be attached.', 'nex-system');
    return false;
  }
}

export function getBoundedImageScale(width, height, maxDimension = 1280) {
  return Math.min(1, maxDimension / Math.max(width || 1, height || 1));
}

export function operatorLoginUrl(locationLike = {}) {
  const pathname = typeof locationLike.pathname === 'string' ? locationLike.pathname : '/';
  const search = typeof locationLike.search === 'string' ? locationLike.search : '';
  const hash = typeof locationLike.hash === 'string' ? locationLike.hash : '';
  const safePath = pathname.startsWith('/') && !pathname.startsWith('//')
    ? `${pathname}${search}${hash}`
    : '/';
  return `/room-login.html?next=${encodeURIComponent(safePath)}`;
}

export function redirectToOperatorLogin(response, locationLike) {
  if (response?.status !== 401 || typeof locationLike?.assign !== 'function') return false;
  locationLike.assign(operatorLoginUrl(locationLike));
  return true;
}

// Inline, in-chat version of "what Nex is doing right now" — replaces
// the old separate floating HUD entirely. Each stage event becomes its
// own short log line right in the conversation, the same way a tool
// call and its result show up as two lines when Claude is working:
// one line when a step starts, a second when it finishes or fails.
// Deliberately two lines, not one updating line — for a slow step
// (launching a client project can take a while) seeing "still going"
// stay on screen is more honest than a line that silently sits there.
export function addActionMessage(container, { label, state }) {
  if (!container || !label) return null;
  const el = document.createElement('div');
  el.className = `nex-message nex-action nex-action-${state || 'running'}`;
  const icon = state === 'complete' ? '✓' : state === 'failed' ? '✗' : '⋯';
  el.innerText = `${icon} ${label}`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

export function showSuccessfulNexReply({ data, clearAttachment, addMessage, speak }) {
  const replyText = data.reply || 'Nex completed the request without a text reply.';
  clearAttachment();
  addMessage(replyText, 'nex-response');
  speak(replyText);
  return replyText;
}

// Renders Nex's mid-task question as tappable chips, right under his
// explanation bubble — same visual language as the rest of the dock,
// not a separate popup. Tapping a chip sends that option as the next
// message (via onPick), same as if it had been typed; the row disables
// itself after one pick so an old question can't be answered twice.
export function renderApprovalAction({ approval, container, onApprove }) {
  if (!container || approval?.kind !== 'merge_pull_request' || !approval.id) return null;
  const row = document.createElement('div');
  row.className = 'nex-approval-action';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nex-approval-button';
  button.innerText = approval.label || 'Approve & merge';
  button.setAttribute('aria-label', approval.description || button.innerText);
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.innerText = 'Merging…';
    try {
      await onApprove(approval);
      row.classList.add('is-complete');
      button.innerText = 'Merged';
    } catch (err) {
      button.disabled = false;
      button.innerText = approval.label || 'Approve & merge';
      throw err;
    }
  });
  row.appendChild(button);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  return row;
}

export function renderQuestionOptions({ options, container, onPick }) {
  if (!container || !Array.isArray(options) || !options.length) return null;
  const row = document.createElement('div');
  row.className = 'nex-question-options';
  options.forEach((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nex-question-option';
    button.innerText = label;
    button.addEventListener('click', () => {
      if (row.classList.contains('is-answered')) return;
      row.classList.add('is-answered');
      onPick(label); // send(label) adds the user bubble itself — don't double it here
    });
    row.appendChild(button);
  });
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  return row;
}

let activeViewportFrameCacheInvalidator = null;
let viewportFrameCacheListenersBound = false;

function bindViewportFrameCacheInvalidation(invalidator) {
  activeViewportFrameCacheInvalidator = invalidator;
  if (viewportFrameCacheListenersBound || typeof window === 'undefined') return;
  const clearActiveViewportFrameCache = () => activeViewportFrameCacheInvalidator?.();
  window.addEventListener('scroll', clearActiveViewportFrameCache, { passive: true });
  window.addEventListener('resize', clearActiveViewportFrameCache);
  viewportFrameCacheListenersBound = true;
}

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
          <button class="nex-vision-toggle" id="nexVisionToggle" aria-label="Share the current tab visually with Nex" title="Share the current tab visually with Nex"><span aria-hidden="true">Vision</span></button>
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
      
      <div class="nex-controls-row" id="nexControlsRow">
        <select class="nex-control-select" id="nexModelSelect" title="Model" aria-label="Model">
          <option value="">Auto</option>
          <option value="cheap">Haiku</option>
          <option value="standard">Sonnet</option>
          <option value="heavy">Opus</option>
        </select>
        <select class="nex-control-select" id="nexEffortSelect" title="Effort" aria-label="Effort">
          <option value="">Auto</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button type="button" class="nex-deep-toggle" id="nexDeepToggle" aria-pressed="true" title="Toggle deep thought">
          <span aria-hidden="true">Deep</span>
        </button>
      </div>
      
      <div class="nex-attachment-preview" id="nexAttachmentPreview" hidden>
        <img id="nexAttachmentImage" alt="Image ready to send to Nex" />
        <span id="nexAttachmentName"></span>
        <button type="button" id="nexAttachmentRemove" aria-label="Remove attached image" title="Remove image">×</button>
      </div>
      <div class="nex-chat-input-area">
        <input type="file" id="nexAttachmentInput" accept="image/jpeg,image/png,image/webp" hidden />
        <button class="nex-attach-btn" id="nexAttach" type="button" aria-label="Add a picture for Nex to see" title="Add picture">
          <span aria-hidden="true">Pic</span>
        </button>
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
    .nex-voice-toggle,
    .nex-vision-toggle {
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

    .nex-voice-toggle,
    .nex-vision-toggle {
      width: auto;
      min-width: 46px;
      padding: 0 8px;
      font: 650 9px var(--nex-sans);
      letter-spacing: .01em;
    }

    .nex-controls-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px 0;
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .nex-control-select {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--nex-border);
      border-radius: 8px;
      padding: 4px 7px;
      color: var(--nex-text);
      font-family: var(--nex-mono);
      font-size: 10px;
      outline: none;
    }

    .nex-control-select:focus {
      border-color: var(--nex-accent);
    }

    .nex-deep-toggle {
      background: none;
      border: 1px solid var(--nex-border);
      border-radius: 8px;
      padding: 4px 9px;
      color: var(--nex-text-dim);
      font: 650 9px var(--nex-sans);
      letter-spacing: .01em;
      cursor: pointer;
      transition: color 0.2s, border-color 0.2s, background 0.2s;
    }

    .nex-deep-toggle[aria-pressed="true"] {
      color: #56d6a0;
      border-color: rgba(86, 214, 160, .42);
      background: rgba(86, 214, 160, .08);
    }

    .nex-deep-toggle:hover {
      color: #fff;
      border-color: var(--nex-accent);
    }

    .nex-chat-toggle:hover,
    .nex-voice-toggle:hover,
    .nex-vision-toggle:hover {
      color: #fff;
      border-color: var(--nex-accent);
      background: rgba(46, 127, 255, 0.13);
    }

    .nex-voice-toggle.active,
    .nex-vision-toggle.active {
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

    .nex-message.nex-action {
      background: none;
      border-left: none;
      color: var(--nex-text-faint);
      font-family: var(--nex-mono);
      font-size: 11px;
      padding: 2px 0 2px 8px;
      align-self: flex-start;
      max-width: 90%;
    }

    .nex-message.nex-action-complete {
      color: var(--nex-text-dim);
    }

    .nex-message.nex-action-failed {
      color: #ff7c8c;
    }

    .nex-approval-action {
      align-self: flex-start;
      max-width: 85%;
      margin: -2px 0 4px;
    }

    .nex-approval-button {
      background: rgba(86, 214, 160, .14);
      border: 1px solid #56d6a0;
      color: var(--nex-text);
      border-radius: 9px;
      padding: 8px 14px;
      font: 650 12px var(--nex-sans);
      cursor: pointer;
    }

    .nex-approval-button:hover:not(:disabled) { background: rgba(86, 214, 160, .25); }
    .nex-approval-button:disabled { cursor: default; opacity: .7; }
    .nex-approval-action.is-complete .nex-approval-button { border-color: rgba(86, 214, 160, .45); }

    .nex-question-options {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      align-self: flex-start;
      max-width: 85%;
      margin: -2px 0 4px;
    }

    .nex-question-options.is-answered .nex-question-option {
      opacity: .45;
      pointer-events: none;
    }

    .nex-question-option {
      background: rgba(86, 214, 160, .1);
      border: 1px solid #56d6a0;
      color: var(--nex-text);
      border-radius: 999px;
      padding: 6px 13px;
      font-family: var(--nex-sans);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
    }

    .nex-question-option:hover {
      background: rgba(86, 214, 160, .22);
      transform: translateY(-1px);
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

    .nex-attachment-preview {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 8px 16px;
      background: rgba(93, 184, 255, .06);
      border-top: 1px solid var(--nex-border);
      color: var(--nex-text-dim);
      font-size: 11px;
    }

    .nex-attachment-preview[hidden] { display: none; }

    .nex-attachment-preview img {
      width: 42px;
      height: 42px;
      object-fit: cover;
      border-radius: 7px;
      border: 1px solid var(--nex-border);
    }

    .nex-attachment-preview span {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nex-attachment-preview button {
      border: 1px solid var(--nex-border);
      border-radius: 7px;
      background: transparent;
      color: var(--nex-text-dim);
      cursor: pointer;
      width: 28px;
      height: 28px;
      font-size: 18px;
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

    .nex-attach-btn,
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

    .nex-attach-btn:hover,
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
  const attachBtn = container.querySelector('#nexAttach');
  const attachmentInput = container.querySelector('#nexAttachmentInput');
  const attachmentPreview = container.querySelector('#nexAttachmentPreview');
  const attachmentImage = container.querySelector('#nexAttachmentImage');
  const attachmentName = container.querySelector('#nexAttachmentName');
  const attachmentRemove = container.querySelector('#nexAttachmentRemove');
  const modelSelect = container.querySelector('#nexModelSelect');
  const effortSelect = container.querySelector('#nexEffortSelect');
  const deepToggle = container.querySelector('#nexDeepToggle');
  const voiceToggle = container.querySelector('#nexVoiceToggle');
  const visionToggle = container.querySelector('#nexVisionToggle');
  const messagesEl = container.querySelector('#nexMessages');
  const toggleBtn = container.querySelector('.nex-chat-toggle');
  const header = container.querySelector('.nex-chat-header');
  const positionKey = 'nex-chat-dock-position-v1';

  // Shared with mission-control.html's own model/effort picker via the
  // same localStorage keys, so a choice made in either interface carries
  // over to the other rather than needing to be set twice.
  const savedModel = localStorage.getItem('nex-model-choice');
  if (savedModel) modelSelect.value = savedModel;
  modelSelect.addEventListener('change', () => {
    localStorage.setItem('nex-model-choice', modelSelect.value);
  });

  const savedEffort = localStorage.getItem('nex-effort-choice');
  if (savedEffort) effortSelect.value = savedEffort;
  effortSelect.addEventListener('change', () => {
    localStorage.setItem('nex-effort-choice', effortSelect.value);
  });

  const savedDeepThought = localStorage.getItem('nex-deep-thought-enabled');
  let deepThoughtEnabled = savedDeepThought === null ? true : savedDeepThought !== 'false';
  deepToggle.setAttribute('aria-pressed', String(deepThoughtEnabled));
  deepToggle.addEventListener('click', () => {
    deepThoughtEnabled = !deepThoughtEnabled;
    deepToggle.setAttribute('aria-pressed', String(deepThoughtEnabled));
    localStorage.setItem('nex-deep-thought-enabled', String(deepThoughtEnabled));
  });

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
      story_project_id: /^[a-zA-Z0-9_-]{1,120}$/u.test(document.body?.dataset?.storyProjectId || '')
        ? document.body.dataset.storyProjectId
        : null,
      viewport: { width: window.innerWidth, height: window.innerHeight, scroll_y: Math.round(window.scrollY) },
    };
  }

  let visionStream = null;
  let visionVideo = null;
  let visionMode = null;
  let cachedViewportFrame = null;
  let cachedViewportSignature = '';

  function clearViewportFrameCache() {
    cachedViewportFrame = null;
    cachedViewportSignature = '';
  }

  function stopVision() {
    visionStream?.getTracks().forEach((track) => track.stop());
    visionStream = null;
    visionVideo = null;
    visionMode = null;
    visionToggle.classList.remove('active');
    visionToggle.setAttribute('aria-pressed', 'false');
    visionToggle.querySelector('span').textContent = 'Vision';
  }

  async function startVision() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      // Mobile Safari/Chrome do not expose desktop-style tab capture. In
      // that case Vision renders a privacy-filtered map of the visible page
      // into a canvas for each message. It is not hidden-page access and it
      // deliberately excludes the Nex dock and sensitive form controls.
      visionMode = 'viewport';
      visionToggle.classList.add('active');
      visionToggle.setAttribute('aria-pressed', 'true');
      visionToggle.querySelector('span').textContent = 'Seeing';
      return;
    }
    visionStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: 1, max: 2 } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    });
    visionVideo = document.createElement('video');
    visionVideo.srcObject = visionStream;
    visionVideo.muted = true;
    await visionVideo.play();
    visionMode = 'display';
    visionStream.getVideoTracks()[0]?.addEventListener('ended', stopVision, { once: true });
    visionToggle.classList.add('active');
    visionToggle.setAttribute('aria-pressed', 'true');
    visionToggle.querySelector('span').textContent = 'Seeing';
  }

  function captureViewportFrame() {
    const width = Math.max(1, Math.round(window.innerWidth));
    const height = Math.max(1, Math.round(window.innerHeight));
    const viewportSignature = `${width}x${height}:${Math.round(window.scrollX)}:${Math.round(window.scrollY)}`;
    if (cachedViewportFrame && cachedViewportSignature === viewportSignature) {
      return { ...cachedViewportFrame, captured_at: Date.now() };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width, 1280);
    canvas.height = Math.max(1, Math.round(height * (canvas.width / width)));
    const context = canvas.getContext('2d', { alpha: false });
    const bodyStyle = getComputedStyle(document.body);
    context.fillStyle = bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#ffffff' : bodyStyle.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / width;
    context.scale(scale, scale);

    const elements = [...document.querySelectorAll('body *')]
      .filter((element) => !element.closest('#nexChatBar') && isVisibleInViewport(element) && !isPrivateControl(element))
      .slice(0, 500);
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const drawWidth = Math.min(width - left, rect.width);
      const drawHeight = Math.min(height - top, rect.height);
      if (drawWidth <= 0 || drawHeight <= 0) continue;
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
        context.fillStyle = style.backgroundColor;
        context.fillRect(left, top, drawWidth, drawHeight);
      }
      if (style.borderTopWidth !== '0px' && style.borderTopColor !== 'rgba(0, 0, 0, 0)') {
        context.strokeStyle = style.borderTopColor;
        context.lineWidth = Math.min(4, parseFloat(style.borderTopWidth) || 1);
        context.strokeRect(left, top, drawWidth, drawHeight);
      }
      const text = element.children.length === 0 ? shorten(element.innerText || element.textContent, 180) : '';
      if (text) {
        const fontSize = Math.max(8, Math.min(32, parseFloat(style.fontSize) || 14));
        context.save();
        context.beginPath();
        context.rect(left, top, drawWidth, drawHeight);
        context.clip();
        context.fillStyle = style.color || '#111827';
        context.font = `${style.fontWeight || 400} ${fontSize}px ${style.fontFamily || 'sans-serif'}`;
        context.textBaseline = 'top';
        context.fillText(text, left + (parseFloat(style.paddingLeft) || 0), top + (parseFloat(style.paddingTop) || 0), Math.max(1, drawWidth));
        context.restore();
      }
    }
    cachedViewportFrame = {
      image_data_url: canvas.toDataURL('image/jpeg', 0.72),
      width: canvas.width,
      height: canvas.height,
    };
    cachedViewportSignature = viewportSignature;
    return { ...cachedViewportFrame, captured_at: Date.now() };
  }

  async function captureVisualFrame() {
    if (visionMode === 'viewport') return captureViewportFrame();
    if (!visionVideo || !visionStream?.active || visionVideo.readyState < 2) return null;
    const sourceWidth = visionVideo.videoWidth;
    const sourceHeight = visionVideo.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / sourceWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    canvas.getContext('2d', { alpha: false }).drawImage(visionVideo, 0, 0, canvas.width, canvas.height);
    return {
      image_data_url: canvas.toDataURL('image/jpeg', 0.72),
      width: canvas.width,
      height: canvas.height,
      captured_at: Date.now(),
    };
  }

  let attachedVisual = null;

  function clearAttachment() {
    attachedVisual = null;
    attachmentInput.value = '';
    attachmentImage.removeAttribute('src');
    attachmentName.textContent = '';
    attachmentPreview.hidden = true;
  }

  async function prepareAttachment(file) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Choose a JPEG, PNG, or WebP image.');
    }
    if (file.size > 12_000_000) throw new Error('That image is over the 12 MB upload limit.');
    const source = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = source;
      await image.decode();
      const scale = getBoundedImageScale(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
      attachedVisual = {
        image_data_url: canvas.toDataURL('image/jpeg', 0.8),
        width: canvas.width,
        height: canvas.height,
        captured_at: Date.now(),
      };
      attachmentImage.src = attachedVisual.image_data_url;
      attachmentName.textContent = file.name || 'Attached image';
      attachmentPreview.hidden = false;
    } finally {
      URL.revokeObjectURL(source);
    }
  }

  bindViewportFrameCacheInvalidation(clearViewportFrameCache);
  attachBtn.addEventListener('click', () => {
    attachmentInput.value = '';
    attachmentInput.click();
  });
  attachmentRemove.addEventListener('click', clearAttachment);
  attachmentInput.addEventListener('change', async () => {
    await handleAttachmentSelection({
      file: attachmentInput.files?.[0],
      prepareAttachment,
      clearAttachment,
      addMessage,
    });
  });

  visionToggle.setAttribute('aria-pressed', 'false');
  visionToggle.addEventListener('click', async () => {
    if (visionMode) {
      stopVision();
      return;
    }
    try {
      await startVision();
      addMessage(visionMode === 'viewport'
        ? 'Mobile Vision is on. Nex will receive a privacy-filtered visual map of the current viewport with each message.'
        : 'Visual sharing is on. Nex will receive one current-tab frame with each message until you turn it off.', 'nex-system');
    } catch (err) {
      const attemptedVisionMode = visionMode || (navigator.mediaDevices?.getDisplayMedia ? 'display' : 'viewport');
      stopVision();
      addMessage(
        attemptedVisionMode === 'viewport'
          ? (err.message || 'Mobile Vision could not start.')
          : (err.name === 'NotAllowedError' ? 'Visual sharing was cancelled.' : (err.message || 'Visual sharing could not start.')),
        'nex-system',
      );
    }
  });

  async function loadHistory() {
    try {
      const response = await fetch('/api/chat');
      if (redirectToOperatorLogin(response, window.location)) return;
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

  async function send(overrideText) {
    const typedText = overrideText !== undefined ? overrideText : input.value.trim();
    if (!overrideText && !canSendNexMessage({ typedText, attachedVisual, visionMode })) return;
    const text = typedText || 'Look at this image.';
    const visualForMessage = attachedVisual || await captureVisualFrame();

    addMessage(attachedVisual ? `${text} [picture attached]` : text, 'nex-user');
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          message: text,
          model: modelSelect.value || undefined,
          effort: effortSelect.value || undefined,
          deepThought: deepThoughtEnabled,
          resumeRunId: localStorage.getItem('nex-active-run-id') || undefined,
          workspace: {
            active_view: window.location.pathname,
            screen: captureWorkspaceSnapshot(),
            visual: visualForMessage,
          },
        }),
      });
      if (redirectToOperatorLogin(response, window.location)) return;
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
          if (type === 'stage') addActionMessage(messagesEl, eventData);
          else if (type === 'result') data = eventData;
          else if (type === 'error') throw new Error(eventData.error || 'Nex could not process that message.');
        }
      }
      if (!data) throw new Error('Nex did not return a response.');
      const terminalRun = ['completed', 'blocked', 'cancelled', 'failed'].includes(data.runState?.state);
      if (data.runState?.runId && !terminalRun) {
        localStorage.setItem('nex-active-run-id', data.runState.runId);
      } else {
        localStorage.removeItem('nex-active-run-id');
      }
      showSuccessfulNexReply({ data, clearAttachment, addMessage, speak });
      if (data.pendingApproval) {
        renderApprovalAction({
          approval: data.pendingApproval,
          container: messagesEl,
          onApprove: async (approval) => {
            const approvalResponse = await fetch('/api/queue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: approval.id, action: 'approve' }),
            });
            const approvalData = await approvalResponse.json().catch(() => ({}));
            if (!approvalResponse.ok) throw new Error(approvalData.error || 'Merge approval failed.');
            addMessage('Pull request merged successfully.', 'nex-system');
          },
        });
      }
      const tapOptions = data.question?.options?.length ? data.question.options : data.suggestedReplies;
      if (Array.isArray(tapOptions) && tapOptions.length) {
        renderQuestionOptions({ options: tapOptions, container: messagesEl, onPick: (choice) => send(choice) });
      }
      if (data.navigation?.type === 'room' && typeof data.navigation.url === 'string' && window.NexusSpace) {
        // Room navigation belongs to the visual room switcher. The shared Nex
        // dock appears across operator pages, so falling back to
        // window.location.assign here made an ordinary chat response hijack
        // unrelated buttons/pages and send them into Forge. Deliberate links
        // to Room Builder still work; only implicit global redirects are
        // disabled outside NexusSpace.
        const event = new CustomEvent('nexus:navigate', { detail: data.navigation });
        window.dispatchEvent(event);
      }
    } catch (err) {
      addMessage(err.message || 'Message failed to send. Try again.', 'nex-system');
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', () => send());
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

  // External trigger for "open the dock and kick off this exact
  // conversation" — used by the Venture Factory's "+" tile so hitting
  // it starts a real back-and-forth with Nex instead of a form.
  window.addEventListener('nexus:nex-prompt', (event) => {
    const prompt = event.detail?.text;
    if (!prompt) return;
    container.classList.remove('collapsed');
    send(prompt);
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
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.getElementById('nexChatBar')) {
        document.body.appendChild(createNexChatBar());
      }
    });
  } else if (!document.getElementById('nexChatBar')) {
    document.body.appendChild(createNexChatBar());
  }
}
