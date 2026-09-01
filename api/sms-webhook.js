// /api/sms-webhook.js
// Twilio calls this when Mr. Lopez texts back. Point the Twilio phone
// number's "A message comes in" webhook at this URL (POST,
// application/x-www-form-urlencoded — Twilio's default).
//
// Reply vocabulary:
//   "ship it" / "ship" / "yes"      -> approve the oldest pending item
//   "skip" / "reject" / "no"        -> reject the oldest pending item
//   "ship in order" / "ship all"    -> approve everything waiting, in order
//
// Only the number in JUSTIN_PHONE_NUMBER can approve/reject anything —
// texts from any other number are silently ignored.

import { listQueue, approveQueueItem, rejectQueueItem, approveAllQueueItems, notifyQueue } from '../lib/queue.js';
import { isFromJustin } from '../lib/sms.js';

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function twiml(messages) {
  const body = messages.map((m) => `<Message>${escapeXml(m)}</Message>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');

  if (req.method !== 'POST') {
    return res.status(405).send(twiml(['Method not allowed.']));
  }

  try {
    const { Body, From } = req.body || {};

    if (!isFromJustin(From)) {
      console.error('sms-webhook: ignoring message from unrecognized number', From);
      // No reply at all to a stranger's number — don't confirm this
      // line does anything.
      return res.status(200).send(twiml([]));
    }

    const text = (Body || '').trim().toLowerCase();

    const items = await listQueue();
    if (items.length === 0) {
      return res.status(200).send(twiml(['Nothing waiting right now.']));
    }

    if (text.includes('ship in order') || text.includes('ship all') || text.includes('approve all')) {
      const results = await approveAllQueueItems();
      await notifyQueue();

      const shipped = results.filter((r) => r.ok);
      const failed = results.find((r) => !r.ok);

      let msg = shipped.length
        ? `Shipped ${shipped.length}: ${shipped.map((r) => r.description).join('; ')}.`
        : 'Nothing shipped.';
      if (failed) {
        msg += ` Stopped at "${failed.description}" — failed: ${failed.error}. It and anything after it are still waiting.`;
      }
      return res.status(200).send(twiml([msg]));
    }

    // The oldest pending item is always the one that was just texted —
    // notifyQueue only ever advances to the next one after this one
    // is resolved, so there's no ambiguity to match against.
    const current = items[0];

    if (text.includes('ship') || text === 'yes' || text === 'y') {
      try {
        const { item } = await approveQueueItem(current.id);
        await notifyQueue();
        return res.status(200).send(twiml([`Shipped: ${item.description}`]));
      } catch (err) {
        console.error('sms-webhook: approve failed:', err.message);
        return res.status(200).send(twiml([`Failed to ship: ${err.message}`]));
      }
    }

    if (text.includes('skip') || text.includes('reject') || text === 'no' || text === 'n') {
      const { item } = await rejectQueueItem(current.id);
      await notifyQueue();
      return res.status(200).send(twiml([`Skipped: ${item.description}`]));
    }

    return res.status(200).send(
      twiml([`Didn't catch that. Reply "ship it" to approve, "skip" to reject, or "ship in order" to approve everything waiting.`])
    );
  } catch (err) {
    console.error('sms-webhook crashed:', err.message);
    return res.status(200).send(twiml(['Something went wrong on my end — check the dashboard.']));
  }
}
