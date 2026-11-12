// Approved pricing comes from the same rules used by Forge signup and billing.
import {TIERS,LAUNCH_OFFER,launchOfferEnabled} from './forgeProgram.js';
import {generatePitchScript as buildPitch} from '../public/forge-pitch.js';
export {websiteFinding} from '../public/forge-pitch.js';
export function generatePitchScript(lead, pricing = null) {
  // Only the launch offer is selectable for NEW caller-led customers; the
  // legacy tiers remain valid on existing client subscriptions.
  const tier = TIERS.launch;
  const offer = launchOfferEnabled() ? {tiers:[{
    key:'launch',name:'Launch',priceCents:pricing?pricing.monthlyCents:tier.priceCents,signUpCents:pricing?pricing.firstChargeCents:LAUNCH_OFFER.signUpCents,
    editsPerMonth:null,editsPromoLabel:'unlimited minor edits during launch',aiAssistant:false,
  }]} : {tiers:Object.entries(TIERS).filter(([key])=>key!=='launch').map(([key,t])=>({
    key,name:key[0].toUpperCase()+key.slice(1),priceCents:t.priceCents,
    editsPerMonth:Number.isFinite(t.editsPerMonth)?t.editsPerMonth:null,
    aiAssistant:t.aiAssistant,
  }))};
  return buildPitch(lead, offer);
}
