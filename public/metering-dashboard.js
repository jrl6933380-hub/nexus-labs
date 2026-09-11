// public/metering-dashboard.js
// Tenant/Room metering UI: usage bar, spend ceiling, Stripe connect, onboard picker, sidebar
// Renders live credit usage and management controls.

export class MeteringDashboard {
  constructor({ container, tenantId, roomId, apiBaseUrl = '/api' } = {}) {
    this.container = container;
    this.tenantId = tenantId;
    this.roomId = roomId;
    this.apiBaseUrl = apiBaseUrl;
    this.state = {
      usage: null,
      ceiling: null,
      stripeStatus: null,
      loading: false,
      error: null,
    };
    this.refreshInterval = null;
  }

  async init() {
    this.render();
    await this.refresh();
    // Poll usage every 30s
    this.refreshInterval = setInterval(() => this.refresh(), 30000);
  }

  async refresh() {
    this.state.loading = true;
    try {
      const usage = await this.fetchUsage();
      const ceiling = await this.fetchCeiling();
      const stripeStatus = await this.fetchStripeStatus();
      this.state = { ...this.state, usage, ceiling, stripeStatus, error: null, loading: false };
      this.render();
    } catch (err) {
      this.state.error = err.message;
      this.state.loading = false;
      this.render();
    }
  }

  async fetchUsage() {
    const res = await fetch(`${this.apiBaseUrl}/metering/usage?tenant=${this.tenantId}&room=${this.roomId}`);
    if (!res.ok) throw new Error('Failed to fetch usage');
    return res.json();
  }

  async fetchCeiling() {
    const res = await fetch(`${this.apiBaseUrl}/metering/ceiling?tenant=${this.tenantId}`);
    if (!res.ok) throw new Error('Failed to fetch ceiling');
    return res.json();
  }

  async fetchStripeStatus() {
    const res = await fetch(`${this.apiBaseUrl}/stripe/status?tenant=${this.tenantId}`);
    if (!res.ok) return { connected: false, email: null };
    return res.json();
  }

