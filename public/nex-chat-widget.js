/**
 * Nex Chat Widget — embeddable chat component for the Conference Room
 * Loads as a self-contained module, sends messages directly to Nex
 */

class NexChatWidget {
  constructor(containerId = 'nex-chat-widget') {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`[NexChatWidget] Container #${containerId} not found`);
      return;
    }
    
    this.messages = [];
    this.isOpen = false;
    this.init();
  }

  init() {
    this.render();
    this.attachListeners();
    this.loadMessageHistory();
  }

  render() {
    this.container.innerHTML = `
      <div class="nex-chat-wrapper">
        <div class="nex-chat-header">
          <div class="nex-chat-title">
            <span class="nex-icon">⚡</span>
            <span>Chat with Nex</span>
          </div>
          <button class="nex-chat-toggle" aria-label="Toggle chat">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 13L13 3M13 13L3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="nex-chat-body">
          <div class="nex-chat-messages" id="nexChatMessages"></div>
        </div>

        <div class="nex-chat-footer">
          <input 
            type="text" 
            class="nex-chat-input" 
            id="nexChatInput"
            placeholder="Type a message for Nex…"
            autocomplete="off"
          >
          <button class="nex-chat-send" id="nexChatSend" aria-label="Send message">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M1 8L14 2L8 14L6.5 9.5L1 8Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  attachListeners() {
    const toggleBtn = this.container.querySelector('.nex-chat-toggle');
    const sendBtn = this.container.querySelector('#nexChatSend');
    const input = this.container.querySelector('#nexChatInput');

    toggleBtn.addEventListener('click', () => this.toggle());
    sendBtn.addEventListener('click', () => this.send());
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
  }

  toggle() {
    this.isOpen = !this.isOpen;
    const wrapper = this.container.querySelector('.nex-chat-wrapper');
    wrapper.classList.toggle('open', this.isOpen);
  }

  async send() {
    const input = this.container.querySelector('#nexChatInput');
    const text = input.value.trim();
    
    if (!text) return;

    // Add message to UI
    this.addMessage('user', text);
    input.value = '';
    input.focus();

    // Send to Nex via API (route TBD based on your backend)
    try {
      const response = await fetch('/api/nex-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, timestamp: Date.now() })
      });

      if (!response.ok) {
        this.addMessage('system', 'Failed to send message. Try again.');
        return;
      }

      const data = await response.json();
      if (data.reply) {
        this.addMessage('nex', data.reply);
      }
    } catch (err) {
      console.error('[NexChatWidget] Send error:', err);
      this.addMessage('system', 'Error sending message.');
    }
  }

  addMessage(role, text) {
    const messagesEl = this.container.querySelector('#nexChatMessages');
    const messageEl = document.createElement('div');
    messageEl.className = `nex-chat-message nex-chat-${role}`;
    messageEl.innerHTML = `
      <div class="nex-chat-bubble">
        <div class="nex-chat-text">${this.escapeHTML(text)}</div>
        <div class="nex-chat-time">${this.formatTime()}</div>
      </div>
    `;
    messagesEl.appendChild(messageEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  loadMessageHistory() {
    // Placeholder: load past messages if available
    // This could pull from localStorage or a server endpoint
  }

  formatTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Auto-init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new NexChatWidget('nex-chat-widget');
  });
} else {
  new NexChatWidget('nex-chat-widget');
}

export default NexChatWidget;
