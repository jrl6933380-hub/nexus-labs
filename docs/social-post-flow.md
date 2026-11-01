# Social Post Flow

Owner entry points: Board → Add → Social Post Flow adds a saved tool tile to the current visual workspace and opens the working flow in an in-page panel. The board remains visible and usable. The separate `/social-post-flow.html` page and planner link remain available.

The panel shows this board's saved sticky-note briefs and has a + Sticky note action. Saved notes refresh in the panel. The selected posting batch is persisted on the tool item, so reopening the board restores its context. Back to board hides the panel while retaining its current edits; switching boards checks before discarding unsaved posting edits.

Agents: use `list_nexus_visual_boards` and `read_nexus_visual_board` to read the actual phone canvas, distinct from Agent Board tasks or Board Studio kits. Read a selected board first; use `note_id` for a specific brief when there are more than 20 notes. Follow the user's current request to create ads with existing Ad Maker tools, then prepare the saved ad in this board's posting batch. A sticky note alone does not wake an agent or authorize publication. New MCP tool names require the host's catalog to refresh after deployment.

Native tool tiles accept only the allowlisted `social-post-flow` identifier and a validated optional batch ID. They cannot provide arbitrary iframe URLs or HTML. The panel loads only the trusted same-origin app route. Existing arbitrary inline visuals retain their opaque sandbox and no-network CSP. Batch-binding messages require both the exact panel window and same origin; note text is rendered as text.

Create a named batch, add saved ads / saved video files or upload multiple videos, and edit the description, hashtags and sound notes on each video branch. Select additional destinations and save that branch. The connecting lines join the video branches into a batch, then split into TikTok, Instagram and Facebook queues. Unsaved edits on other branches survive a branch save.

Each platform queue offers caption copy, video download / Web Share when available, and a platform link. Opening a platform may open its app or website depending on Android's link settings. It does not attach the video or paste its caption. Agents can use the existing paired phone controls to finish the requested posting steps. Publication requires explicit user authorization; preparing a batch or clicking Open alone is not that authorization. Posted is a manual confirmation requiring a live HTTPS URL on the matching platform. After confirmation the queue advances; other platform copies remain pending.

Saved ads without a finished MP4 may be added as references. Render them in Ads Studio before retrieving their video; the flow does not start render jobs. Temporary render-job files can expire. Saved library media is preferred. Uploads use the existing owner Nexus Lab begin/chunk/finish protocol and its storage limits. Video blobs are loaded on demand and held for the current page session.

## Existing storage and tools

No new API, model, schedule or external publishing integration is installed. Auth, owner restrictions, optimistic baselines and write deduplication remain on the existing `/api/tiktok-plans`, `/api/nexus-lab` and `/api/ad-campaigns` endpoints.

- Batch = existing planner campaign whose ID starts `sf-batch-`.
- Video branch = planner video records named `sf-<UUID>-<platform>`, one per selected platform, sharing the same UUID.
- Each record carries its own `caption`, `hashtags`, `sound`, `video_ref`, `ad_campaign_id`, `status` and eventual `post_url`. `video_ref` is a `med-` ID, `render:<job_id>`, or `ad:<campaign_id>` awaiting a render.
- Existing planner tools can read and update these records using their current baselines. Read current records first; never replace a whole batch from stale data. Existing unrelated campaigns are unchanged.
- Saving a branch updates pending copies and creates newly selected destinations. Posted copies are preserved. Destinations are additive in this first version.
- Multi-platform saves are individual optimistic writes. A partial failure retains successful records and keeps the edited fields onscreen. Reload authoritative data before retrying a conflict; there is no cross-record transaction.

Validation: `node --test test/social-post-flow.test.mjs`; `npx playwright test e2e/social-post-flow.spec.mjs`. Browser fixtures isolate planner/media APIs; they do not prove production uploads, physical Android app handoff or publication.
