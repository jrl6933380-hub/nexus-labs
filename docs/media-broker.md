# Media broker (find and save free stock photos and video)

Agents describe the picture or clip they want in words, get a short list of real candidates from free libraries, and save the one they pick into the Ad Maker media library with its credit. The existing renderer then uses it. No GPU or pod is involved: these are ordinary server-side calls, so it works with the pod off.

This is a first step. It finds and saves media; it does not edit, crop or score it yet.

## Tools (owner only, hidden from customers)

| Tool | Action | What it does |
|---|---|---|
| `find_nexus_media` | `find_media` | `query`, optional `kind` (photo or video), `orientation`, `limit` (1-12), `sources`. Returns candidates with id, title, creator, size, thumbnail, license and credit. Takes one from each library in turn. |
| `use_nexus_media` | `use_media` | `candidate_id` (like `pexels:photo:123`), optional `name`. Looks the id up again at the provider, downloads the file from the provider's own host, checks it, and saves it to the media library with a preview and the credit in the description. Returns the `media_id`. |

Code: `lib/mediaBroker.js`. Tests: `test/media-broker.test.mjs` (stubbed network, real media store).

## Setup

Set these as Vercel secrets (never in chat or code):

- `PEXELS_API_KEY` - free key from the Pexels API page.
- `PIXABAY_API_KEY` - free key from the Pixabay API docs page.

Openverse needs no key. A library whose key is missing is skipped and listed under `skipped`, so the tools work with any subset.

## Sources and their rules

From the providers' own pages and third-party summaries; check the current terms before relying on them.

- **Pexels** (photo and video): default key limit 200 requests per hour and 20,000 per month. Pexels and its contributors must be credited inside the platform. Do not resell unaltered copies. Copying Pexels' core function is not allowed.
- **Pixabay** (photo and video): default 500 requests per hour. Commercial use allowed; their terms ask for a link back to their license summary. Do not hotlink at scale, which is why files are downloaded and stored.
- **Openverse** (photos only): license varies per image. Search is limited to licenses that allow commercial use, and the license is returned with each result. CC BY needs the credit shown.
- **Unsplash** is not included: it needs production approval, hotlinking and download tracking.

The credit line is saved in the media description. Showing it where an ad or preview appears is not built yet.

## Safety

- Keys come from env and are never in results or errors.
- `use_media` accepts an id, not a URL. Downloads only go to a fixed list of provider hosts, over https, and redirects are followed by hand and checked at every hop.
- Provider text (titles, names) is untrusted: control characters are removed and lengths cut.
- Photos are capped at 12 MB and clips at 40 MB, and the real file type is checked before saving. A failed save removes the half-finished upload.

## Not verified

- The tests use stubbed responses written from the providers' documented shapes. Nothing has run against the live APIs yet (the build sandbox cannot reach them). Check on the first real search: Pexels video file links, Pixabay video thumbnails, and the Openverse `thumb` endpoint and `aspect_ratio` values.
- The allowed-host list includes `player.vimeo.com` because Pexels video links have used it; remove it if links now come only from `videos.pexels.com`.
- How an ad scene or layer plays a saved video (the vocabulary mentions keyed footage) needs checking with `describe_nexus_ad_vocabulary`.

## Later

Credit lines on ads and previews, cropping and resizing to the ad frame, a quality check on candidates, other sources, and a router that picks between stock, the pod's image model (`docs/pod/IMAGES.md`) and the owner's own uploads.
