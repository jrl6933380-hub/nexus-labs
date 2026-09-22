export default {
  id: 'calculator-tool',
  name: 'Simple Calculator / Quote Estimator',
  category: 'interactive',
  keywords: ['calculator', 'estimator', 'quote calculator', 'price calculator', 'mortgage calculator', 'tip calculator', 'cost estimator', 'converter'],
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project Cost Estimator</title>
<style>
  :root { --accent:#0e7c66; --ink:#111827; --paper:#f4faf8; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,sans-serif; background:var(--paper); color:var(--ink); display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  .card { background:#fff; border-radius:18px; padding:36px; max-width:420px; width:100%; box-shadow:0 4px 20px rgba(0,0,0,0.08); }
  h1 { font-size:1.4rem; margin-bottom:6px; }
  .sub { color:#6b7280; font-size:0.9rem; margin-bottom:26px; }
  .field { margin-bottom:18px; }
  .field label { display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:8px; color:#374151; }
  .field label .val { color:var(--accent); font-weight:700; }
  input[type=range] { width:100%; accent-color:var(--accent); }
  select, input[type=text] { width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; }
  .result { margin-top:24px; background:#eef8f5; border-radius:12px; padding:20px; text-align:center; }
  .result .amount { font-size:2rem; font-weight:800; color:var(--accent); }
  .result .note { font-size:0.8rem; color:#4b5f57; margin-top:4px; }
</style>
</head>
<body>
<div class="card">
  <h1>Project Cost Estimator</h1>
  <div class="sub">Get a rough estimate in seconds — final quote confirmed after a free consult.</div>
  <div class="field"><label>Project size (sq ft) <span class="val" id="sqftVal">800</span></label><input id="sqft" type="range" min="100" max="3000" step="50" value="800"></div>
  <div class="field"><label>Finish level</label><select id="finish"><option value="12">Standard</option><option value="22">Premium</option><option value="34">Luxury</option></select></div>
  <div class="field"><label>Timeline</label><select id="timeline"><option value="1">Flexible</option><option value="1.15">Within 3 months</option><option value="1.3">Rush (ASAP)</option></select></div>
  <div class="result"><div class="amount" id="amount">$9,600</div><div class="note">Estimated project cost</div></div>
</div>
<script>
  const sqft = document.getElementById('sqft');
  const sqftVal = document.getElementById('sqftVal');
  const finish = document.getElementById('finish');
  const timeline = document.getElementById('timeline');
  const amount = document.getElementById('amount');
  function recalc() {
    sqftVal.textContent = sqft.value;
    const total = Number(sqft.value) * Number(finish.value) * Number(timeline.value);
    amount.textContent = '$' + Math.round(total).toLocaleString();
  }
  [sqft, finish, timeline].forEach((el) => el.addEventListener('input', recalc));
  recalc();
</script>
</body>
</html>`,
};
