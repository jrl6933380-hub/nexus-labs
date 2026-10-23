# TikTok planner

Owner-only planning page at `/tiktok-planner.html`, backed by `/api/tiktok-plans` and stored per account in the
same Postgres/Redis store as Ad Maker (`nexus:tiktok-plans:v1:<owner>`).

- Campaigns and videos, with stages idea > scripted > ready > scheduled > posted.
- Rules enforced on the server: ready/scheduled/posted need a caption, scheduled needs a date, posted needs the
  live TikTok link, a video is only "scoped" when its ad brief exists.
- Each video can carry a **scope**: an Ad Maker brief (`create_nexus_ad_from_brief` fields). Once scoped, **Build ad**
  composes the vocabulary ad deterministically (portrait by default, no model call) and links it to the video.
- Every edit uses a baseline (compare-and-swap) so the page, Claude and ChatGPT cannot overwrite each other.

Connector tools (owner only): `list_nexus_tiktok_plan`, `save_nexus_tiktok_campaign`, `save_nexus_tiktok_video`,
`delete_nexus_tiktok_video`, `read_nexus_tiktok_ad_scope`, `build_nexus_tiktok_ad`. After deploying, refresh the
connection's tool list in Claude/ChatGPT so the new tools appear.

Posting is manual: the poster copies the package from the Post queue, posts, pastes the live link and marks the video
posted. Nothing here posts, publishes or spends money.
