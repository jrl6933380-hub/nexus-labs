// Approved pricing comes from the same rules used by Forge signup and billing.
import {TIERS} from './forgeProgram.js';
import {generatePitchScript as buildPitch} from '../public/forge-pitch.js';
export {websiteFinding} from '../public/forge-pitch.js';
export function generatePitchScript(lead) {
  const offer = {tiers: Object.entries(TIERS).map(([key, tier]) => ({
    key, name: key[0].toUpperCase() + key.slice(1), priceCents: tier.priceCents,
    editsPerMonth: Number.isFinite(tier.editsPerMonth) ? tier.editsPerMonth : null,
    aiAssistant: tier.aiAssistant,
  }))};
  return buildPitch(lead, offer);
}
