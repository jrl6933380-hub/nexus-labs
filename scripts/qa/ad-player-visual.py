#!/usr/bin/env python3
"""Visual + determinism QA for public/ad-designs/vocabulary-player.html.

Needs Playwright with a Chromium binary (PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH).
Writes PNGs to the output dir (default ./ad-player-shots) for human review and fails if
the page logs errors, if scene content overflows the logical canvas, or if the same
timestamp renders differently twice (determinism is required for future MP4 export).
Usage: python3 scripts/qa/ad-player-visual.py [out_dir]
"""
import os, sys, pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parents[2]
page_url = (root / "public/ad-designs/vocabulary-player.html").as_uri()
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "ad-player-shots")
out.mkdir(parents=True, exist_ok=True)
FORMATS = {"portrait": (360, 640), "square": (560, 560), "landscape": (800, 450)}
TIMES = [600, 1800, 3700, 6000, 8200, 11000, 12800]
MOODS = {"portrait": ("bold", "midnight-gold"), "square": ("playful", "electric-pop"), "landscape": ("luxury", "forest-brass")}
failures, errors = [], []

with sync_playwright() as p:
    kw = {"args": ["--no-sandbox"]}
    if os.environ.get("CHROMIUM_PATH"):
        kw["executable_path"] = os.environ["CHROMIUM_PATH"]
    browser = p.chromium.launch(**kw)
    for fmt, (w, h) in FORMATS.items():
        mood, palette = MOODS[fmt]
        for t in TIMES:
            shots = []
            for _ in range(2):
                pg = browser.new_page(viewport={"width": w, "height": h})
                pg.on("pageerror", lambda e: errors.append(str(e)))
                pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                pg.goto(f"{page_url}?format={fmt}&mood={mood}&palette={palette}&t={t}")
                pg.wait_for_timeout(200)
                overflow = pg.evaluate("""() => {
                  const s = document.getElementById('stage').getBoundingClientRect();
                  return [...document.querySelectorAll('.hl,.sup,.btn,.dest,.tag')].filter(e => e.offsetParent && getComputedStyle(e).opacity > 0.5)
                    .filter(e => { const r = e.getBoundingClientRect(); return r.left < s.left - 1 || r.right > s.right + 1 || r.top < s.top - 1 || r.bottom > s.bottom + 1; })
                    .map(e => e.className);
                }""")
                if overflow:
                    failures.append(f"{fmt}@{t}: overflow {overflow}")
                shots.append(pg.screenshot())
                pg.close()
            (out / f"{fmt}-{t}.png").write_bytes(shots[0])
            if shots[0] != shots[1]:
                failures.append(f"{fmt}@{t}: not deterministic")
    browser.close()

if errors:
    failures.append(f"page errors: {errors[:3]}")
print("\n".join(failures) if failures else f"ok: {len(FORMATS) * len(TIMES)} frames, deterministic, no overflow, no errors -> {out}")
sys.exit(1 if failures else 0)
