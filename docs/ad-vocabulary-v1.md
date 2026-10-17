# Ad Maker Vocabulary v1 — Spec (DRAFT for review)

Status: DRAFT. Spec only. No runtime code ships with this document.
Author: Claude. Reviewer: Justin. Cross-check requested from ChatGPT and Nex.

## 1. Why this exists

PR #617 let every ad own freeform HTML/CSS/JS ("creative code"). That is powerful but unconstrained: dropdowns, A/B variants, reliable agent output, and MP4 export all need a **closed set of known, tested options**.

The vocabulary is that set. It is **data, not code**: a registry of scene types, animations, camera moves, easings, transitions, backgrounds, moods, platform presets, and tags. Humans (dropdowns/tags), Nex, Claude, and ChatGPT all compose ads from the same registry through the same tools. Custom creative code from #617 remains as the escape hatch.

Non-goals for v1: photorealistic image generation, audio, per-client brand-kit storage, MP4 export itself (those are follow-ups, section 9).

## 2. Ground truth from #617 (verified on `main`)

The vocabulary must fit the existing contract rather than replace it.

- A design is one complete HTML document, max **100,000 characters**, that defines `window.renderAdFrame(frame)` (`public/ad-maker-design.js`).
- It runs in an iframe with `sandbox="allow-scripts"` (opaque origin) and CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`. **No external scripts, styles, fonts, or images. System font stacks and `data:` URIs only.**
- `frame` = `{ timeMs, durationMs, sceneId, sceneProgress, sceneIndex, project, width, height, format }`, where `project` is the full campaign (brand, initial, accent, background, cta, destination, siteName, siteHeadline, siteCta, brief, format, logo, photo, scenes[]).
- Everything is derived from `timeMs` / `sceneProgress`, so Play, Scrub, Loop, and Record share one result. **This determinism is the property that makes frame-by-frame MP4 export possible. The vocabulary must preserve it** (no `Math.random`, `Date.now`, or wall-clock animation; seeded noise only).
- Today the campaign schema locks scenes to exactly four with ids `hook | team | reveal | close` (`lib/adCampaigns.js`, `public/ad-maker-model.mjs`). The vocabulary needs this relaxed (section 5).
- **Size model (corrected per #619 review).** Serialized project configuration is capped at 180,000 UTF-8 bytes (it is not a cap on the whole stored ad). Creative HTML is capped separately at 100,000 characters; creative name 1 to 80 characters. Each stored logo/photo string is bounded to 140,000 characters inside the config cap. Accounts hold at most 100 campaigns. Owner MCP JSON requests are limited to 256kb, so JSON escaping and multi-byte text can exceed that before a character limit is hit. Measure transport bytes; do not assume every maximum is usable in one request.
- **Frame semantics (from #619).** `timeMs`/`durationMs` are milliseconds; project scene durations are seconds. `sceneProgress` is clamped to [0,1]. Seeking exactly to a scene boundary selects the next scene, except the final endpoint stays on the last scene at progress 1. Logical canvas sizes: portrait 360x640, square 560x560, landscape 800x450 (preview scaling and output resolution are separate). The bridge sends `project` only when configuration changes and caches it; helpers must use the `renderAdFrame` callback, never raw postMessage traffic.

Deployment (confirmed by ChatGPT in #619, not by me): #617 is live (production c8f74ae); `save_nexus_ad_design` and `apply_nexus_ad_design` are registered in `lib/workspaceBoard.js`, and live `tools/list` returns both. My earlier code-search miss was a search-index issue, not a missing deploy. Still unrun: an authenticated creative save with read-back, and any browser/device visual review (both blocked in #619).

## 3. Design principles

1. **Closed and validated.** An ad may only reference ids that exist in the registry. Unknown ids are rejected by the same strict validation the store already uses.
2. **Pure function of time.** Every animation is `f(sceneProgress, params)`. Seeded randomness only.
3. **Additive and backward compatible.** Existing 4-scene ads keep working untouched. v2 is opt-in per ad.
4. **One registry, many consumers.** UI dropdowns, `describe_vocabulary`, agent prompts, validation, and the player all read the same registry. Adding an option is one registry entry.
5. **Mood sets defaults, params override.** A user (or agent) picks a mood; every other choice has a sensible default derived from it.
6. **Honest by construction.** Concept previews and sample content are labeled in the rendering itself, not just in a prompt (section 8).

## 4. Architecture

```
registry (single source of truth)        public/ad-vocabulary.mjs   (ESM, shared by browser + server, like ad-maker-model.mjs)
   |-- validator (schema v2)             extends validateProject / adCampaignSchema
   |-- stock design: vocabulary player   public/ad-designs/vocabulary-player.html  (uses #617's renderAdFrame contract)
   |-- describe_vocabulary tool          read-only, returns registry JSON + version
   '-- UI dropdowns / tag pickers        read the registry
```

**Vocabulary player.** A stock creative design (built on #617) that renders any schema-v2 project from the registry. A v2 ad therefore needs **no custom code**; the player is just another design. Custom designs still work and may call the same runtime.

**Runtime delivery (DECIDED by Justin: option A, inject).** Because of the CSP, helper code cannot be loaded from a URL. Two options:
- (A) The renderer's bridge in `ad-maker-design.js` injects a versioned `NexusAd` runtime script into every design. Updates propagate; designs stay small; costs a small renderer change.
- (B) Each design inlines the runtime. No renderer change; every design pays its size and drifts over time.
Decision: **A**, refined per #619 review: injection is **opt-in and version-pinned**. A design declares the helper version it needs; legacy and no-helper creatives are untouched, so saved films and future exports stay reproducible (a global runtime that silently changes every saved film would break that). The helper must be installed **before** author scripts run; today the bridge is appended after author content, which is too late for scripts that call the helper during initialization. One versioned registry is the single source of truth for the helper, `describe_vocabulary`, UI controls, and validation, all exposing the same immutable ids and version.

## 5. Schema v2 (additive)

```jsonc
{
  "specVersion": 2,                    // absent => legacy 4-scene ad, untouched
  "name": "Pat's Plumbing — call now",
  "brand": "PAT'S PLUMBING", "initial": "P", "accent": "#e6c572", "background": "#0c1812",
  "mood": "bold",
  "platform": { "format": "portrait", "lengthSec": 15 },
  "tags": { "industry": "plumber", "goal": "call", "tone": "bold", "hook": "pain_point" },
  "concept": true,                     // see section 8
  "scenes": [
    { "id": "s1", "type": "hook_text",    "duration": 3,
      "params": { "headline": "Burst pipe at 2am?", "support": "We answer.", "textAnim": "kinetic_stack" },
      "camera": "push_in", "background": "grain", "transitionOut": "wipe_left" },
    { "id": "s2", "type": "stat_counter", "duration": 3, "params": { "value": 30, "suffix": " min", "label": "average arrival" } },
    { "id": "s3", "type": "end_card",     "duration": 4, "params": { "cta": "Call now", "destination": "555-0100" } }
  ]
}
```

Changes to validation:
- `scenes[].id`: free string `^[a-z0-9-]{1,40}$`, unique (today an enum of four).
- `scenes[].type`: enum from the registry. Legacy ads map implicitly to `type: "legacy"` and are rendered by their existing template/design.
- Scene count: 2 to 8 (today exactly 4). Total length <= 30 s.
- Scene duration: 1.5 to 15 s in v2 (legacy stays 2 to 15).
- `params` validated per scene type from the registry (types, max lengths, enums).
- Size model stays as in section 2: project config within the existing 180,000-byte cap, creative HTML separately within 100,000 characters.
- **v2 needs its own versioned validation path in BOTH the browser normalizer and the server schema**, plus timeline, editor, import, and export handling. Today both require exactly hook/team/reveal/close and drop or reject unknown fields. Never route v2 through the legacy normalizer, and never tighten legacy limits retroactively.

## 6. Vocabulary v1

### 6.1 Scene types

| id | purpose | params (max length) |
|---|---|---|
| `hook_text` | opening line | headline (60), support (120), textAnim |
| `stat_counter` | animated number | value, from=0, prefix (4), suffix (10), label (40), numberFormat: integer / decimal / percent / currency |
| `testimonial` | customer quote | quote (140), attribution (40), sourceRef: approval/source reference (see section 8) |
| `before_after` | transformation | beforeLabel, afterLabel (20 each), beforeText, afterText (60 each), revealStyle: wipe / slide / fade |
| `photo_focus` | image with slow motion | image: `photo` or `logo` ref, caption (60), camera |
| `site_mockup` | concept website preview | siteName (30), headline (65), cta (25), style: light / dark, scroll: bool |
| `steps_list` | 2 to 4 steps | items[]: title (30), detail (60); stagger |
| `end_card` | call to action | cta (35), destination (65), tagline (60) |

### 6.2 Text animation (`textAnim`)
`fade_up`, `slide_left`, `typewriter`, `word_by_word`, `mask_reveal`, `scale_pop`, `kinetic_stack`.

### 6.3 Camera
`static`, `push_in`, `pull_out`, `pan_left`, `pan_right`, `parallax` (with `intensity` 0 to 1).

### 6.4 Easing
`linear`, `smooth` (ease-in-out cubic), `snappy` (ease-out expo), `bounce` (ease-out back).

### 6.5 Transitions (`transitionOut`, 200 to 800 ms)
`cut`, `crossfade`, `wipe_left`, `slide_up`, `zoom_through`.
Overlap rule (proposed, exact fraction fixed in the registry PR): scenes overlap only during the outgoing scene's `transitionOut` window, and the span is clamped to a fraction of the shorter adjacent scene, so short scenes, cuts, the final frame, and loop boundaries are all well defined.

### 6.6 Backgrounds
`solid`, `gradient`, `grain`, `grid`, `orbits`, `particles` (seeded by scene id, deterministic).

### 6.7 Mood presets
`bold`, `warm`, `luxury`, `playful`, `clean`. Each is a token bundle: suggested palettes, heading/body **system font stacks** (CSP forbids web fonts), weight, letter spacing, default easing, default `textAnim`, and a pacing multiplier. A mood never overrides an explicit param.

### 6.8 Platform and length presets
- Format: `portrait` (9:16, Reels/TikTok), `square` (1:1, feed), `landscape` (16:9, YouTube).
- Length: 6, 15, or 30 s. Presets suggest scene counts (about 2, 4, 6) and duration splits.
- Safe margins (guidance, enforced by the player): portrait keeps text out of roughly the top 14% and bottom 20%.

### 6.9 Tags (metadata; drive agent defaults and filtering, never rendering)
- industry: `plumber`, `cafe`, `salon`, `restaurant`, `contractor`, `dental`, `fitness`, `retail`, `auto`, `other`
- goal: `call`, `book`, `visit`, `buy`, `signup`
- tone: same ids as moods
- hook: `question`, `stat`, `pain_point`, `offer`, `proof`

### 6.10 Hard limits
Headline <= 60 chars; support <= 120; CTA <= 35; scenes 2 to 8; total <= 30 s; min scene 1.5 s; param size counts toward the 180,000-byte project config cap; creative HTML <= 100,000 chars (unchanged). A character cap alone does not guarantee layout: long words, Unicode, wrapping, and font metrics still need renderer bounds and browser tests.

## 7. Tools, workflows, skills (built after spec approval)

**Existing (not changed by this spec):** `list_nexus_ads`, `read_nexus_ad`, `open_nexus_ad`, `save_nexus_ad`, and `save_nexus_ad_design` (deployment unconfirmed).

**New tools**
- `describe_vocabulary` — read-only; returns registry JSON and `vocabularyVersion`. First thing any agent calls, so nothing is hardcoded in prompts.
- `create_ad_from_brief` — brief + tags -> schema-v2 draft using only registry ids; validated before save.
- `edit_scene` — change one scene's params/type without touching the rest.
- `make_variants` — N variants (for example 3 hooks) for A/B.
- `render_preview` / `export_mp4` — deterministic frame render (E2B + ffmpeg), later phase.

**Workflows**
1. *Prospect pitch:* lead -> `create_ad_from_brief` with `concept: true` -> review -> send.
2. *Client campaign:* brief -> 3 variants -> approval -> export.
3. *A/B test:* one base ad -> `make_variants` over hook style -> compare.

**Skills (agent instructions)**
- Call `describe_vocabulary` first; use only returned ids.
- Hook <= 7 words; one CTA; one idea per scene.
- Keep prospect pitches labeled as concept previews.
- Never invent statistics, testimonials, awards, or guarantees (section 8).

## 8. Honesty and safety rules (enforced in the player, not just prompts)

1. **Concept previews are labeled.** When `concept: true`, the stock player always renders "Concept preview — not a live site" (including `site_mockup` and exported frames); params cannot remove it. **Limit:** custom creative code (#617's escape hatch) can remove labels rendered inside itself, and #617's starter only says "ILLUSTRATIVE TEAM WORKFLOW". An unremovable label needs a trusted studio/export overlay outside the creative iframe, captured into the final output. That is a follow-up; #617 does not enforce it.
2. **No fabricated social proof.** A boolean `verified` is not evidence. A `testimonial` renders as real only when a supplied source/approval reference accompanies it; otherwise it renders visibly tagged "SAMPLE". Sample statistics are labeled the same way. Skills must tell agents never to invent numbers, quotes, or claims.
3. **Rights.** Prospect photos/logos used in a private pitch to that prospect are reasonable. Public ads need client approval. The spec records this as a skill rule, not a technical control.
4. **No impersonation.** Do not render another brand's name, logo, or site as if it were the client's.
5. **Isolation unchanged.** All rendering stays inside #617's opaque sandboxed iframe; the vocabulary adds no network, storage, or tool access.

## 9. Build order (separate PRs, each reviewed before merge)

1. `public/ad-vocabulary.mjs` registry + schema v2 validation + tests (legacy ads must still load).
2. `describe_vocabulary` tool exposing that same registry (read-only, immutable ids + version).
3. Vocabulary player stock design on the #617 contract + browser/device visual review (#617 had none; #619 shows it is blocked on a browser-capable QA sandbox), then `create_ad_from_brief`, `edit_scene`, `make_variants`.
4. MP4 export: deterministic frame render in an E2B sandbox + ffmpeg; captions; optional music track. **Prerequisite, in its own PR:** a per-frame capture barrier (await readiness, fonts/images, and an acknowledgement tied to each requested frame; frozen viewport, scale, DPR, fps, and helper version; ongoing render-error checks; design baseline pinned for the job). The current ready handshake does not acknowledge frame completion. **Status:** the barrier now ships in the stock vocabulary player (v2 ads render there, not in the legacy studio). Open the player with `?capture=1` to turn wall-clock playback off, read `window.__captureInfo()` to assert viewport, DPR, logical size and helper version, then call `await window.__capture(ms)` per frame. It renders that exact frame, waits for fonts, image decode and two paints, and returns `{seq,timeMs,sceneId,ready}`; the same `seq` is stamped on `#stage[data-frame-seq]`, a request superseded by a newer one is rejected, and any page error fails the frame. The export runner now exists as `scripts/export-ad-mp4.mjs` (see `docs/ad-export.md`). Captions, music, upload of the result, and a server-side `export_mp4` tool are follow-ups; the existing E2B helper cannot host the render (60 second cap, no ffmpeg or Chromium). No capture fields are added to the frame contract in this spec. The QA/export sandbox also needs browser OS dependencies (E2B Chromium currently fails on missing libnspr4.so).
5. Image storage on Vercel Blob (lifts the 180 KB cap; real photos), brand kits, share/approval links, batch ads from lead lists.

## 10. Decisions and open questions

**Decided (Justin, 2026-10-16)**
1. Runtime delivery: **inject (A)**.
2. First-priority scene types for the first prospects: **`hook_text`, `site_mockup`, `end_card`** (build and polish these first).
3. Vocabulary additions/renames/cuts: none yet. Revisit after the first player renders real ads.
4. **Do not merge yet.** This PR stays open for review; no implementation PRs until Justin says go.

**Still open**
- Should v2 min scene duration be 1.5 s (supports 6 s ads) while legacy stays 2 s?
- Mood token bundles: Justin to approve the palette/typography direction for each mood.
- Authenticated `save_nexus_ad_design` write plus read-back, and browser/device review, are still unrun (blocked in #619 on a tool-discovery refresh and a browser-capable QA sandbox).
