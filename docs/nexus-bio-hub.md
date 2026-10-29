# Nexus bio hub

Entry: `/start.html`. This is a small, public, buildless front door for mixed TikTok traffic, with no signup, model calls or intake submission before choosing a route.

- **Build my website** → existing `/waitlist.html` intake, including its preview and builder-wake behavior.
- **Explore AI tools** → existing `/marketplace.html` catalog, which opens the selected actor directly.
- Competitor Research: `/research.html`, with a prominent link to the full marketplace in addition to its existing footer link.

Design: evergreen canvas, warm white type, restrained Nexus gold. A compact serif question introduces two large, stacked choices on phones and paired choices on desktop. The website choice is a link; the tools choice has a fixed destination link and separate motion control, with visible keyboard focus. No external assets, tracking, fabricated results or new dependencies.

Tool discovery update: the second card uses “Tools for your next move” and “Find the tool you saw in our videos—or discover something new.” A read-only catalog request supplies the exact tool names, separated by bullets in a slow leftward strip. A separate pause/resume button, hover and keyboard focus pause the strip. Reduced-motion preferences disable animation and leave a manually scrollable list. The heading and marketplace link stay fixed; the card uses a section rather than nesting a button inside a link. If catalog loading fails, the existing three real examples and marketplace link remain usable. No wallet keys or visitor query parameters are sent with the request.

The existing `joinnexuslabs.vercel.app` is a separate Vercel project's redirect to the website intake. Adding this page does not change that project or the TikTok bio. After deployment, the bio can point to `https://nexus-labs-sigma.vercel.app/start.html`; repointing the existing short address or attaching a custom domain is a separate hosting change. Do not replace the existing intake route with this hub.

For paid campaigns or platforms supporting tappable destination links, use the promoted actor's page directly. TikTok posts without that feature use the bio hub and marketplace. Keep explicit marketplace navigation on actor pages rather than relying on browser Back.
