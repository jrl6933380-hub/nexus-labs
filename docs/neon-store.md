# Postgres store

The app's Redis calls are answered from Postgres when `NEXUS_DATABASE_URL` (Neon pooled connection string) is set.
Code: `lib/store/`. Tables (`kv_*`) are created automatically on first use.
Turn it off by removing `NEXUS_DATABASE_URL`; the app goes back to `KV_REST_API_URL`.
