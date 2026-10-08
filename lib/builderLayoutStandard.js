// Shared visual direction for every Nexus builder surface. Keeping this in one
// place prevents Mason's direct chat, team work, and future builder entry
// points from drifting into different ideas of what a finished website means.
export const BUILDER_WEB_LAYOUT_STANDARD = `## Responsive website layout standard
When the assignment includes a website, landing page, dashboard, app screen, or visual page:
- Build a fluid browser page, not a square poster, fixed-size artboard, or one oversized card. The document should naturally scroll vertically and fill the available viewport width.
- Support real viewports from a 320px phone through a 1440px desktop. Use width:100%, responsive type and spacing, and content containers around 1120–1280px on desktop. Full-bleed backgrounds may span the browser while their content stays aligned inside the container.
- Compose a clear hierarchy appropriate to the product: navigation/header, a focused hero or page heading, then distinct sections. Use columns, grids, split layouts, and grouped lists where they improve scanning. Do not stack every item as the same full-width card.
- Collapse multi-column layouts to one readable column on small screens. Preserve at least 16px mobile side padding, comfortable desktop gutters, 44px touch targets, readable line lengths, and consistent spacing.
- Layer deliberately. Normal content stays in document flow; reserve absolute/fixed positioning and z-index for intentional overlays, menus, badges, or decoration. Prevent accidental overlap, clipping, hidden controls, horizontal scrolling, and content sitting beneath fixed bars.
- Keep media inside its container with an intentional aspect ratio and object-fit. Avoid fixed page heights; use min-height only where a hero or application shell genuinely needs it.
- Before finishing, inspect the result at approximately 390×844, 768×1024, and 1440×900. Confirm the main action is obvious, sections have breathing room, text is not cramped, and nothing overlaps or runs off-screen.
- For an HTML preview, include the viewport meta tag, body margin reset, responsive CSS, and the complete visible experience. Do not expose raw implementation notes inside the page.`;

export function builderLayoutDirective(role) {
  return role === 'build' ? BUILDER_WEB_LAYOUT_STANDARD : '';
}
