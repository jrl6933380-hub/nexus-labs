// /lib/sms.js
// Thin Twilio wrapper — sends outbound texts (queue notifications) and
// verifies inbound ones actually come from Mr. Lopez's phone before
// letting anything act on them.
//
// Required env vars:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER   — the Twilio number texts are sent from
//   JUSTIN_PHONE_NUMBER  — the only number allowed to approve/reject

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const JUSTIN_PHONE_NUMBER = process.env.JUSTIN_PHONE_NUMBER;

export async function sendSms(body, to) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.error('sendSms: missing Twilio env vars (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER) — skipping send');
    return null;
  }
  const toNumber = to || JUSTIN_PHONE_NUMBER;
  if (!toNumber) {
    console.error('sendSms: no destination number and JUSTIN_PHONE_NUMBER not set — skipping send');
    return null;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const params = new URLSearchParams({ From: TWILIO_FROM_NUMBER, To: toNumber, Body: body });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('sendSms failed', res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Twilio send failed: ${data.message || res.status}`);
  }
  return data;
}

// Loose match on the last 10 digits so formatting differences
// (+1, dashes, spaces, parens) between what Twilio sends and what's
// in the env var don't cause a false rejection.
export function isFromJustin(fromNumber) {
  if (!JUSTIN_PHONE_NUMBER) {
    console.error('isFromJustin: JUSTIN_PHONE_NUMBER not set — rejecting all inbound texts');
    return false;
  }
  const normalize = (n) => (n || '').replace(/\D/g, '').slice(-10);
  return normalize(fromNumber) === normalize(JUSTIN_PHONE_NUMBER);
}
