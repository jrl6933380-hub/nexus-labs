import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePitchScript, websiteFinding} from '../lib/forgePitch.js';
import {generatePitchScript as clientPitch} from '../public/forge-pitch.js';
import {TIERS} from '../lib/forgeProgram.js';
const base={businessName:'Hickman Barber Shop',category:'barbers',websiteStatus:'no_dedicated_site_found',siteStatus:'none',research:{identity_confirmed:true,website_confirmed:true,checked_at:'2026-11-05T11:00:00Z'}};
test('no-site pitch describes dated findings without assuming an existing site',()=>{
 const p=generatePitchScript(base),text=JSON.stringify(p);
 assert.match(p.opener,/local barbershops/);assert.doesNotMatch(text,/barbers businesses|no_dedicated_site_found|last time the website was updated|A lot of owners|takes bookings|follows up/);
 assert.match(p.weaknesses.join(' '),/couldn’t find.*checked 2026-11-05/);assert.match(p.weaknesses.join(' '),/hours, services, photos and contact/);
 assert.match(p.discoveryQuestions.join(' '),/website we may have missed/);
 assert.match(p.demoLine,/can put together/);assert.doesNotMatch(p.demoLine,/ready|had our system/);
});
test('social, unknown and existing-site findings stay distinct; site URLs override stale negative status',()=>{
 assert.equal(websiteFinding({...base,website:'https://example.com'}),'present');
 assert.equal(websiteFinding({...base,placesWebsite:'https://example.com'}),'present');
 const existing=generatePitchScript({...base,website:'https://example.com'});assert.match(existing.discoveryQuestions.join(' '),/current website.*better/);assert.doesNotMatch(existing.weaknesses.join(' '),/couldn’t find/);
 assert.match(generatePitchScript({...base,websiteStatus:'social_booking_only'}).weaknesses[0],/social or booking pages/);
 for(const status of ['needs_checking','arbitrary_internal_value',null]){const p=generatePitchScript({...base,websiteStatus:status});assert.match(p.weaknesses[0],/needs checking/);assert.match(p.discoveryQuestions.join(' '),/Do you have a website/);assert.doesNotMatch(JSON.stringify(p),/arbitrary_internal_value/);}
 const unreviewed=generatePitchScript({...base,research:{checked_at:base.research.checked_at}});assert.doesNotMatch(unreviewed.weaknesses[0],/checked 2026/);
});
test('preview language follows actual usable preview state, including rebuilds and errors',()=>{
 for(const siteStatus of ['none','error','ready',undefined])assert.match(generatePitchScript({...base,siteStatus,siteHtml:''}).demoLine,/can put together/);
 const ready=generatePitchScript({...base,siteStatus:'ready',siteHtml:'<h1>Concept</h1>'});assert.match(ready.demoLine,/preview.*ready here/);assert.match(ready.nextStep,/preview is a fit/);
 const rebuilding=generatePitchScript({...base,siteStatus:'generating',siteHtml:'<h1>Old preview</h1>'});assert.match(rebuilding.demoLine,/still being prepared/);assert.doesNotMatch(rebuilding.demoLine,/ready here/);
});
test('approved offer uses billing tiers and survives browser updates without a model',()=>{
 const server=generatePitchScript(base);const tier=TIERS.launch;const offer=server.offer.tiers[0];assert.equal(offer.priceCents,tier.priceCents);assert.equal(offer.aiAssistant,tier.aiAssistant);
 assert.deepEqual(clientPitch(base,server.offer),server);assert.match(server.pricingLine,/unlimited website edits/);
 assert.deepEqual(server.offer.tiers.map(t=>t.key),['launch']);
 assert.match(server.pricingLine,/\$20 total at signup including the first month, then \$10\/month/);
 assert.doesNotMatch(server.pricingLine,/Basic:|Standard:|Plus:/);
 assert.match(server.objections.find(x=>x.objection==='We already have a website.').response,/website address.*update our notes/);
 const declined=server.objections.find(x=>x.objection==='We’re not interested.').response;assert.doesNotMatch(declined,/send|anyway/);assert.match(declined,/no further calls/);
 assert.match(clientPitch(base).pricingLine,/Check the approved Forge offer/);
});
