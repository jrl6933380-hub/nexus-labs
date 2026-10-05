export default {
  id: 'contractor-trades',
  name: 'Contractor / Trades Site',
  category: 'local-service',
  keywords: ['contractor', 'roofing', 'roofer', 'remodeling', 'renovation', 'construction company', 'flooring', 'fence company', 'concrete', 'masonry', 'carpenter', 'general contractor'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sturdy Point Roofing</title>
<style>
  :root { --accent:#c4501f; --ink:#20242a; --paper:#f4f5f6; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; color:var(--ink); background:var(--paper); }
  header { background:var(--ink); color:#fff; padding:16px 28px; display:flex; justify-content:space-between; align-items:center; }
  .brand { font-weight:800; font-size:1.2rem; }
  nav a { color:#d8dbe0; text-decoration:none; margin-left:20px; font-size:0.9rem; }
  .cta { background:var(--accent); color:#fff !important; padding:10px 18px; border-radius:6px; }
  .hero { background:linear-gradient(135deg,#20242a,#3a4250); color:#fff; padding:72px 28px; text-align:center; }
  .hero h1 { font-size:2.4rem; margin-bottom:14px; }
  .hero p { color:#c7ccd4; max-width:560px; margin:0 auto 26px; }
  section { max-width:1080px; margin:0 auto; padding:52px 24px; }
  h2 { font-size:1.7rem; margin-bottom:26px; text-align:center; }
  .gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; }
  .before-after { background:#dfe2e6; border-radius:10px; aspect-ratio:4/3; display:flex; align-items:center; justify-content:center; color:#6b7280; font-size:0.85rem; }
  .services { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px; margin-top:8px; }
  .card { background:#fff; border-radius:10px; padding:22px; border:1px solid #e2e4e8; }
  .quote-form { background:#fff; border-radius:14px; padding:36px; max-width:500px; margin:0 auto; box-shadow:0 1px 4px rgba(0,0,0,0.08); }
  .quote-form h2 { text-align:left; }
  .field { margin-bottom:14px; }
  .field label { display:block; font-size:0.85rem; margin-bottom:4px; color:#4b5563; }
  .field input, .field textarea { width:100%; padding:10px; border:1px solid #d1d5db; border-radius:6px; font-family:inherit; }
  .submit { background:var(--accent); color:#fff; border:none; padding:12px 24px; border-radius:6px; font-weight:600; cursor:pointer; width:100%; }
  footer { text-align:center; padding:22px; color:#6b7280; font-size:0.85rem; }
  @media (max-width:640px) { nav a:not(.cta) { display:none; } }
</style>
</head>
<body>
<header><div class="brand">Sturdy Point Roofing</div><nav><a href="#work">Our Work</a><a href="#quote" class="cta">Get a Quote</a></nav></header>
<div class="hero"><h1>Roofs built to outlast the weather.</h1><p>Full roof replacement, repair, and storm damage service across the county. Free inspections, honest quotes.</p><a href="#quote" class="cta">Request a Free Quote</a></div>
<section id="work">
  <h2>Recent Work</h2>
  <div class="gallery">
    <div class="before-after">Before / After</div>
    <div class="before-after">Before / After</div>
    <div class="before-after">Before / After</div>
  </div>
  <div class="services">
    <div class="card"><h3>Roof Replacement</h3><p>Full tear-off and re-roof with a 10-year workmanship warranty.</p></div>
    <div class="card"><h3>Storm Damage Repair</h3><p>Insurance-ready inspections and fast turnaround.</p></div>
    <div class="card"><h3>Gutter Installation</h3><p>Seamless gutters sized right for your roofline.</p></div>
  </div>
</section>
<section id="quote">
  <div class="quote-form">
    <h2>Request a Free Quote</h2>
    <div class="field"><label>Name</label><input placeholder="Your name"></div>
    <div class="field"><label>Phone</label><input placeholder="(555) 000-0000"></div>
    <div class="field"><label>What do you need done?</label><textarea rows="3" placeholder="Tell us about the job"></textarea></div>
    <button class="submit">Request Quote</button>
  </div>
</section>
<footer>Sturdy Point Roofing · Licensed &amp; Insured · (555) 402-7711</footer>
</body>
</html>`,
};
