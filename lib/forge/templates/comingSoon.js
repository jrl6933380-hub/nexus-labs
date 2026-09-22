export default {
  id: 'coming-soon',
  name: 'Coming Soon / Waitlist Page',
  category: 'general',
  keywords: ['coming soon', 'waitlist', 'launching soon', 'under construction', 'notify me', 'pre-launch'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nova — Coming Soon</title>
<style>
  :root { --accent:#7c4dff; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; background:radial-gradient(circle at 30% 20%,#1e1440,#0c0a18); color:#fff; text-align:center; }
  .wrap { padding:24px; max-width:520px; }
  .badge { display:inline-block; background:rgba(124,77,255,0.18); color:#b79dff; border:1px solid rgba(124,77,255,0.4); padding:6px 16px; border-radius:999px; font-size:0.8rem; margin-bottom:24px; }
  h1 { font-size:2.6rem; margin-bottom:14px; }
  p { color:#b9b5c9; margin-bottom:32px; font-size:1.05rem; }
  .signup { display:flex; gap:8px; }
  .signup input { flex:1; padding:14px; border-radius:8px; border:1px solid #3a3260; background:#171129; color:#fff; }
  .signup button { background:var(--accent); color:#fff; border:none; padding:14px 22px; border-radius:8px; font-weight:700; cursor:pointer; }
  .countdown { display:flex; gap:20px; justify-content:center; margin-top:40px; }
  .countdown div { min-width:60px; }
  .countdown .n { font-size:1.6rem; font-weight:700; }
  .countdown .l { font-size:0.75rem; color:#8a84a3; text-transform:uppercase; letter-spacing:1px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="badge">Launching Soon</div>
  <h1>Something new is on the way.</h1>
  <p>We're putting the finishing touches on Nova. Leave your email and we'll let you know the moment it's live.</p>
  <div class="signup"><input type="email" placeholder="you@email.com"><button>Notify Me</button></div>
  <div class="countdown">
    <div><div class="n">14</div><div class="l">Days</div></div>
    <div><div class="n">06</div><div class="l">Hours</div></div>
    <div><div class="n">32</div><div class="l">Min</div></div>
  </div>
</div>
</body>
</html>`,
};
