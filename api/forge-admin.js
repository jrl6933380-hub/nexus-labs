// api/forge-admin.js
// Operator-only endpoint to seat the first Forge manager/worker
// accounts. There's no real admin console yet (see MVP scope item 2
// on the board — manager-created campaigns/assignment is still
// ahead) — this is just enough to unblock a real caller today.
//
// Auth: reuses the existing Room session cookie, and only proceeds if
// the signed-in user is an operator (roomAuth.isOperatorUser — the
// same allowlist that gates the Nex dock). Anyone else gets a 403.

import { getRequestUser, isOperatorUser, listUsers, createSession, destroySession, parseCookies, serializeSessionCookie, SESSION_COOKIE } from '../lib/roomAuth.js';
import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import { getConnection } from '../lib/forge/brainStore.js';
import { setForgeRole, FORGE_ROLES, isForgeManager } from '../lib/forgeRoles.js';
import { provisionForgeAccount, deleteForgeAccount } from '../lib/forgeAccounts.js';
import { upsertCallerProfile, setCallerStatus, listCallers } from '../lib/forgeDb.js';
const TRACKED_KEY = 'nexus:forge:tracked-developers';
async function trackedCommand(command) {
  const response = await fetch(process.env.KV_REST_API_URL, { method:'POST',
    headers:{ Authorization:`Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type':'application/json' },
    body:JSON.stringify(command) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Could not update the developer account list.');
  return data.result;
}

// Account creation itself lives in lib/forgeAccounts.js so this endpoint
// and Nex's create_forge_account tool provision accounts identically
// (same recovery-field handling, same atomic create, same operator
// ceiling) instead of drifting apart.

const ROLE_TO_KIND = {
  [FORGE_ROLES.WORKER]: 'worker',
  [FORGE_ROLES.MANAGER]: 'manager',
};

// ---- Accounts manager (public/forge-accounts.html) ----
// Levels: 'owner' = Nexus owner session or an operator username (full
// control, including admins). 'admin' = forge_manager (can create/delete
// callers and customers, never admins or owners). Anyone else: nothing.
const ACCOUNT_TYPES = Object.freeze({ customer: 'customer', caller: 'worker', admin: 'manager' });
const LOGIN_PATH = Object.freeze({
  customer: '/room-login.html',
  caller: '/room-login.html?next=/forge-caller.html',
  admin: '/room-login.html?next=/forge-dashboard.html',
});
const INTERNAL_EMAIL = /@nexus-forge\.internal$/iu;

async function accountActor(req, ownerSession) {
  if (ownerSession) return { who: null, level: 'owner' };
  const who = await getRequestUser(req);
  if (!who) return null;
  if (isOperatorUser(who)) return { who, level: 'owner' };
  if (await isForgeManager(who)) return { who, level: 'admin' };
  return null;
}

function typeOf(user) {
  if (isOperatorUser(user.username)) return 'owner';
  if (user.forgeRole === FORGE_ROLES.MANAGER) return 'admin';
  if (user.forgeRole === FORGE_ROLES.WORKER) return 'caller';
  return 'customer';
}

async function handleAccounts(req, res, actor) {
  const body = req.body || {};
  if (body.action === 'list_accounts') {
    const [users, callers] = await Promise.all([listUsers(), listCallers().catch(() => [])]);
    const byUser = new Map((callers || []).map((c) => [c.forge_username, c]));
    const accounts = users.map((u) => ({
      username: u.username,
      type: typeOf(u),
      plan: u.plan,
      billing: Boolean(u.stripeCustomerId),
      createdAt: u.createdAt || null,
      internal: INTERNAL_EMAIL.test(u.email || ''),
      displayName: byUser.get(u.username)?.display_name || null,
      you: Boolean(actor.who) && actor.who === u.username,
    })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.status(200).json({ accounts, level: actor.level });
  }

  if (body.action === 'create_account') {
    const type = String(body.accountType || '');
    if (!Object.prototype.hasOwnProperty.call(ACCOUNT_TYPES, type)) {
      return res.status(400).json({ error: 'Pick an account type: customer, caller, or admin.' });
    }
    if (type === 'admin' && actor.level !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can create admin accounts.' });
    }
    const target = String(body.targetUsername || '').trim();
    if (!target) return res.status(400).json({ error: 'Username is required.' });
    if (isOperatorUser(target)) return res.status(400).json({ error: 'That username is reserved for the owner.' });
    let account;
    try {
      account = await provisionForgeAccount({
        username: target, kind: ACCOUNT_TYPES[type], password: body.password ? String(body.password) : undefined,
      });
    } catch (err) {
      if (/already taken/i.test(err.message)) return res.status(409).json({ error: 'That username already has an account.', taken: true });
      return res.status(400).json({ error: err.message });
    }
    let warning = null;
    if (type === 'caller') {
      try { await upsertCallerProfile({ username: account.username, displayName: body.displayName }); }
      catch (err) { warning = 'Login created, but the caller profile could not be saved yet: ' + err.message; }
    }
    return res.status(200).json({
      username: account.username, password: account.password, accountType: type,
      displayName: body.displayName || null, loginPath: LOGIN_PATH[type], warning,
    });
  }

  if (body.action === 'delete_accounts') {
    const names = Array.isArray(body.usernames) ? [...new Set(body.usernames.map((n) => String(n).trim()).filter(Boolean))] : [];
    if (!names.length) return res.status(400).json({ error: 'Pick at least one account.' });
    if (names.length > 50) return res.status(400).json({ error: 'Delete at most 50 at a time.' });
    const users = new Map((await listUsers()).map((u) => [u.username, u]));
    const results = [];
    for (const name of names) {
      const user = users.get(name);
      if (!user) { results.push({ username: name, deleted: false, reason: 'No such account.' }); continue; }
      const type = typeOf(user);
      if (actor.who && actor.who === name) { results.push({ username: name, deleted: false, reason: 'You cannot delete the account you are signed in with.' }); continue; }
      if (type === 'admin' && actor.level !== 'owner') { results.push({ username: name, deleted: false, reason: 'Only the owner can delete admin accounts.' }); continue; }
      try {
        // deleteForgeAccount refuses operators and accounts with billing on
        // record (their Stripe subscription would keep charging).
        await deleteForgeAccount({ username: name });
        if (type === 'caller') await setCallerStatus(name, 'removed').catch(() => null);
        results.push({ username: name, deleted: true });
      } catch (err) {
        results.push({ username: name, deleted: false, reason: err.message });
      }
    }
    return res.status(200).json({ results });
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // The private Nexus owner can inspect and enter only accounts provisioned
  // for development through Nexus. Ordinary customers cannot use this path.
  const owner = await getNexusOwner(req).catch(() => null);
  if (req.method === 'GET') {
    if (!owner) return res.status(401).json({ error: 'Nexus owner access required.' });
    const users = await listUsers();
    const tracked = new Set(await trackedCommand(['SMEMBERS', TRACKED_KEY]) || []);
    const developers = users.filter((user) => /^forge-[a-f0-9]{8}@nexus-forge\.internal$/u.test(user.email || '')
      && !user.stripeCustomerId && !isOperatorUser(user.username));
    const accounts = await Promise.all(developers.slice(0, 60).map(async (user) => ({
      username: user.username, plan: user.plan, role: user.forgeRole || null,
      tracked: tracked.has(user.username), billed: Boolean(user.stripeCustomerId),
      brainConnected: Boolean((await getConnection(user.username).catch(() => null))?.connected),
    })));
    return res.status(200).json({ accounts });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, targetUsername, password, role } = req.body || {};
  if (['list_accounts', 'create_account', 'delete_accounts'].includes(action)) {
    const actor = await accountActor(req, owner);
    if (!actor) return res.status(401).json({ error: 'Sign in as the owner or a Forge admin.' });
    try {
      return await handleAccounts(req, res, actor);
    } catch (err) {
      console.error('forge-admin accounts action failed:', err.message);
      return res.status(400).json({ error: err.message || 'Account action failed.' });
    }
  }
  if (['create_developer', 'track_developer', 'untrack_developer', 'switch_developer', 'return_to_owner'].includes(action)) {
    if (!owner) return res.status(401).json({ error: 'Nexus owner access required.' });
    try {
      const previous = parseCookies(req)[SESSION_COOKIE];
      if (action === 'return_to_owner') {
        await destroySession(previous);
        res.setHeader('Set-Cookie', serializeSessionCookie(null, { clear: true }));
        return res.status(200).json({ ok: true });
      }
      if (action === 'create_developer') {
        const account = await provisionForgeAccount({ username: targetUsername, kind: 'customer' });
        await trackedCommand(['SADD', TRACKED_KEY, account.username]);
        return res.status(200).json({ username: account.username, password: account.password });
      }
      const candidate = (await listUsers()).find((user) => user.username === targetUsername);
      if (!candidate || candidate.stripeCustomerId || isOperatorUser(candidate.username)
        || !/^forge-[a-f0-9]{8}@nexus-forge\.internal$/u.test(candidate.email || '')) {
        return res.status(403).json({ error: 'Only internally provisioned, unbilled developer accounts can be tracked for testing.' });
      }
      if (action === 'track_developer' || action === 'untrack_developer') {
        await trackedCommand([action === 'track_developer' ? 'SADD' : 'SREM', TRACKED_KEY, candidate.username]);
        return res.status(200).json({ username:candidate.username, tracked:action === 'track_developer' });
      }
      const tracked = await trackedCommand(['SISMEMBER', TRACKED_KEY, candidate.username]);
      if (!tracked) {
        return res.status(403).json({ error: 'Track this account as a developer before opening it.' });
      }
      const token = await createSession(candidate.username);
      await destroySession(previous);
      res.setHeader('Set-Cookie', serializeSessionCookie(token));
      return res.status(200).json({ username: candidate.username });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Developer account action failed.' });
    }
  }

  const username = await getRequestUser(req);
  const callerAction = ['create_caller', 'remove_caller', 'restore_caller'].includes(action);
  const allowed = Boolean(username) && (isOperatorUser(username) || (callerAction && await isForgeManager(username)));
  if (!allowed) {
    return res.status(403).json({ error: 'Operator access required.' });
  }

  // ---- Caller program: one-step add / remove / restore (Ops dashboard) ----
  // create_caller  { targetUsername, displayName, password?, useExisting? }
  //   new login (worker role) + caller row. Password is generated when
  //   omitted and returned ONCE so the operator can send it.
  //   useExisting: seat an existing account as a caller instead (no password).
  // remove_caller  { targetUsername }  revoke Forge access; ledger untouched.
  // restore_caller { targetUsername }  give access back.
  if (action === 'create_caller' || action === 'remove_caller' || action === 'restore_caller') {
    const target = String(targetUsername || '').trim();
    if (!target) return res.status(400).json({ error: 'Username is required.' });
    if (isOperatorUser(target)) return res.status(400).json({ error: 'That is an operator account; it already has full access.' });
    try {
      if (action === 'remove_caller') {
        await setForgeRole(target, null);
        await setCallerStatus(target, 'removed');
        return res.status(200).json({ username: target, status: 'removed' });
      }
      if (action === 'restore_caller') {
        await setForgeRole(target, FORGE_ROLES.WORKER);
        await setCallerStatus(target, 'active');
        return res.status(200).json({ username: target, status: 'active' });
      }
      const { displayName, useExisting } = req.body || {};
      if (useExisting) {
        await setForgeRole(target, FORGE_ROLES.WORKER);
        const caller = await upsertCallerProfile({ username: target, displayName });
        return res.status(200).json({ username: target, displayName: caller?.display_name, existing: true });
      }
      let account;
      try {
        account = await provisionForgeAccount({
          username: target, kind: 'worker', password: password ? String(password) : undefined,
        });
      } catch (err) {
        if (/already taken/i.test(err.message)) {
          return res.status(409).json({ error: 'That username already has an account.', taken: true });
        }
        throw err;
      }
      // The login exists at this point. If the caller row fails, it is
      // still created automatically on their first sale, so report, don't fail.
      let displayNameSaved = null;
      let warning = null;
      try {
        displayNameSaved = (await upsertCallerProfile({ username: account.username, displayName }))?.display_name;
      } catch (err) {
        warning = 'Login created, but the caller profile could not be saved yet: ' + err.message;
      }
      return res.status(200).json({
        username: account.username, password: account.password, generatedPassword: account.generatedPassword,
        displayName: displayNameSaved, warning,
      });
    } catch (err) {
      console.error('forge-admin caller action failed:', err.message);
      return res.status(400).json({ error: err.message || 'Caller action failed.' });
    }
  }

  if (!targetUsername) return res.status(400).json({ error: 'targetUsername is required.' });
  if (role !== null && !Object.values(FORGE_ROLES).includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${Object.values(FORGE_ROLES).join(', ')}, or null to clear it.` });
  }

  try {
    if (action === 'create') {
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters — you set this, so pick something you can send them.' });
      }
      const account = await provisionForgeAccount({
        username: targetUsername,
        kind: ROLE_TO_KIND[role] || 'customer',
        password,
      });
      return res.status(200).json({ username: account.username, role: account.role });
    }
    const result = await setForgeRole(targetUsername, role);
    return res.status(200).json(result);
  } catch (err) {
    console.error('forge-admin handler failed:', err.message);
    return res.status(400).json({ error: err.message || 'Request failed.' });
  }
}
