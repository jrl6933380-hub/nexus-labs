// api/room-auth.js
// Signup (open registration), login, logout, and "who am I" for
// Nexus Forge accounts. See lib/roomAuth.js for the storage/session
// design.

import {
  createUser,
  verifyUser,
  createSession,
  destroySession,
  getRequestUser,
  parseCookies,
  serializeSessionCookie,
  SESSION_COOKIE,
  isOperatorUser,
  getUserEmail,
  isEmailVerified,
  markEmailVerified,
} from '../lib/roomAuth.js';
import {
  createVerificationToken,
  consumeVerificationToken,
  claimResendSlot,
  verificationEmailHtml,
} from '../lib/emailVerification.js';
import { sendEmail } from '../lib/emailSender.js';

function siteOrigin(req) {
  const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${forwardedHost}`;
}

// Best-effort throughout: a mail failure must not fail signup or leave
// the account in a half-created state. The account exists, the token
// exists, and the customer can always trigger a resend — so the worst
// case is one extra tap, not a lost signup.
async function sendVerificationEmail(req, username) {
  try {
    const email = await getUserEmail(username);
    if (!email) return false;
    const token = await createVerificationToken(username);
    const link = `${siteOrigin(req)}/api/room-auth?action=verify-email&token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: email,
      subject: 'Confirm your email for Nexus Forge',
      html: verificationEmailHtml({ username, link }),
    });
    return true;
  } catch (error) {
    console.error('room-auth: verification email failed:', error.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Email confirmation link target. A GET because it's opened from an
    // email client, so it answers with a small HTML page rather than
    // JSON — nobody reads JSON in a browser tab they arrived at from
    // their inbox.
    if (req.query?.action === 'verify-email') {
      try {
        const username = await consumeVerificationToken(req.query.token);
        if (!username) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.status(400).send(confirmationPage({
            ok: false,
            title: 'That link has expired',
            body: 'Confirmation links last 24 hours and can only be used once. Sign in and resend a fresh one.',
          }));
        }
        await markEmailVerified(username);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(confirmationPage({
          ok: true,
          title: 'Email confirmed',
          body: 'You\u2019re all set. Head back to Forge and start building.',
        }));
      } catch (error) {
        console.error('room-auth: verify-email failed:', error.message);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(500).send(confirmationPage({
          ok: false,
          title: 'Something went wrong',
          body: 'We couldn\u2019t confirm that link. Try resending it from your account.',
        }));
      }
    }

    // "me" check — used by room.html on load to decide whether to
    // redirect to the login page.
    try {
      const username = await getRequestUser(req);
      if (!username) return res.status(401).json({ error: 'Not signed in' });
      return res.status(200).json({
        username,
        operator: isOperatorUser(username),
        emailVerified: await isEmailVerified(username).catch(() => false),
      });
    } catch (err) {
      console.error('room-auth: me check failed:', err.message);
      return res.status(500).json({ error: 'Could not check session' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, username, password, email, securityQuestion, securityAnswer } = req.body || {};

  try {
    if (action === 'signup') {
      const user = await createUser(username, password, email, securityQuestion, securityAnswer);
      const token = await createSession(user.username);
      res.setHeader('Set-Cookie', serializeSessionCookie(token));
      // Fired after the session exists so a mail outage can never cost
      // someone their account — they are signed in either way, and an
      // unconfirmed account still works fully on its own connected Brain.
      const emailSent = await sendVerificationEmail(req, user.username);
      return res.status(200).json({
        username: user.username,
        operator: isOperatorUser(user.username),
        emailVerified: false,
        verificationEmailSent: emailSent,
      });
    }

    if (action === 'resend-verification') {
      const signedInUser = await getRequestUser(req);
      if (!signedInUser) return res.status(401).json({ error: 'Sign in first.' });
      if (await isEmailVerified(signedInUser)) {
        return res.status(200).json({ ok: true, emailVerified: true });
      }
      // Throttled per account. The response is deliberately the same
      // shape either way so the cooldown can't be used to probe timing.
      const allowed = await claimResendSlot(signedInUser);
      if (!allowed) {
        return res.status(429).json({
          error: 'We just sent one — check your inbox, then try again in a minute.',
        });
      }
      const sent = await sendVerificationEmail(req, signedInUser);
      if (!sent) return res.status(502).json({ error: 'Could not send that email right now.' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'login') {
      const user = await verifyUser(username, password);
      if (!user) return res.status(401).json({ error: 'Wrong username or password.' });
      const token = await createSession(user.username);
      res.setHeader('Set-Cookie', serializeSessionCookie(token));
      return res.status(200).json({
        username: user.username,
        operator: isOperatorUser(user.username),
        emailVerified: await isEmailVerified(user.username).catch(() => false),
      });
    }

    if (action === 'logout') {
      const cookies = parseCookies(req);
      await destroySession(cookies[SESSION_COOKIE]);
      res.setHeader('Set-Cookie', serializeSessionCookie(null, { clear: true }));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    // createUser/verifyUser throw plain, already user-facing messages
    // for expected validation failures (bad invite code, taken
    // username, etc) — safe to surface directly rather than a generic
    // 500, but still logged for anything unexpected.
    console.error('room-auth error:', err.message);
    return res.status(400).json({ error: err.message || 'Something went wrong.' });
  }
}

// Small self-contained page for the emailed confirmation link. Inline
// styles because this renders outside the app shell, in whatever
// browser the customer's mail client happens to open.
function confirmationPage({ ok, title, body }) {
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title></head>`,
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;',
    'background:#0b0b0d;color:#f4f1ea;font-family:-apple-system,Segoe UI,sans-serif;padding:24px">',
    '<div style="max-width:420px;text-align:center">',
    `<div style="font-size:40px;margin-bottom:12px">${ok ? '\u2713' : '\u2717'}</div>`,
    `<h1 style="font-size:1.5rem;margin:0 0 10px">${title}</h1>`,
    `<p style="color:#a8a29a;line-height:1.5;margin:0 0 24px">${body}</p>`,
    '<a href="/forge.html" style="display:inline-block;background:#c9a227;color:#000;padding:12px 26px;',
    'border-radius:999px;text-decoration:none;font-weight:700">Open Forge</a>',
    '</div></body></html>',
  ].join('');
}
