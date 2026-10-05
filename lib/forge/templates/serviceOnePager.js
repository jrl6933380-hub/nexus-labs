export default {
  id: 'service-one-pager',
  name: 'Service Business One-Pager',
  category: 'local-service',
  keywords: ['plumber', 'plumbing', 'landscaping', 'landscaper', 'lawn', 'cleaning service', 'house cleaning', 'handyman', 'electrician', 'hvac', 'pest control', 'moving company', 'movers', 'junk removal', 'pressure washing', 'painter', 'painting company', 'locksmith'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ramirez Landscaping</title>
<style>
  :root { --accent:#2f6b3a; --ink:#1c2620; --paper:#fafaf7; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,Roboto,sans-serif; color:var(--ink); background:var(--paper); line-height:1.5; }
  header { position:sticky; top:0; background:var(--paper); border-bottom:1px solid #e4e4dc; z-index:10; }
  .nav { max-width:1100px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; padding:16px 24px; }
  .brand { font-weight:700; font-size:1.15rem; }
  .nav a { color:var(--ink); text-decoration:none; margin-left:24px; font-size:0.95rem; }
  .nav-links { display:flex; align-items:center; }
  .cta { background:var(--accent); color:#fff !important; padding:10px 18px; border-radius:8px; }
  .hero { max-width:1100px; margin:0 auto; padding:64px 24px 48px; display:grid; grid-template-columns:1.1fr 1fr; gap:40px; align-items:center; }
  .hero h1 { font-size:2.4rem; line-height:1.15; margin-bottom:16px; }
  .hero p { font-size:1.1rem; color:#4a544c; margin-bottom:24px; }
  .hero-img { background:linear-gradient(135deg,#2f6b3a,#6ea35a); border-radius:16px; min-height:280px; }
  .badges { display:flex; gap:16px; margin-top:20px; font-size:0.85rem; color:#5a645c; }
  section { max-width:1100px; margin:0 auto; padding:56px 24px; }
  .services { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px; }
  .card { background:#fff; border:1px solid #e4e4dc; border-radius:12px; padding:24px; }
  .card h3 { margin-bottom:8px; }
  h2 { font-size:1.7rem; margin-bottom:28px; }
  .testimonials { background:#fff; border-radius:16px; padding:40px; }
  .quote { font-size:1.15rem; font-style:italic; margin-bottom:12px; }
  .who { color:#5a645c; font-size:0.9rem; }
  footer { background:var(--ink); color:#e9e9e3; padding:40px 24px; text-align:center; }
  .contact-box { background:var(--accent); color:#fff; border-radius:16px; padding:40px; text-align:center; }
  .contact-box a { color:#fff; }
  @media (max-width:720px) { .hero { grid-template-columns:1fr; } .nav a:not(.cta) { display:none; } }
</style>
</head>
<body>
<header><nav class="nav"><div class="brand">Ramirez Landscaping</div><div class="nav-links"><a href="#services">Services</a><a href="#reviews">Reviews</a><a href="#contact" class="cta">Free Quote</a></div></nav></header>
<div class="hero">
  <div>
    <h1>Your yard, taken care of — every season.</h1>
    <p>Mowing, cleanups, and landscape design for homes across the county. Licensed, insured, and locally owned since 2014.</p>
    <a href="#contact" class="cta">Get a Free Quote</a>
    <div class="badges"><span>✓ Licensed &amp; Insured</span><span>✓ 200+ homes served</span></div>
  </div>
  <div class="hero-img"></div>
</div>
<section id="services">
  <h2>What we do</h2>
  <div class="services">
    <div class="card"><h3>Lawn Care</h3><p>Weekly mowing, edging, and fertilization to keep your lawn healthy year-round.</p></div>
    <div class="card"><h3>Seasonal Cleanups</h3><p>Spring and fall cleanups — leaves, debris, and bed prep handled in one visit.</p></div>
    <div class="card"><h3>Landscape Design</h3><p>Beds, mulch, and planting plans designed around your home and budget.</p></div>
    <div class="card"><h3>Irrigation</h3><p>Sprinkler installation and repair, tuned for water efficiency.</p></div>
  </div>
</section>
<section id="reviews">
  <h2>What neighbors say</h2>
  <div class="testimonials">
    <p class="quote">"Showed up on time, did great work, and the price was fair. Been using them for two years now."</p>
    <p class="who">— Dana M., regular customer</p>
  </div>
</section>
<section id="contact">
  <div class="contact-box">
    <h2 style="color:#fff">Ready for a free quote?</h2>
    <p style="margin-bottom:20px">Call or text and we'll get back to you same day.</p>
    <p style="font-size:1.3rem;font-weight:700">(555) 019-2244</p>
  </div>
</section>
<footer>Ramirez Landscaping · Serving the greater county area · © 2026</footer>
</body>
</html>`,
};
