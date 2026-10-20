# Design first, preserve, then learn

Nexus should learn techniques from sites a user actually selects, rather than
start with a shared page skeleton and swap business names, colors and images.

## The workflow

1. Design from this business, the actual content and the visitor's main task.
2. Show the site and relevant interactions, then incorporate user feedback.
3. Preserve the selected version's exact editable source, chosen assets, provenance
   and stable revision. Keep independent authors' concepts separate.
4. Explain the relationships that make the design work: content hierarchy, section
   order, typography, reading measure, image roles/crops, whitespace and interaction.
5. Map those decisions to known design atoms. Record missing capabilities explicitly.
   Build and test a renderer primitive before claiming stock-player support.
6. Keep visual selection, browser/device verification, deployment and live integrations
   as separate facts. A selected concept is not production proof.
7. Validate the lesson record, then review and persist it in the curated source
   registry or versioned Vault. Validation alone does not save or train anything.
8. For the next business, retrieve relevant lessons and selectively reuse techniques.
   Compose a fresh identity and journey. Reuse tested mechanics; never impose the
   example's entire page order, palette, typography or hero arrangement.

## Current implementation

`lib/siteDesignVocabulary.js` defines 21 authored design patterns, eight workflow
steps and two curated learning records from the selected sneaker and tattoo sites.
`createSiteDesignLesson` validates a bounded reviewable record; it does not fetch
URLs, execute code, authenticate approvals, write storage or grant permission.
Adding a future curated record remains an explicit reviewed source/Vault operation.
The new module is developer vocabulary, not a ChatGPT skill or model fine-tune.

Agents receive the vocabulary in existing read responses:

- `boardSharedSkills()` adds `design_vocabulary` to the existing Site Stylist record.
  The canonical packaged skill content stays byte-for-byte unchanged. Existing
  board/workspace/project flows already deliver this guidance; saved user kits are
  not migrated or overwritten.
- `describeAdVocabulary()` adds `site_design_vocabulary` next to the closed render
  vocabulary. It adds no scene IDs, validation exceptions or renderer behavior.
  The new rules explicitly prevent treating design-atom IDs as v2 ad scenes.

This preserves the distinction between learning design judgment and adding actual
runtime capabilities. The stock player still cannot execute arbitrary websites,
shopping state or private Site source simply because a lesson describes them.

## Ownership and source privacy

The curated records retain exact owner source URLs/revisions in the private repo.
Generic shared responses redact these locations, project IDs, revisions and personal
feedback. They deliver anonymized design lessons and direct the agent to retrieve
exact source only through the connected owner's authorized Vault/workspace. There
is no caller-controlled MCP flag that exposes another owner's selected source.
The existing tenant/access boundaries and action permissions remain authoritative.

## Initial lessons

- Product-first resale: isolated product imagery, condition records, inventory
  facets, product inspection, size selection, feedback and a local concept bag are
  one customer journey. Typography and spacing support that journey. Do not copy
  a sneaker shop's lime/olive styling onto unrelated businesses. Real stock,
  authentication, checkout and fulfillment remain unimplemented capabilities.
- Editorial artist studio: an artwork plate, type hierarchy, reading rhythm and a
  personal enquiry establish a studio identity. Stack copy and artwork on phones
  rather than break headings into fragments. A generated illustration is not a
  photographed tattoo performed for a real client.

Both have user-preview selection; browser/device/integration verification remains
false. Neither the earlier 30-site batch nor a rendered image alone is promoted as
an approved design reference or proven implementation.

## Validation

`node --test test/site-design-vocabulary.test.mjs` verifies selected-source versus
runtime evidence, known-atom validation, rejection of unsupported authority fields,
source redaction and fresh board-response copies. `node --check
lib/adVocabularyTools.js` verifies syntax of the Ad Maker integration. The existing
full MCP/Ad Maker dependency-based suites must still run in repository CI; they
were not available in this partial local checkout. No runtime deployment is implied
until this branch is reviewed, merged and deployed.
