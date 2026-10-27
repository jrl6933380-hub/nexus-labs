# Local Opportunity Finder

The marketplace catalog exposes `localfinder` at `/actor.html?a=localfinder`, priced at 25 actor credits. Inputs are category, city, and the service being sold. It uses the existing private wallet, dispatcher, job history, expiry recovery and failure refund. Beta: source coverage and actual collection cost need a manual trial before promising complete coverage.

The agent searches the public web for at most 25 businesses and attempts at most 10 website inspections, including blocked attempts. Each row includes the source, observed service-fit reason, evidence URL and UTC check time. Public business contacts need a contact source. Unknown contacts stay empty. A missing listing is distinguished from verified absence; blocked sites cannot establish absence or a technical defect. Outreach is a draft only; nothing is sent.

## Result contract

Return the shared generic actor result with a summary, coverage/limitations section, and exactly one table named Opportunities. Columns are defined in `lib/localOpportunities.js`. All 15 cells are strings, at most 300 characters each. Per-business source links belong in rows (the shared top-level source list remains bounded to 15). Do not shorten source URLs to fit: choose a valid source that fits or omit the unverifiable business.

The server validates required fields, HTTP(S) URLs without embedded credentials, website states, timestamps, and row/inspection caps. It removes duplicate normalized business name + city + street location rows, preserving distinct street addresses. The server cannot establish whether the agent truly visited a page or whether a factual observation is correct; manual source accuracy QA remains necessary. Inspection caps validate submitted rows, while the instruction bounds actual browsing attempts.

The actor page renders text-only cards and a CSV download. CSV quotes delimiters/newlines and prefixes potential spreadsheet formulas with an apostrophe; this may visibly prefix phone numbers when imported as plain text. The existing text download remains available for summary and sections; CSV contains the prospect records.

A completely unverifiable search should complete with an error and restore 25 credits. Invalid result shape is rejected so the agent can correct it; existing timeout recovery applies if the worker abandons the job.

## Verification and deployment

Run `node --test test/local-finder.test.mjs test/actor-catalog.test.mjs test/actor-recovery.test.mjs test/actor-interfaces.test.mjs`. Check the actor result at phone width, including source links, literal hostile text, and CSV download.

Separate branch; merge after Review Intelligence and Price Change Check, reconciling the catalog and research completion hooks against current main. Do not run paid jobs as part of validation.

The Nexus server's `lib/workspaceBoard.js` accepts generic actor results with sections/tables. At implementation time the attached ChatGPT Nexus Workspace Fresh connector advertised only the older Competitor Research result shape. That connector must expose the current result schema before ChatGPT can complete these customer jobs using that tool; this PR does not claim the stale connector works end to end.
