export default {
  id: 'faq-help',
  name: 'FAQ / Help Page',
  category: 'interactive',
  keywords: ['faq', 'frequently asked questions', 'help center', 'help page', 'support page', 'knowledge base'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Help Center</title>
<style>
  :root { --accent:#2563eb; --ink:#111827; --paper:#f9fafb; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; background:var(--paper); color:var(--ink); }
  header { text-align:center; padding:56px 24px 32px; }
  header h1 { font-size:2rem; margin-bottom:16px; }
  .search { max-width:480px; margin:0 auto; }
  .search input { width:100%; padding:14px 18px; border-radius:10px; border:1px solid #d1d5db; font-size:1rem; }
  main { max-width:720px; margin:0 auto; padding:24px; }
  .category { font-size:0.8rem; text-transform:uppercase; letter-spacing:1px; color:var(--accent); margin:32px 0 12px; font-weight:700; }
  details { background:#fff; border:1px solid #e5e7eb; border-radius:10px; margin-bottom:10px; overflow:hidden; }
  summary { padding:16px 18px; cursor:pointer; font-weight:600; list-style:none; display:flex; justify-content:space-between; align-items:center; }
  summary::after { content:'+'; color:#9ca3af; font-size:1.2rem; }
  details[open] summary::after { content:'−'; }
  details p { padding:0 18px 18px; color:#4b5563; font-size:0.92rem; line-height:1.6; }
  .contact { text-align:center; padding:48px 24px; }
  .contact a { display:inline-block; margin-top:14px; background:var(--accent); color:#fff; padding:12px 26px; border-radius:8px; text-decoration:none; }
</style>
</head>
<body>
<header><h1>How can we help?</h1><div class="search"><input placeholder="Search for an answer..."></div></header>
<main>
  <div class="category">Getting Started</div>
  <details open><summary>How do I create an account?</summary><p>Click "Sign Up" in the top right corner, enter your email and password, and verify your email to get started.</p></details>
  <details><summary>Is there a free plan?</summary><p>Yes — our free plan includes core features with no credit card required. You can upgrade any time.</p></details>
  <div class="category">Billing</div>
  <details><summary>How do I update my payment method?</summary><p>Go to Settings → Billing and click "Update Payment Method" to add or change your card.</p></details>
  <details><summary>Can I get a refund?</summary><p>We offer a 14-day money-back guarantee on all paid plans. Contact support to request one.</p></details>
  <div class="category">Troubleshooting</div>
  <details><summary>I forgot my password</summary><p>Click "Forgot password" on the login screen and follow the email instructions to reset it.</p></details>
</main>
<section class="contact"><h2>Still need help?</h2><p>Our support team typically responds within a few hours.</p><a href="mailto:support@example.com">Contact Support</a></section>
</body>
</html>`,
};
