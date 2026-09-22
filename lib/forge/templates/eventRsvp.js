export default {
  id: 'event-rsvp',
  name: 'Event / Wedding / One-off Page',
  category: 'general',
  keywords: ['wedding', 'wedding website', 'rsvp', 'event page', 'birthday party', 'baby shower', 'anniversary', 'reunion', 'save the date'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maya &amp; Theo — September 12, 2026</title>
<style>
  :root { --accent:#a67c52; --ink:#2b2620; --paper:#fdf9f3; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Georgia,serif; color:var(--ink); background:var(--paper); text-align:center; }
  .hero { padding:80px 24px 40px; }
  .hero .names { font-size:3rem; margin-bottom:10px; }
  .hero .amp { color:var(--accent); }
  .hero .date { font-family:-apple-system,sans-serif; letter-spacing:2px; text-transform:uppercase; font-size:0.85rem; color:#7a6f5f; }
  .divider { width:60px; height:2px; background:var(--accent); margin:28px auto; }
  section { max-width:640px; margin:0 auto; padding:36px 24px; font-family:-apple-system,sans-serif; }
  h2 { font-family:Georgia,serif; font-size:1.6rem; margin-bottom:16px; }
  .details { display:grid; grid-template-columns:1fr 1fr; gap:20px; text-align:left; margin-top:20px; }
  .details .box { background:#fff; border-radius:12px; padding:20px; border:1px solid #ecdfcc; }
  .details .box h3 { font-family:Georgia,serif; margin-bottom:6px; }
  .details .box p { color:#5c5245; font-size:0.9rem; }
  .rsvp { background:var(--ink); color:#fdf9f3; border-radius:20px; padding:48px 24px; margin:20px; }
  .rsvp form { max-width:360px; margin:20px auto 0; text-align:left; }
  .rsvp input, .rsvp select { width:100%; padding:12px; margin-bottom:12px; border-radius:8px; border:none; }
  .rsvp button { width:100%; background:var(--accent); color:#fff; border:none; padding:14px; border-radius:8px; font-weight:700; font-family:-apple-system,sans-serif; cursor:pointer; }
  footer { padding:24px; color:#a89a85; font-size:0.85rem; font-family:-apple-system,sans-serif; }
</style>
</head>
<body>
<div class="hero">
  <div class="names">Maya <span class="amp">&amp;</span> Theo</div>
  <div class="date">September 12, 2026 · Asheville, NC</div>
</div>
<div class="divider"></div>
<section>
  <h2>We're getting married</h2>
  <p>We can't wait to celebrate with the people we love most. Details below — please RSVP by August 1st.</p>
  <div class="details">
    <div class="box"><h3>Ceremony</h3><p>4:00 PM<br>Willow Creek Gardens</p></div>
    <div class="box"><h3>Reception</h3><p>6:00 PM<br>The Barn at Willow Creek</p></div>
  </div>
</section>
<section class="rsvp">
  <h2 style="color:#fdf9f3">RSVP</h2>
  <p>Let us know if you'll be joining us.</p>
  <form>
    <input placeholder="Full name">
    <select><option>Joyfully accepts</option><option>Regretfully declines</option></select>
    <input placeholder="Number of guests">
    <button type="button">Send RSVP</button>
  </form>
</section>
<footer>With love, Maya &amp; Theo</footer>
</body>
</html>`,
};
