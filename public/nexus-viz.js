// Shared, dependency-free result visuals for Nexus actor pages. Everything is built with textContent
// (never innerHTML), so customer-typed or agent-written text can never inject markup.
// Works with existing saved results: it only reads fields the result already has.
(function(){
  var css=''
  +'.nv{margin:16px 0}'
  +'.nv-h{font-size:16px;font-weight:700;margin:0 0 8px}'
  +'.nv-card{border:1px solid rgba(127,127,127,.28);border-radius:14px;padding:14px;background:rgba(127,127,127,.07)}'
  +'.nv-row{display:grid;grid-template-columns:minmax(80px,34%) 1fr auto;gap:10px;align-items:center;margin:9px 0;font-size:14px}'
  +'.nv-name{overflow-wrap:anywhere}'
  +'.nv-track{height:14px;border-radius:999px;background:rgba(127,127,127,.2);overflow:hidden}'
  +'.nv-bar{height:100%;border-radius:999px;background:linear-gradient(90deg,#00a39c,#25f4ee);width:0;transition:width .7s ease}'
  +'.nv-bar.warn{background:linear-gradient(90deg,#c8102e,#fe2c55)}'
  +'.nv-val{font-weight:700;white-space:nowrap;font-size:13px}'
  +'.nv-note{font-size:12px;opacity:.7;margin:8px 0 0}'
  +'.nv-split{display:flex;height:18px;border-radius:999px;overflow:hidden;margin:6px 0}'
  +'.nv-split i{display:block;height:100%}'
  +'.nv-legend{display:flex;justify-content:space-between;font-size:13px;gap:8px;flex-wrap:wrap}'
  +'.nv-plan{counter-reset:nv;list-style:none;margin:0;padding:0}'
  +'.nv-step{counter-increment:nv;display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:start;margin:10px 0;padding:12px;border:1px solid rgba(127,127,127,.28);border-radius:14px;background:rgba(127,127,127,.07)}'
  +'.nv-step::before{content:counter(nv);display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#c8102e;color:#fff;font-weight:700}'
  +'.nv-step label{display:flex;gap:8px;align-items:flex-start;margin:0;font-size:15px;line-height:1.4;cursor:pointer}'
  +'.nv-step input{width:auto;margin-top:3px}'
  +'.nv-step.done label span{text-decoration:line-through;opacity:.6}'
  +'.nv-gauge{display:flex;align-items:center;gap:16px}'
  +'.nv-ring{--p:0;width:96px;height:96px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--c,#00a39c) calc(var(--p)*1%),rgba(127,127,127,.22) 0)}'
  +'.nv-ring b{display:grid;place-items:center;width:74px;height:74px;border-radius:50%;background:var(--panel,var(--bg,#fff));font-size:24px}'
  +'@media(max-width:420px){.nv-row{grid-template-columns:1fr auto}.nv-track{grid-column:1/-1;order:3}}'
  +'@media(prefers-reduced-motion:reduce){.nv-bar{transition:none}}';
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  function el(t,txt,cls){var e=document.createElement(t);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;}

  // "$10/seat/mo" -> 10, "$98/year" -> 8.17 (per month), "From $15k/yr" -> 1250, "Free" -> 0. null when no price is readable.
  function parsePrice(s){
    s=String(s==null?'':s);
    if(/^\s*free\b/i.test(s))return 0;
    var m=s.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i);
    if(!m)return null;
    var v=parseFloat(m[1].replace(/,/g,''));if(!isFinite(v))return null;
    if(m[2])v*=1000;
    if(/\/\s*(yr|year)|per year|annual|yearly/i.test(s)&&!/\/\s*mo|per month|monthly/i.test(s))v/=12;
    return v;
  }

  // Horizontal bars comparing prices. rows: [{name, price}]. Needs 2+ readable prices, otherwise returns null.
  function priceBars(parent,title,rows,note){
    var pts=(rows||[]).map(function(r){return {name:r.name||r.title||'',label:r.price||'',v:parsePrice(r.price)};}).filter(function(p){return p.v!==null&&p.name;});
    if(pts.length<2)return null;
    var max=Math.max.apply(null,pts.map(function(p){return p.v;}))||1;
    var box=el('div',null,'nv'),card=el('div',null,'nv-card');
    box.appendChild(el('h2',title,'nv-h'));
    pts.slice(0,10).forEach(function(p){
      var row=el('div',null,'nv-row'),track=el('div',null,'nv-track'),bar=el('div',null,'nv-bar');
      bar.style.width='0';track.appendChild(bar);
      row.appendChild(el('div',p.name,'nv-name'));row.appendChild(track);row.appendChild(el('div',p.label,'nv-val'));
      card.appendChild(row);
      requestAnimationFrame(function(){requestAnimationFrame(function(){bar.style.width=Math.max(p.v/max*100,p.v===0?2:4)+'%';});});
    });
    card.appendChild(el('p',note||'Bars compare the first price on each line, per month where a yearly price was given. Check each source for exact terms.','nv-note'));
    box.appendChild(card);parent.appendChild(box);return box;
  }

  // Strengths vs weaknesses at a glance.
  function balance(parent,strengths,weaknesses){
    var a=(strengths||[]).length,b=(weaknesses||[]).length;
    if(!a&&!b)return null;
    var box=el('div',null,'nv'),card=el('div',null,'nv-card'),bar=el('div',null,'nv-split');
    box.appendChild(el('h2','Where they are strong and weak','nv-h'));
    var g=el('i'),r=el('i');g.style.background='#00a39c';g.style.flex=String(a||0.0001);r.style.background='#c8102e';r.style.flex=String(b||0.0001);
    bar.appendChild(g);bar.appendChild(r);card.appendChild(bar);
    var lg=el('div',null,'nv-legend');lg.appendChild(el('span',a+' strength'+(a===1?'':'s')));lg.appendChild(el('span',b+' weakness'+(b===1?'':'es')+' you can use'));
    card.appendChild(lg);box.appendChild(card);parent.appendChild(box);return box;
  }

  // Numbered to-do cards with tick boxes (kept in memory only).
  function actionPlan(parent,title,items){
    items=(items||[]).filter(Boolean);if(!items.length)return null;
    var box=el('div',null,'nv');box.appendChild(el('h2',title,'nv-h'));
    var ol=el('ol',null,'nv-plan');
    items.forEach(function(t){
      var li=el('li',null,'nv-step'),lab=el('label'),cb=el('input');cb.type='checkbox';
      cb.addEventListener('change',function(){li.classList.toggle('done',cb.checked);});
      lab.appendChild(cb);lab.appendChild(el('span',t));li.appendChild(lab);ol.appendChild(li);
    });
    box.appendChild(ol);parent.appendChild(box);return box;
  }

  // Score ring, e.g. "72 out of 100". Pulls the first score from a summary; returns null when none.
  function scoreFromText(s){var m=String(s||'').match(/\b(\d{1,3})\s*(?:\/|out of)\s*100\b/i);if(!m)return null;var n=parseInt(m[1],10);return n>=0&&n<=100?n:null;}
  function gauge(parent,score,caption){
    if(score==null)return null;
    var box=el('div',null,'nv'),card=el('div',null,'nv-card nv-gauge'),ring=el('div',null,'nv-ring');
    ring.style.setProperty('--p',String(score));ring.style.setProperty('--c',score>=70?'#00a39c':score>=40?'#d98a00':'#c8102e');
    ring.appendChild(el('b',String(score)));card.appendChild(ring);
    var t=el('div');t.appendChild(el('div','Score out of 100','nv-h'));if(caption)t.appendChild(el('div',caption,'nv-note'));
    card.appendChild(t);box.appendChild(card);parent.appendChild(box);return box;
  }

  window.NexusViz={parsePrice:parsePrice,priceBars:priceBars,balance:balance,actionPlan:actionPlan,scoreFromText:scoreFromText,gauge:gauge};
})();
