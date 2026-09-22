export default {
  id: 'portfolio',
  name: 'Personal Portfolio',
  category: 'general',
  keywords: ['portfolio', 'personal website', 'my work', 'photographer portfolio', 'designer portfolio', 'freelancer site', 'resume site', 'personal brand'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jordan Ellis — Designer</title>
<style>
  :root { --accent:#3454d1; --ink:#111827; --paper:#ffffff; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; color:var(--ink); background:var(--paper); }
  header { display:flex; justify-content:space-between; align-items:center; padding:24px 32px; max-width:1100px; margin:0 auto; }
  .brand { font-weight:700; }
  nav a { color:#4b5563; text-decoration:none; margin-left:22px; font-size:0.9rem; }
  .hero { max-width:760px; margin:0 auto; padding:64px 24px 48px; }
  .hero h1 { font-size:2.5rem; margin-bottom:14px; }
  .hero p { color:#4b5563; font-size:1.1rem; }
  .hero .accent { color:var(--accent); }
  section { max-width:1100px; margin:0 auto; padding:40px 24px; }
  h2 { font-size:1.5rem; margin-bottom:24px; }
  .work { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:22px; }
  .piece { border-radius:12px; overflow:hidden; border:1px solid #e5e7eb; }
  .piece .thumb { aspect-ratio:16/10; background:linear-gradient(135deg,#3454d1,#7c9cf5); }
  .piece .meta { padding:16px; }
  .piece .meta h3 { font-size:1rem; margin-bottom:4px; }
  .piece .meta p { font-size:0.85rem; color:#6b7280; }
  .about { background:#f3f4f6; border-radius:16px; padding:36px; }
  .contact { text-align:center; padding:56px 24px; }
  .contact a { display:inline-block; margin-top:16px; background:var(--accent); color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; }
  footer { text-align:center; padding:22px; color:#9ca3af; font-size:0.85rem; }
</style>
</head>
<body>
<header><div class="brand">Jordan Ellis</div><nav><a href="#work">Work</a><a href="#about">About</a><a href="#contact">Contact</a></nav></header>
<div class="hero"><h1>Product designer focused on <span class="accent">clarity</span> and craft.</h1><p>I design interfaces and brand systems for startups. Currently open for freelance projects.</p></div>
<section id="work">
  <h2>Selected Work</h2>
  <div class="work">
    <div class="piece"><div class="thumb"></div><div class="meta"><h3>Finch — Banking App</h3><p>Product design, design system</p></div></div>
    <div class="piece"><div class="thumb"></div><div class="meta"><h3>Loop — Habit Tracker</h3><p>Brand identity, mobile UI</p></div></div>
    <div class="piece"><div class="thumb"></div><div class="meta"><h3>Arbor — Marketing Site</h3><p>Web design, art direction</p></div></div>
  </div>
</section>
<section id="about">
  <div class="about">
    <h2>About</h2>
    <p>I'm a designer with 7 years of experience across fintech and consumer products. I care about interfaces that feel obvious in hindsight, and I work closely with engineering to ship things that actually hold up.</p>
  </div>
</section>
<section id="contact" class="contact">
  <h2>Let's work together</h2>
  <a href="mailto:hello@jordanellis.design">hello@jordanellis.design</a>
</section>
<footer>Jordan Ellis · © 2026</footer>
</body>
</html>`,
};
