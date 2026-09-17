// /pages/api/claude-message.js
// A private lane for Claude to message Nex directly — runs through
// the exact same brain as the visible chat (lib/nexBrain.js), but
// stateless: nothing here reads or writes the shared KV conversation
// history, so nothing shows up in Mr. Lopez's dashboard chat. Each
// call is independent. Meant for Claude to test something with Nex
// or send a one-off message, without cluttering the real conversation.

import { initSentry, Sentry } from '../lib/sentry.js';
import { askNex } from '../lib/nexBrain.js';
import crypto from 'node:crypto';
import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';

function timingSafeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left || '')).digest();
  const rightHash = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function internalTokenAuthorized(req) {
  const expected = process.env.NEXUS_AGENT_API_TOKEN;
  const header = String(req.headers?.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return Boolean(expected && supplied && timingSafeEqual(supplied, expected));
}

export default async function handler(req, res) {
  initSentry();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const sessionUser = await getRequestUser(req).catch(() => null);
  const operatorSession = Boolean(sessionUser && isOperatorUser(sessionUser));
  if (!operatorSession && !internalTokenAuthorized(req)) {
    return res.status(401).json({ error: 'Operator session or internal agent token required.' });
  }

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  try {
    // No history in, none saved after — fully stateless per call.
    const { reply } = await askNex(message, [], null, {}, null, {
      userId: operatorSession ? sessionUser : 'agent:claude',
      sourceAgent: 'claude',
    });
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('claude-message handler crashed:', err);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    return res.status(500).json({ error: 'Internal system error processing message.' });
  }
}
