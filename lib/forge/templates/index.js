// lib/forge/templates/index.js
//
// A curated set of starter templates so a common request doesn't ask the
// model to write a whole page from nothing. Matching a request to one of
// these shrinks the model's job from "design and build a complete page" to
// "customize this working page for this specific business" \u2014 which is
// faster, cheaper, and far more forgiving of a weaker (e.g. free-tier)
// model, since there's much less room to go wrong.
//
// Matching is deliberately not an LLM call: a plain keyword-overlap score
// against the request text is free, instant, and good enough for the
// common, clearly-named cases this is meant to catch ("landing page for my
// plumbing business"). Anything that doesn't clear the confidence bar falls
// through to full generation from FRESH_SYSTEM_PROMPT, same as before this
// existed \u2014 a genuinely unusual or highly specific request should never be
// forced into the nearest template.

import serviceOnePager from './serviceOnePager.js';
import restaurantMenu from './restaurantMenu.js';
import salonBooking from './salonBooking.js';
import contractorTrades from './contractorTrades.js';
import portfolio from './portfolio.js';
import landingPage from './landingPage.js';
import eventRsvp from './eventRsvp.js';
import contactForm from './contactForm.js';
import comingSoon from './comingSoon.js';
import calculatorTool from './calculatorTool.js';
import faqHelp from './faqHelp.js';
import statsDashboard from './statsDashboard.js';

export const TEMPLATES = Object.freeze([
  serviceOnePager,
  restaurantMenu,
  salonBooking,
  contractorTrades,
  portfolio,
  landingPage,
  eventRsvp,
  contactForm,
  comingSoon,
  calculatorTool,
  faqHelp,
  statsDashboard,
]);

/** Minimum keyword hits before a template is trusted over full generation. */
const MIN_SCORE = 1;

function scoreTemplate(template, text) {
  let score = 0;
  for (const keyword of template.keywords) {
    if (text.includes(keyword)) score += keyword.includes(' ') ? 2 : 1; // multi-word hits are a stronger signal
  }
  return score;
}

/**
 * Picks the best-matching template for a fresh-build request, or null if
 * nothing clears the confidence bar. Only ever called for a fresh build
 * (no currentHtml) \u2014 an edit to an existing page has nothing to do with
 * template selection.
 */
export function matchTemplate(requestText) {
  if (!requestText) return null;
  const text = requestText.toLowerCase();

  let best = null;
  let bestScore = 0;
  for (const template of TEMPLATES) {
    const score = scoreTemplate(template, text);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}

export function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}
