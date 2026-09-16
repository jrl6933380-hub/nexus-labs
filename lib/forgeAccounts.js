// lib/forgeAccounts.js
// One place that provisions a Room/Forge account end to end: create the
// user, optionally seat a Forge role, optionally set a plan.
//
// This existed only inside api/forge-admin.js, which meant the only way to
// make a worker account was an authenticated HTTP call with an operator
// session cookie. Nex needs to do it directly (Justin asks him for worker
// and test accounts), so the logic lives here and both the endpoint and
// Nex's tool call the same function instead of duplicating it.
//
// SECURITY CEILING: this can grant forge_worker and forge_manager, and it
// can set a billing plan. It CANNOT make someone an operator — operator
// status comes from the NEXUS_OPERATOR_USERNAMES environment variable
// (see isOperatorUser in lib/roomAuth.js), which is not writable at
// runtime by anything here. That ceiling is deliberate: it means no agent
// and no compromised session can escalate an account to operator, and it
// should stay that way. Do not add an "operator" option to this function.

import crypto from 'crypto';
import { createUser, setUserPlan, SECURITY_QUESTIONS, PLANS } from './roomAuth.js';
import { setForgeRole, FORGE_ROLES } from './forgeRoles.js';

// Operator-provisioned accounts don't use the self-service reset flow
// (credentials are handed out directly), so recovery fields just need to
// exist and be unguessable. Generated per account so one guessable answer
// isn't shared across every worker.
function internalRecovery(username) {
  return {
    email: `forge-${crypto.randomBytes(4).toString('hex')}@nexus-forge.internal`,
    securityQuestion: SECURITY_QUESTIONS[0],
    securityAnswer: crypto.randomBytes(12).toString('hex'),
  };
}

// Readable but strong: no ambiguous characters, safe to send over chat.
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(20);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export const FORGE_ACCOUNT_KINDS = Object.freeze({
  WORKER: 'worker',
  MANAGER: 'manager',
  CUSTOMER: 'customer',
});

const KIND_TO_ROLE = Object.freeze({
  worker: FORGE_ROLES.WORKER,
  manager: FORGE_ROLES.MANAGER,
  customer: null,
});

/**
 * Provision an account. Returns the generated password exactly once — it is
 * hashed on write and cannot be read back afterwards, so if it is lost the
 * account has to be reset rather than recovered.
 *
 * @param {string} username
 * @param {'worker'|'manager'|'customer'} kind
 * @param {string} [password] caller-supplied; generated when omitted
 * @param {string} [plan] one of PLANS; omit to leave on the default free tier
 */
export async function provisionForgeAccount({ username, kind = 'customer', password, plan } = {}) {
  if (!Object.prototype.hasOwnProperty.call(KIND_TO_ROLE, kind)) {
    throw new Error(`kind must be one of: ${Object.keys(KIND_TO_ROLE).join(', ')}`);
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
    throw new Error('Password must be at least 8 characters.');
  }
  if (plan !== undefined && !Object.values(PLANS).includes(plan)) {
    throw new Error(`plan must be one of: ${Object.values(PLANS).join(', ')}`);
  }

  const finalPassword = password || generatePassword();
  const { email, securityQuestion, securityAnswer } = internalRecovery(username);

  // createUser is the atomic guard (HSETNX): it throws 'already taken'
  // rather than replacing an existing account's credentials.
  const user = await createUser(username, finalPassword, email, securityQuestion, securityAnswer);

  const role = KIND_TO_ROLE[kind];
  if (role) await setForgeRole(user.username, role);
  if (plan) await setUserPlan(user.username, plan);

  return {
    username: user.username,
    kind,
    role: role || null,
    plan: plan || PLANS.FREE,
    password: finalPassword,
    generatedPassword: !password,
  };
}
