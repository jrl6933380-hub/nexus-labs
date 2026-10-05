export default {
  id: 'restaurant-menu',
  name: 'Restaurant / Menu Site',
  category: 'local-service',
  keywords: ['restaurant', 'cafe', 'coffee shop', 'diner', 'menu', 'bakery', 'pizzeria', 'food truck', 'bar', 'brewery', 'takeout', 'catering'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Copper Spoon</title>
<style>
  :root { --accent:#a8442c; --dark:#241b16; --cream:#fbf3e7; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Georgia,'Times New Roman',serif; background:var(--cream); color:var(--dark); }
  header { background:var(--dark); color:#fbf3e7; padding:18px 24px; text-align:center; position:sticky; top:0; z-index:10; }
  header .brand { font-size:1.4rem; letter-spacing:1px; }
  nav { display:flex; justify-content:center; gap:28px; margin-top:8px; font-family:-apple-system,sans-serif; font-size:0.85rem; }
  nav a { color:#e8d9c8; text-decoration:none; }
  .hero { text-align:center; padding:72px 24px 56px; }
  .hero h1 { font-size:2.6rem; margin-bottom:12px; }
  .hero p { font-family:-apple-system,sans-serif; color:#5a4c40; max-width:520px; margin:0 auto 24px; }
  .cta { display:inline-block; background:var(--accent); color:#fff; font-family:-apple-system,sans-serif; padding:12px 26px; border-radius:6px; text-decoration:none; }
  section { max-width:800px; margin:0 auto; padding:40px 24px; }
  h2 { font-size:1.8rem; text-align:center; margin-bottom:32px; }
  .menu-group { margin-bottom:32px; }
  .menu-group h3 { border-bottom:2px solid var(--accent); display:inline-block; padding-bottom:4px; margin-bottom:16px; }
  .item { display:flex; justify-content:space-between; gap:16px; padding:10px 0; border-bottom:1px dashed #d9c7b3; font-family:-apple-system,sans-serif; }
  .item .name { font-weight:600; }
  .item .desc { color:#6b5d4f; font-size:0.85rem; display:block; }
  .item .price { white-space:nowrap; font-weight:700; }
  .info { background:var(--dark); color:#fbf3e7; text-align:center; padding:48px 24px; font-family:-apple-system,sans-serif; }
  .info .hours { margin:16px 0; }
  footer { text-align:center; padding:20px; font-family:-apple-system,sans-serif; font-size:0.8rem; color:#8a7a6a; }
</style>
</head>
<body>
<header><div class="brand">The Copper Spoon</div><nav><a href="#menu">Menu</a><a href="#hours">Hours &amp; Location</a></nav></header>
<div class="hero">
  <h1>Scratch kitchen. Neighborhood table.</h1>
  <p>Seasonal, made-from-scratch plates in the heart of downtown. Open for lunch and dinner, seven days a week.</p>
  <a href="#hours" class="cta">Order Takeout</a>
</div>
<section id="menu">
  <h2>Menu</h2>
  <div class="menu-group">
    <h3>Starters</h3>
    <div class="item"><span><span class="name">Roasted Beet Salad</span><span class="desc">Whipped goat cheese, candied walnuts, citrus vinaigrette</span></span><span class="price">$11</span></div>
    <div class="item"><span><span class="name">Charred Shishito Peppers</span><span class="desc">Sea salt, lemon aioli</span></span><span class="price">$9</span></div>
  </div>
  <div class="menu-group">
    <h3>Mains</h3>
    <div class="item"><span><span class="name">Pan-Seared Salmon</span><span class="desc">Farro, charred broccolini, herb butter</span></span><span class="price">$26</span></div>
    <div class="item"><span><span class="name">Braised Short Rib</span><span class="desc">Whipped potatoes, root vegetables</span></span><span class="price">$28</span></div>
    <div class="item"><span><span class="name">Wild Mushroom Risotto</span><span class="desc">Parmesan, truffle oil (V)</span></span><span class="price">$21</span></div>
  </div>
</section>
<section id="hours" class="info">
  <h2 style="color:#fbf3e7">Visit Us</h2>
  <div class="hours">Tue – Sun, 11:30am – 9:30pm · Closed Mondays</div>
  <div>214 Main Street, Downtown</div>
  <div>(555) 738-2200</div>
</section>
<footer>The Copper Spoon · © 2026</footer>
</body>
</html>`,
};
