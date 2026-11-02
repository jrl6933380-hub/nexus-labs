# Nexus Ally Launcher — custom home deck

An offline, self-contained HTML app for the Windows ROG Ally. It opens as an Edge app window, **not** a replacement for Explorer / Windows shell. The Ally pairing session, Qwen service and Windows desktop continue to work normally. No admin rights, startup registration, secrets, or new server needed.

## What you can customize

- Four wallpaper/theme presets (Aurora, Electric, Ember, Midnight), accent color, custom JPG/PNG/WebP background up to 1.5 MB.
- Deck title, compact/roomy tile size, standard/wide tile shapes, tile reordering, add/edit/delete tiles (1–24 total).
- Tile titles, icons, descriptive labels, and destination URLs. User-defined URLs are restricted to HTTPS or local-only HTTP on `127.0.0.1` / `localhost`. `javascript:`, `file:`, credential-bearing URLs and arbitrary HTTP hosts are blocked.
- Fullscreen toggle and export/import of a JSON layout backup.

All preferences are saved in that browser's `localStorage` for the launcher's stable `file:///` path, not uploaded to Nexus. Wallpapers remain local. Changes to the HTML app on upgrade may affect `file:` storage behavior, so exporting a backup before upgrading is recommended. Imported layouts are validated, including URL schemes, sizes and tile count. No raw command execution from user-configurable tiles.

Default links: local llama.cpp/Qwen model web page (`http://127.0.0.1:9931`), Nexus, Ad Maker, Forge, Ally connection status, Nexus GitHub, Agent Board. A link can require Nexus login or show an API landing if the corresponding app is not available; the launcher does not start a service automatically.

## Install on Ally

**Only use a reviewed, immutable Git commit** and an independently calculated SHA-256 of `public/ally-launcher.html` from that commit. Run the trusted `scripts/ally/install-launcher.ps1` on the Ally with `-Revision <40-hex>` and `-Sha256 <64-hex>`; optionally `-Launch` to open the app when installation completes.

The installer downloads only the exact launcher HTML from `raw.githubusercontent.com/jrl6933380-hub/nexus-labs/<revision>/public/ally-launcher.html`, checks size and SHA-256, writes to `%LOCALAPPDATA%/NexusAlly/launcher/versions/<revision>/`, and creates `%USERPROFILE%/Desktop/Nexus Ally Launcher.lnk` to launch Microsoft Edge with `--app="file:///.../ally-launcher.html" --start-maximized`. The shortcut can be pinned to the Windows taskbar manually.

The owner Ally terminal connector can perform the same pinned install and launch without manually typing commands. Installing the launcher does **not** grant Qwen Windows terminal access, create scheduled tasks, start on boot, replace Explorer, or give the webpage filesystem access. Any later always-on mode / auto-start needs separate explicit approval.

## QA

`node --test test/ally-launcher.test.mjs` covers syntax, self-contained operation, customization controls, URL constraints, and installer safeguards. Before shipping, use a real browser to verify add/edit/delete/reorder, color/gradient/wallpaper changes, fullscreen, export/import, and reopen persistence.
