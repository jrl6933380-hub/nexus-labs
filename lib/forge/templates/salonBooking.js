export default {
  id: 'salon-booking',
  name: 'Salon / Spa / Fitness Booking Page',
  category: 'local-service',
  keywords: ['salon', 'spa', 'hair stylist', 'barbershop', 'nail salon', 'massage', 'yoga studio', 'gym', 'personal trainer', 'fitness studio', 'esthetician', 'barber'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumen Studio</title>
<style>
  :root { --accent:#c9738a; --ink:#2b2320; --paper:#fff8f6; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; color:var(--ink); background:var(--paper); }
  header { display:flex; justify-content:space-between; align-items:center; padding:20px 32px; }
  .brand { font-size:1.3rem; font-weight:700; letter-spacing:0.5px; }
  nav a { color:var(--ink); text-decoration:none; margin-left:22px; font-size:0.9rem; }
  .cta { background:var(--accent); color:#fff !important; padding:10px 20px; border-radius:999px; }
  .hero { text-align:center; padding:56px 24px; }
  .hero h1 { font-size:2.3rem; margin-bottom:14px; }
  .hero p { color:#5c5049; max-width:480px; margin:0 auto 24px; }
  section { max-width:1000px; margin:0 auto; padding:48px 24px; }
  h2 { text-align:center; font-size:1.6rem; margin-bottom:28px; }
  .services { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:18px; }
  .svc { background:#fff; border-radius:14px; padding:22px; box-shadow:0 1px 3px rgba(0,0,0,0.06); }
  .svc .row { display:flex; justify-content:space-between; font-weight:600; margin-bottom:6px; }
  .svc p { color:#6b5f57; font-size:0.9rem; }
  .book { background:var(--accent); border-radius:20px; padding:48px 24px; text-align:center; color:#fff; }
  .book a { display:inline-block; margin-top:18px; background:#fff; color:var(--accent); font-weight:700; padding:14px 30px; border-radius:999px; text-decoration:none; }
  footer { text-align:center; padding:24px; color:#8a7d75; font-size:0.85rem; }
  @media (max-width:640px) { nav a:not(.cta) { display:none; } }
</style>
</head>
<body>
<header><div class="brand">Lumen Studio</div><nav><a href="#services">Services</a><a href="#book" class="cta">Book Now</a></nav></header>
<div class="hero"><h1>Look good. Feel better.</h1><p>Hair, skin, and self-care in a calm, modern space downtown.</p><a href="#book" class="cta">Book an Appointment</a></div>
<section id="services">
  <h2>Services &amp; Pricing</h2>
  <div class="services">
    <div class="svc"><div class="row"><span>Signature Cut</span><span>$65</span></div><p>Consultation, wash, cut, and style.</p></div>
    <div class="svc"><div class="row"><span>Color &amp; Highlights</span><span>from $120</span></div><p>Full color, balayage, or highlights.</p></div>
    <div class="svc"><div class="row"><span>60-Min Facial</span><span>$95</span></div><p>Deep cleanse, exfoliation, and hydration.</p></div>
    <div class="svc"><div class="row"><span>Swedish Massage</span><span>$110</span></div><p>60 minutes of full-body relaxation.</p></div>
  </div>
</section>
<section id="book">
  <div class="book">
    <h2 style="color:#fff">Ready to book?</h2>
    <p>Call, text, or stop by — walk-ins welcome when we have room.</p>
    <a href="tel:5557301199">(555) 730-1199</a>
  </div>
</section>
<footer>Lumen Studio · 88 Elm Street · Tue–Sat 9am–6pm</footer>
</body>
</html>`,
};
