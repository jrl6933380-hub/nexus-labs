export default {
  id: 'landing-page',
  name: 'Small Business / Product Landing Page',
  category: 'general',
  keywords: ['landing page', 'product launch', 'app landing page', 'saas', 'email capture', 'sign up page', 'newsletter', 'single product'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fold — Laundry, Picked Up and Delivered</title>
<style>
  :root { --accent:#0f9d78; --ink:#0e1a16; --paper:#f7fbf9; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; color:var(--ink); background:var(--paper); }
  header { display:flex; justify-content:space-between; align-items:center; padding:22px 32px; }
  .brand { font-weight:800; font-size:1.2rem; }
  .hero { max-width:640px; margin:0 auto; text-align:center; padding:60px 24px 44px; }
  .hero h1 { font-size:2.5rem; margin-bottom:16px; }
  .hero p { color:#3d4c45; font-size:1.1rem; margin-bottom:28px; }
  .signup { display:flex; gap:8px; max-width:420px; margin:0 auto; }
  .signup input { flex:1; padding:14px; border:1px solid #cfe0d8; border-radius:8px; font-size:1rem; }
  .signup button { background:var(--accent); color:#fff; border:none; padding:14px 22px; border-radius:8px; font-weight:700; cursor:pointer; }
  .fine { font-size:0.8rem; color:#7a8c83; margin-top:10px; }
  section { max-width:1000px; margin:0 auto; padding:48px 24px; }
  h2 { text-align:center; font-size:1.6rem; margin-bottom:32px; }
  .steps { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:24px; text-align:center; }
  .step .num { width:40px; height:40px; border-radius:50%; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-weight:700; }
  .banner { background:var(--ink); color:#eef6f2; text-align:center; padding:56px 24px; border-radius:20px; margin:20px; }
  .banner .signup input { background:#1a2b24; color:#fff; border-color:#2c4239; }
  footer { text-align:center; padding:22px; color:#8a9a92; font-size:0.85rem; }
</style>
</head>
<body>
<header><div class="brand">Fold</div></header>
<div class="hero">
  <h1>Laundry off your plate. For good.</h1>
  <p>We pick up, wash, fold, and deliver — back on your doorstep in 24 hours. Serving the metro area.</p>
  <div class="signup"><input type="email" placeholder="you@email.com"><button>Get Early Access</button></div>
  <p class="fine">No spam. Just a heads-up when we launch in your neighborhood.</p>
</div>
<section>
  <h2>How it works</h2>
  <div class="steps">
    <div class="step"><div class="num">1</div><h3>Schedule a pickup</h3><p>Pick a window that works for you — as soon as tomorrow.</p></div>
    <div class="step"><div class="num">2</div><h3>We wash &amp; fold</h3><p>Sorted, washed with your preferences, and folded with care.</p></div>
    <div class="step"><div class="num">3</div><h3>Delivered back to you</h3><p>Fresh laundry back at your door within 24 hours.</p></div>
  </div>
</section>
<section>
  <div class="banner">
    <h2 style="color:#eef6f2">Be first in line when we launch</h2>
    <div class="signup"><input type="email" placeholder="you@email.com"><button>Get Early Access</button></div>
  </div>
</section>
<footer>Fold · © 2026</footer>
</body>
</html>`,
};
