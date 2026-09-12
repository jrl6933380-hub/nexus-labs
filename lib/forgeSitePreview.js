// lib/forgeSitePreview.js
// Auto-generates (and live-edits) a demo website for a lead — MVP
// item 5. Same model and endpoint api/room-chat.js uses for the
// customer-facing builder, but non-streaming: this is a single
// request/response from a simple caller page, not a chat UI with a
// progress dock. That trades away room-chat's progress messages and
// patch-format edits for a much simpler call site — acceptable at
// this volume (one generation per lead, occasional live edits), worth
// revisiting if this becomes as high-traffic as the main builder.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

const GENERATE_SYSTEM_PROMPT = `You build a real, complete, self-contained one-page website as a sales demo for a local business, based on the business facts given to you.

Respond with ONLY one complete HTML document, starting with <!DOCTYPE html> and nothing before or after it — no explanation, no markdown fences, no commentary.

Rules:
- Put all CSS in a <style> tag and all JS in a <script> tag, both inline. No external requests except optional CDN libraries.
- Never use localStorage or sessionStorage — this renders in a sandboxed iframe where they throw errors.
- Use the given business name, category, and location. For anything not given (services, hours, testimonials, imagery), invent plausible, generic placeholder content clearly in the style of that business type — but do not invent specific verifiable facts (real addresses, real phone numbers, real review quotes) beyond what was provided.
- Include a visible small banner at the very top: "SAMPLE PREVIEW — built for you by Nexus Forge", so it is never mistaken for the business's real site.
- Make it genuinely attractive and complete for a single page: hero section, a few service/offering highlights, a simple contact section. Real styling, not a wireframe.`;

const EDIT_SYSTEM_PROMPT = `You are live-editing an existing single-page HTML sales demo while a salesperson is on the phone with the business owner, based on their spoken feedback.

Respond with ONLY the complete updated HTML document, starting with <!DOCTYPE html> and nothing before or after it — no explanation, no markdown fences.

Keep the "SAMPLE PREVIEW — built for you by Nexus Forge" banner at the top. Keep everything the person didn't ask to change exactly as it was. Never use localStorage or sessionStorage.`;

async function callClaude(system, userContent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100_000);
  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `Anthropic request failed (${response.status}).`);
    const text = (data.content || []).map((block) => block.text || '').join('');
    const start = text.indexOf('<!DOCTYPE html>');
    if (start === -1) throw new Error('Model did not return an HTML document.');
    return text.slice(start).trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function generateSiteHtml(lead) {
  const facts = [
    `Business name: ${lead.businessName}`,
    lead.category ? `Category: ${lead.category}` : null,
    lead.location ? `Location: ${lead.location}` : null,
    lead.websiteStatus ? `Current website status: ${lead.websiteStatus}` : null,
  ].filter(Boolean).join('\n');
  return callClaude(GENERATE_SYSTEM_PROMPT, `Build the demo site for:\n${facts}`);
}

export async function editSiteHtml(currentHtml, instruction) {
  if (typeof instruction !== 'string' || !instruction.trim()) {
    throw new Error('instruction is required.');
  }
  return callClaude(
    EDIT_SYSTEM_PROMPT,
    `Current HTML:\n${currentHtml}\n\nRequested change:\n${instruction.trim()}`
  );
}
