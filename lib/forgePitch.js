// Approved pricing comes from the same rules used by Forge signup and billing.
import {TIERS,LAUNCH_OFFER} from './forgeProgram.js';
import {generatePitchScript as buildPitch} from '../public/forge-pitch.js';
export {websiteFinding} from '../public/forge-pitch.js';
export function generatePitchScript(lead) {
  // Only the launch offer is selectable for NEW caller-led customers; the
  // legacy tiers remain valid on existing client subscriptions.
  const tier = TIERS.launch;
  const offer = {tiers:[{
    key:'launch',name:'Launch',priceCents:tier.priceCents,signUpCents:LAUNCH_OFFER.signUpCents,
    editsPerMonth:null,editsPromoLabel:'unlimited minor edits during launch',aiAssistant:false,
  }]};
  return buildPitch(lead, offer);
}