  render() {
    const { usage, ceiling, stripeStatus, error, loading } = this.state;

    let html = '<div class="metering-dashboard">';

    if (error) {
      html += `<div class="metering-error">${this.escape(error)}</div>`;
    }

    if (loading && !usage) {
      html += '<div class="metering-loading">Loading usage...</div>';
    } else if (usage) {
      html += this.renderUsageBar(usage);
      html += this.renderCeiling(ceiling);
      html += this.renderStripeSection(stripeStatus);
      html += this.renderActions();
    }

    html += '</div>';
    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  renderUsageBar(usage) {
    const percent = usage.limit > 0 ? Math.round((usage.consumed / usage.limit) * 100) : 0;
    const statusClass = percent > 80 ? 'critical' : percent > 60 ? 'warning' : 'ok';
    const resetDate = new Date(usage.resetAt).toLocaleDateString();

    return `
      <div class="metering-usage">
        <div class="usage-header">
          <span class="usage-title">Monthly Credits</span>
          <span class="usage-reset">Resets ${resetDate}</span>
        </div>
        <div class="usage-bar-container">
          <div class="usage-bar ${statusClass}" style="width: ${percent}%"></div>
        </div>
        <div class="usage-stats">
          <span>${usage.consumed} / ${usage.limit}</span>
          <span class="usage-remaining">${usage.remaining} remaining</span>
        </div>
      </div>
    `;
  }

  renderCeiling(ceiling) {
    if (!ceiling) return '';
    const { limit, consumed, period } = ceiling;
    const percent = limit > 0 ? Math.round((consumed / limit) * 100) : 0;

    return `
      <div class="metering-ceiling">
        <div class="ceiling-header">Spend Ceiling (Hard Limit)</div>
        <div class="ceiling-display">
          <div class="ceiling-value">$${(consumed / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}</div>
          <div class="ceiling-bar-container">
            <div class="ceiling-bar" style="width: ${percent}%"></div>
          </div>
        </div>
      </div>
    `;
  }

  renderStripeSection(stripeStatus) {
    if (!stripeStatus) return '';

    let html = '<div class="metering-stripe">';
    html += '<div class="stripe-header">Billing</div>';

    if (stripeStatus.connected) {
      html += `
        <div class="stripe-connected">
          <span class="stripe-badge">✓ Connected</span>
          <span class="stripe-email">${this.escape(stripeStatus.email)}</span>
          <button class="btn-stripe-manage" data-action="manage-stripe">Manage Billing</button>
        </div>
      `;
    } else {
      html += `
        <div class="stripe-disconnected">
          <p>Connect Stripe to enable billing and increase credit limits.</p>
          <button class="btn-stripe-connect" data-action="connect-stripe">Connect Stripe</button>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  renderActions() {
    return `
      <div class="metering-actions">
        <button class="btn-onboard" data-action="show-onboard">Increase Limits</button>
        <button class="btn-details" data-action="show-details">Usage Details</button>
      </div>
    `;
  }

  attachEventListeners() {
    const buttons = this.container.querySelectorAll('[data-action]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        this.handleAction(action);
      });
    });
  }

  handleAction(action) {
    switch (action) {
      case 'connect-stripe':
        this.startStripeConnect();
        break;
      case 'manage-stripe':
        this.openStripePortal();
        break;
      case 'show-onboard':
        this.showOnboardingPicker();
        break;
      case 'show-details':
        this.showUsageDetails();
        break;
    }
  }

  async startStripeConnect() {
    try {
      const res = await fetch(`${this.apiBaseUrl}/stripe/connect-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: this.tenantId }),
      });
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      alert('Failed to start Stripe connection: ' + err.message);
    }
  }

  async openStripePortal() {
    try {
      const res = await fetch(`${this.apiBaseUrl}/stripe/portal-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: this.tenantId }),
      });
      const { url } = await res.json();
      window.open(url, '_blank');
    } catch (err) {
      alert('Failed to open billing portal: ' + err.message);
    }
  }

  showOnboardingPicker() {
    const modal = new OnboardingModal({ tenantId: this.tenantId, apiBaseUrl: this.apiBaseUrl });
    modal.show(() => this.refresh());
  }

  showUsageDetails() {
    const modal = new UsageDetailsModal({ usage: this.state.usage });
    modal.show();
  }

  destroy() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export class OnboardingModal {
  constructor({ tenantId, apiBaseUrl = '/api' } = {}) {
    this.tenantId = tenantId;
    this.apiBaseUrl = apiBaseUrl;
    this.plans = [
      { id: 'starter', name: 'Starter', credits: 1000, price: '$50/mo', description: 'For individuals' },
      { id: 'pro', name: 'Professional', credits: 5000, price: '$200/mo', description: 'For small teams' },
      { id: 'enterprise', name: 'Enterprise', credits: null, price: 'Custom', description: 'Contact sales' },
    ];
  }

  show(onComplete) {
    this.onComplete = onComplete;
    const backdrop = document.createElement('div');
    backdrop.className = 'onboarding-backdrop';
    backdrop.innerHTML = this.render();
    document.body.appendChild(backdrop);
    this.attachEventListeners(backdrop);
  }

  render() {
    let html = `
      <div class="onboarding-modal">
        <div class="onboarding-header">
          <h2>Choose Your Plan</h2>
          <button class="btn-close" data-action="close">×</button>
        </div>
        <div class="onboarding-plans">
    `;

    this.plans.forEach((plan) => {
      html += `
        <div class="plan-card" data-plan="${plan.id}">
          <h3>${plan.name}</h3>
          <div class="plan-price">${plan.price}</div>
          <div class="plan-credits">${plan.credits ? plan.credits.toLocaleString() + ' credits' : 'Custom'}</div>
          <p class="plan-description">${plan.description}</p>
          <button class="btn-select-plan" data-action="select-plan" data-plan="${plan.id}">
            ${plan.id === 'enterprise' ? 'Contact Sales' : 'Select'}
          </button>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
    return html;
  }

  attachEventListeners(backdrop) {
    backdrop.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        const plan = e.target.getAttribute('data-plan');
        if (action === 'close') {
          backdrop.remove();
        } else if (action === 'select-plan') {
          this.selectPlan(plan, backdrop);
        }
      });
    });
  }

  async selectPlan(planId, backdrop) {
    try {
      const res = await fetch(`${this.apiBaseUrl}/metering/select-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: this.tenantId, planId }),
      });
      if (res.ok) {
        backdrop.remove();
        if (this.onComplete) this.onComplete();
      } else {
        alert('Failed to select plan');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }
}

export class UsageDetailsModal {
  constructor({ usage } = {}) {
    this.usage = usage;
  }

  show() {
    const backdrop = document.createElement('div');
    backdrop.className = 'usage-details-backdrop';
    backdrop.innerHTML = this.render();
    document.body.appendChild(backdrop);
    this.attachEventListeners(backdrop);
  }

  render() {
    const { usage } = this;
    const resetDate = new Date(usage.resetAt).toLocaleString();
    const periodStart = new Date(usage.periodStart).toLocaleString();

    return `
      <div class="usage-details-modal">
        <div class="modal-header">
          <h2>Usage Details</h2>
          <button class="btn-close" data-action="close">×</button>
        </div>
        <div class="modal-body">
          <div class="detail-row">
            <span class="detail-label">Billing Period</span>
            <span class="detail-value">${periodStart} — ${resetDate}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Credit Limit</span>
            <span class="detail-value">${usage.limit}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Credits Consumed</span>
            <span class="detail-value">${usage.consumed}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Credits Reserved</span>
            <span class="detail-value">${usage.reserved}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Credits Remaining</span>
            <span class="detail-value" style="color: ${usage.remaining > 50 ? '#22c55e' : '#ef4444'}">${usage.remaining}</span>
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners(backdrop) {
    backdrop.querySelector('[data-action="close"]').addEventListener('click', () => {
      backdrop.remove();
    });
  }
}
