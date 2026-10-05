# Sentry Crash Feed

Set `SENTRY_WEBHOOK_SECRET` in the server-side environment to the same secret used by Sentry's webhook integration. POST Sentry issue events to `/api/sentry-webhook`; the receiver validates `Sentry-Hook-Signature` (`sha256=<hex>`), redacts sensitive fields, and deduplicates by issue/fingerprint.

Each record keeps recurrence count, first/last seen timestamps, severity, route, deployment, commit, and a linked Nexus repair-task id. Repeated records update the same Crash Feed entry instead of creating duplicates. Nex can inspect the feed with `list_crashes` and `get_crash`.

The webhook returns only a minimal accepted response; raw Sentry payloads and secrets are never returned to agents.
