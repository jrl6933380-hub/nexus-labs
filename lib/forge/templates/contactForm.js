export default {
  id: 'contact-form',
  name: 'Simple Contact / Lead-Capture Page',
  category: 'general',
  keywords: ['contact page', 'contact us', 'lead capture', 'inquiry form', 'get in touch', 'request a callback'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Get in Touch — Harbor Consulting</title>
<style>
  :root { --accent:#1c5d8c; --ink:#182430; --paper:#f5f7fa; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; color:var(--ink); background:var(--paper); }
  .wrap { max-width:960px; margin:0 auto; padding:64px 24px; display:grid; grid-template-columns:1fr 1fr; gap:48px; align-items:start; }
  .left h1 { font-size:2.1rem; margin-bottom:14px; }
  .left p { color:#4b5a6a; margin-bottom:28px; }
  .info-row { display:flex; gap:12px; margin-bottom:16px; align-items:flex-start; }
  .info-row .label { font-weight:700; min-width:80px; font-size:0.9rem; }
  .info-row .val { color:#4b5a6a; font-size:0.9rem; }
  .card { background:#fff; border-radius:16px; padding:32px; box-shadow:0 1px 6px rgba(0,0,0,0.06); }
  .field { margin-bottom:16px; }
  .field label { display:block; font-size:0.85rem; margin-bottom:6px; color:#374151; }
  .field input, .field textarea, .field select { width:100%; padding:11px; border:1px solid #d1d9e0; border-radius:8px; font-family:inherit; font-size:0.95rem; }
  .submit { width:100%; background:var(--accent); color:#fff; border:none; padding:13px; border-radius:8px; font-weight:700; cursor:pointer; }
  @media (max-width:720px) { .wrap { grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="left">
    <h1>Let's talk about your project</h1>
    <p>Tell us a bit about what you need and we'll get back to you within one business day.</p>
    <div class="info-row"><span class="label">Email</span><span class="val">hello@harborconsulting.com</span></div>
    <div class="info-row"><span class="label">Phone</span><span class="val">(555) 610-4420</span></div>
    <div class="info-row"><span class="label">Office</span><span class="val">400 Bayview Ave, Suite 210</span></div>
    <div class="info-row"><span class="label">Hours</span><span class="val">Mon–Fri, 9am–5pm</span></div>
  </div>
  <div class="card">
    <div class="field"><label>Name</label><input placeholder="Your full name"></div>
    <div class="field"><label>Email</label><input type="email" placeholder="you@email.com"></div>
    <div class="field"><label>What can we help with?</label><select><option>General inquiry</option><option>Request a quote</option><option>Support</option></select></div>
    <div class="field"><label>Message</label><textarea rows="4" placeholder="Tell us more"></textarea></div>
    <button class="submit">Send Message</button>
  </div>
</div>
</body>
</html>`,
};
