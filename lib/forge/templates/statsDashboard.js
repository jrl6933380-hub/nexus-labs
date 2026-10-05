export default {
  id: 'stats-dashboard',
  name: 'Basic Dashboard / Stats Display',
  category: 'interactive',
  keywords: ['dashboard', 'stats page', 'analytics display', 'admin panel', 'metrics page', 'overview page'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overview — Dashboard</title>
<style>
  :root { --accent:#4f46e5; --ink:#111827; --paper:#f3f4f6; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; background:var(--paper); color:var(--ink); }
  header { background:#fff; border-bottom:1px solid #e5e7eb; padding:16px 28px; display:flex; justify-content:space-between; align-items:center; }
  .brand { font-weight:700; }
  main { max-width:1080px; margin:0 auto; padding:28px 24px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:28px; }
  .card { background:#fff; border-radius:12px; padding:20px; border:1px solid #e5e7eb; }
  .card .label { font-size:0.8rem; color:#6b7280; margin-bottom:6px; }
  .card .num { font-size:1.7rem; font-weight:800; }
  .card .delta { font-size:0.8rem; margin-top:4px; }
  .delta.up { color:#16a34a; }
  .delta.down { color:#dc2626; }
  .panel { background:#fff; border-radius:12px; border:1px solid #e5e7eb; padding:24px; margin-bottom:20px; }
  .panel h2 { font-size:1rem; margin-bottom:16px; }
  .bars { display:flex; align-items:flex-end; gap:10px; height:160px; }
  .bars .bar { flex:1; background:var(--accent); border-radius:4px 4px 0 0; opacity:0.85; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:10px 8px; border-bottom:1px solid #f3f4f6; font-size:0.9rem; }
  th { color:#6b7280; font-weight:600; font-size:0.8rem; text-transform:uppercase; }
</style>
</head>
<body>
<header><div class="brand">Overview</div><div>Last 30 days</div></header>
<main>
  <div class="cards">
    <div class="card"><div class="label">Total Visitors</div><div class="num">12,480</div><div class="delta up">↑ 8.2%</div></div>
    <div class="card"><div class="label">Signups</div><div class="num">642</div><div class="delta up">↑ 3.1%</div></div>
    <div class="card"><div class="label">Revenue</div><div class="num">$18,240</div><div class="delta up">↑ 11.5%</div></div>
    <div class="card"><div class="label">Churn</div><div class="num">2.1%</div><div class="delta down">↓ 0.4%</div></div>
  </div>
  <div class="panel">
    <h2>Daily Signups</h2>
    <div class="bars">
      <div class="bar" style="height:40%"></div><div class="bar" style="height:65%"></div><div class="bar" style="height:50%"></div><div class="bar" style="height:80%"></div><div class="bar" style="height:60%"></div><div class="bar" style="height:90%"></div><div class="bar" style="height:75%"></div>
    </div>
  </div>
  <div class="panel">
    <h2>Recent Activity</h2>
    <table>
      <tr><th>User</th><th>Action</th><th>Time</th></tr>
      <tr><td>dana@email.com</td><td>Upgraded to Pro</td><td>2 min ago</td></tr>
      <tr><td>lee@email.com</td><td>Created project</td><td>18 min ago</td></tr>
      <tr><td>omar@email.com</td><td>Signed up</td><td>1 hr ago</td></tr>
    </table>
  </div>
</main>
</body>
</html>`,
};
