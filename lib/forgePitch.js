// lib/forgePitch.js
// Per-lead pitch/objection card (MVP item 6). Template-based, not a
// model call — it only uses facts the lead record actually has
// (websiteStatus, category, talkingPoints), so it can't invent claims
// about a business the way a free-form LLM pitch generator could.
// "Script to vibe off of," not a word-for-word read.

function weaknessLines(lead) {
  const lines = [];
  if (lead.websiteStatus) lines.push(`Current site: ${lead.websiteStatus}.`);
  if (Array.isArray(lead.talkingPoints)) lines.push(...lead.talkingPoints);
  if (!lines.length) lines.push('No specific site weaknesses on file yet — lean on discovery questions below.');
  return lines;
}

export function generatePitchScript(lead) {
  const name = lead.businessName;
  const category = lead.category ? ` ${lead.category}` : '';

  return {
    opener: `Hi, this is [you] — I help local${category} businesses like ${name} get found online. Got 60 seconds?`,
    weaknesses: weaknessLines(lead),
    discoveryQuestions: [
      `How are most new customers finding ${name} right now?`,
      "When's the last time the website was updated?",
      'Does the site work well for people booking or calling from their phone?',
    ],
    demoLine: `I actually had our system put together a quick preview of what a new site for ${name} could look like — want me to pull it up while we talk?`,
    objections: [
      { objection: 'We already have a website.', response: 'Totally fair — this isn’t about replacing it overnight, just showing what’s possible. Mind if I show you the preview real quick?' },
      { objection: 'We’re not interested.', response: 'No worries at all — mind if I send over the preview anyway in case it’s useful down the road?' },
      { objection: 'How much does this cost?', response: 'Depends on what you need — happy to walk through pricing once you’ve seen the preview and know if it’s a fit.' },
    ],
    upsell: `Once the site's live, we can also add an AI assistant right on it — answers visitor questions, takes bookings, follows up on leads automatically. A lot of owners like ${name} end up wanting that once they see the base site.`,
    nextStep: 'Book a 15-minute follow-up call once they’ve seen the preview, or get a decision-maker’s best callback time.',
  };
}
