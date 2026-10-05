// lib/emailSender.js
// Thin wrapper over the Resend REST API. Raw fetch, no SDK — same
// no-new-dependencies pattern as this repo's other third-party
// integrations (lib/roomAuth.js, api/checkout.js).
//
// IMPORTANT: onboarding@resend.dev (the default FROM_ADDRESS below)
// only delivers to the email address of the Resend account owner —
// it cannot reach real customers. Password reset emails won't reach
// anyone but the account owner until a real sending domain is
// verified in the Resend dashboard and RESET_EMAIL_FROM is set to an
// address on that domain (e.g. noreply@nexusforge.com).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.RESET_EMAIL_FROM || 'onboarding@resend.dev';

export async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Resend send failed:', data.message || res.status);
    throw new Error(data.message || 'Email send failed');
  }
  return data;
}
