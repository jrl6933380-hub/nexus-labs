import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateServiceVariants, renderServiceTemplate, normalizeServiceBusiness } from '../public/forge-service-templates.js';

test('three standalone directions preserve business facts but use different section sequences', () => {
  const lead = { businessName:'Client studio',category:'Nail salon',location:'Jefferson, IA',phone:'515-555-0100',siteContent:{ services:[{name:'Gel manicure',price:'$45',duration:'45 min'}] } };
  const variants = generateServiceVariants(lead);
  assert.deepEqual(variants.map(v=>v.id),['editorial','bold','fresh']);
  for(const v of variants){
    assert.match(v.html,/^<!DOCTYPE html>/);assert.match(v.html,/Client studio/);assert.match(v.html,/Gel manicure/);assert.match(v.html,/\$45/);assert.match(v.html,/45 min/);
    assert.match(v.html,/SAMPLE PREVIEW/);assert.match(v.html,/No availability is checked/);assert.ok(v.html.length<50000);
    assert.match(v.html,/<dialog id="booking"/);assert.match(v.html,/id="services"/);assert.match(v.html,/id="work"/);assert.match(v.html,/id="visit"/);
    assert.doesNotMatch(v.html,/localStorage|sessionStorage|fetch\(|XMLHttpRequest|<script[^>]+src=/);
    assert.doesNotMatch(v.html,/Sample service<\/span>/);
  }
  assert.ok(variants[0].html.indexOf('id="about"')<variants[0].html.indexOf('id="work"'));
  assert.ok(variants[1].html.indexOf('id="work"')<variants[1].html.indexOf('id="services"'));
  assert.ok(variants[2].html.indexOf('id="work"')<variants[2].html.indexOf('id="about"'));
});

test('missing facts produce explicit slots and sample services, never invented quotes or hours',()=>{
  const html=renderServiceTemplate({businessName:'Real business',category:'Barber'});
  assert.match(html,/Sample service/);assert.match(html,/Ask for pricing/);assert.match(html,/Opening hours to be confirmed/);
  assert.match(html,/Portfolio photo slot/);assert.doesNotMatch(html,/<img|<blockquote|five.star|9 AM|10 AM/i);
  assert.match(html,/Beard detail/);assert.doesNotMatch(html,/Signature manicure/);
  assert.match(renderServiceTemplate({category:'Nail salon'}),/Signature manicure/);
});

test('business text and photo attributes cannot inject executable markup',()=>{
  const html=renderServiceTemplate({businessName:'</title><script>bad()</script>',category:'<img src=x onerror=bad()>',siteContent:{ headline:'<svg onload=bad()>',intro:'" onmouseover="bad()',services:[{name:'<script>bad()</script>',price:'<b>$1</b>'}],photos:[{url:'https://example.test/photo.jpg',alt:'" onerror="bad()',credit:'<script>bad()</script>'}] }});
  assert.doesNotMatch(html,/<script>bad|<svg onload|<img src=x/);
  assert.match(html,/&lt;svg onload=bad\(\)&gt;/);assert.match(html,/alt="&quot; onerror=&quot;bad\(\)"/);
  assert.equal((html.match(/<script>/g)||[]).length,1);
});

test('photo normalization rejects executable, credentialed, insecure, and data URLs',()=>{
  const b=normalizeServiceBusiness({siteContent:{photos:[
    {url:'javascript:alert(1)'},{url:'http://example.test/a.jpg'},{url:'https://user:pass@example.test/a.jpg'},
    {url:'data:image/svg+xml,<svg onload=alert(1)>'},{url:'https://example.test/allowed.jpg',alt:'Actual work',credit:'Owner supplied'},
  ]}});
  assert.equal(b.photos.length,1);assert.equal(b.photos[0].url,'https://example.test/allowed.jpg');
  const html=renderServiceTemplate({siteContent:{photos:b.photos}});assert.match(html,/Owner supplied/);assert.match(html,/alt="Actual work"/);
});

test('input objects stay unchanged and independently generated business documents do not bleed data',()=>{
  const a={businessName:'Business Alpha',siteContent:{services:[{name:'Alpha service'}]}};const saved=structuredClone(a);
  const first=generateServiceVariants(a),second=generateServiceVariants({businessName:'Business Beta'});
  first[0].html='Edited Alpha';assert.notEqual(first[1].html,'Edited Alpha');
  assert.doesNotMatch(second[0].html,/Alpha/);assert.deepEqual(a,saved);
});

test('ratings require real numeric bounds and a positive integer review count',()=>{
  assert.doesNotMatch(renderServiceTemplate({rating:4.8}),/4\.8 \/ 5/);
  assert.doesNotMatch(renderServiceTemplate({rating:9,reviewCount:10}),/9\.0 \/ 5/);
  assert.match(renderServiceTemplate({rating:4.8,reviewCount:10}),/4\.8 \/ 5/);
  assert.match(renderServiceTemplate({rating:4.8,reviewCount:10}),/10 reviews/);
});

test('content normalization bounds records and invalid template IDs are refused',()=>{
  const b=normalizeServiceBusiness({businessName:'x'.repeat(200),siteContent:{services:Array.from({length:100},()=>({name:'s'})),hours:Array.from({length:50},()=>({day:'Day',time:'Hours'}))}});
  assert.equal(b.name.length,100);assert.equal(b.services.length,12);assert.equal(b.hours.length,7);
  assert.throws(()=>renderServiceTemplate({},'../arbitrary'),/Unknown service template/);
});
