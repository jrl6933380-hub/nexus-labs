// Keep operator authentication inside the current workspace, never Forge.
export async function signInOperator(username, password, fetcher = fetch) {
  const response = await fetcher('/api/room-auth', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'operator-login', username: username.trim(), password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.operator !== true) {
    throw new Error(data.error || 'Sign in with your operator account.');
  }
  // Verify the browser actually received the cookie before claiming success.
  const session = await fetcher('/api/room-auth', { credentials: 'same-origin', cache: 'no-store' });
  const current = await session.json().catch(() => ({}));
  if (!session.ok || current.operator !== true) {
    throw new Error('Your session was not saved. Check that cookies are enabled and try again.');
  }
  return true;
}

let pendingSignIn = null;
export function requestOperatorSignIn() {
  if (pendingSignIn) return pendingSignIn;
  pendingSignIn = new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'nex-sign-in-title');
    dialog.style.cssText = 'width:min(360px,90vw);box-sizing:border-box;border:1px solid #627287;border-radius:16px;padding:24px;background:#151c28;color:#f4f7fb;';
    dialog.innerHTML = `
      <form style="display:grid;gap:14px;font:16px system-ui">
        <h2 id="nex-sign-in-title" style="margin:0">Sign in to Nex</h2>
        <p style="margin:0">Use your operator account. Your dashboard and message will stay here.</p>
        <label>Username<input name="username" autocomplete="username" required style="display:block;width:100%;box-sizing:border-box;font:inherit"></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required style="display:block;width:100%;box-sizing:border-box;font:inherit"></label>
        <p role="alert" style="margin:0;color:#ffacb5"></p>
        <button type="submit" style="min-height:44px;font:inherit">Sign in</button>
        <button type="button" style="min-height:44px;font:inherit">Stay on dashboard</button>
      </form>`;
    const form = dialog.querySelector('form');
    const password = form.elements.namedItem('password');
    const submit = form.querySelector('[type=submit]');
    const cancel = form.querySelector('[type=button]');
    let closed = false;
    function finish(value) {
      if (closed) return;
      closed = true;
      password.value = '';
      dialog.close();
      dialog.remove();
      resolve(value);
    }
    cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      form.querySelector('[role=alert]').textContent = '';
      try {
        await signInOperator(form.elements.namedItem('username').value, password.value);
        finish(true);
      } catch (error) {
        if (!closed) form.querySelector('[role=alert]').textContent = error.message || 'Could not sign in. Try again.';
      } finally {
        password.value = '';
        submit.disabled = false;
      }
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    form.elements.namedItem('username').focus();
  }).finally(() => { pendingSignIn = null; });
  return pendingSignIn;
}
