// api/password-reset.js
// Two-step "forgot password" flow, presented to the customer as a
// chat with Nex (see the reset modal in public/room-login.html)
// rather than a plain form — same request/response contract either
// way; the chat framing is purely the frontend's presentation of it.
//
// action "request": { username } -> if that account has an email on
// file, emails a one-time reset link. Always returns the same
// generic success message regardless of whether the username exists
// or has an email, so this endpoint can't be used to enumerate real
// accounts.
//
// action "reset": { token, password } -> consumes the token (single
// use, 30-minute expiry — see lib/passwordReset.js) and sets a new
// password. The token IS the identity proof here; nothing else
// verifies the requester, so a leaked token is equivalent to a leaked
// password until it's used or expires.

import { getUserEmail, setUserPassword, getSecurityQuestion, verifySecurityAnswer } from '../lib/roomAuth.js';
import { createResetToken, consumeResetToken } from '../lib/passwordReset.js';
import { sendEmail } from '../lib/emailSender.js';

const SITE_URL = process.env.SITE_URL || 'https://nexus-labs-sigma.vercel.app';
const GENERIC_REQUEST_MESSAGE =
  "If that account has an email on file, I've sent a reset link \u2014 check your inbox (and spam folder) over the next few minutes.";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, username, token, password } = req.body || {};

  try {
    if (action === 'get-question') {
      if (typeof username !== 'string' || !username.trim()) {
        return res.status(400).json({ error: 'Enter your username first.' });
      }
      const question = await getSecurityQuestion(username.trim());
      return res.status(200).json({ question });
    }

    if (action === 'verify-answer') {
      const { answer } = req.body || {};
      if (typeof username !== 'string' || !username.trim() || typeof answer !== 'string' || !answer.trim()) {
        return res.status(400).json({ error: 'Enter an answer.' });
      }
      const correct = await verifySecurityAnswer(username.trim(), answer);
      if (!correct) {
        return res.status(400).json({ error: "That answer doesn't match." });
      }
      // Correct answer issues the same kind of single-use token the
      // emailed link would — the "reset" action below doesn't care
      // which path produced it.
      const resetToken = await createResetToken(username.trim());
      return res.status(200).json({ token: resetToken });
    }

    if (action === 'request') {
      if (typeof username !== 'string' || !username.trim()) {
        return res.status(400).json({ error: 'Enter your username first.' });
      }
      try {
        const email = await getUserEmail(username.trim());
        if (email) {
          const resetToken = await createResetToken(username.trim());
          const resetUrl = `${SITE_URL}/room-login.html?reset=${resetToken}`;
          await sendEmail({
            to: email,
            subject: 'Reset your Nexus Forge password',
            html: `<p>Someone (hopefully you) asked to reset the password on your Nexus Forge account "${username.trim()}".</p><p><a href="${resetUrl}">Click here to set a new password</a>. This link works once and expires in 30 minutes.</p><p>If you didn't ask for this, you can ignore this email.</p>`,
          });
        }
      } catch (innerErr) {
        // Deliberately swallowed past this point: the response must
        // stay identical whether the account exists, has no email,
        // or the send itself failed, so a caller learns nothing about
        // which case occurred. Still logged for us to see it failed.
        console.error('password-reset request failed:', innerErr.message);
      }
      return res.status(200).json({ message: GENERIC_REQUEST_MESSAGE });
    }

    if (action === 'reset') {
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      }
      const resolvedUsername = await consumeResetToken(token);
      if (!resolvedUsername) {
        return res.status(400).json({ error: 'That reset link is invalid or has expired.' });
      }
      await setUserPassword(resolvedUsername, password);
      return res.status(200).json({ message: 'Password updated \u2014 you can sign in now.' });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('password-reset handler error:', err.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
