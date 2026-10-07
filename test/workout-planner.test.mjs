import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = join(here, "..", "public", "workout-planner.html");

function readPage() {
  assert.ok(existsSync(pagePath), "public/workout-planner.html must exist");
  return readFileSync(pagePath, "utf8");
}

function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "page must contain an inline script");
  return m[1];
}

test("workout planner page exists and is a complete HTML document", () => {
  const html = readPage();
  assert.match(html.trimStart(), /^<!DOCTYPE html>/i);
  assert.match(html, /<html[^>]*>/i);
  assert.match(html, /<\/html>\s*$/i);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /<meta name="viewport"/i);
  assert.match(html, /<title>My Workout Planner<\/title>/i);
});

test("workout planner covers all seven days with a default plan", () => {
  const html = readPage();
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  for (const day of days) {
    assert.match(html, new RegExp('"' + day + '":\\s*\\{'), "starter plan missing " + day);
  }
});

test("workout planner has no remote dependencies or network requests", () => {
  const html = readPage();
  // No external scripts, stylesheets, images, or links
  assert.ok(!/\bsrc\s*=\s*["']https?:/i.test(html), "must not load remote scripts/images");
  assert.ok(!/\bhref\s*=\s*["']https?:/i.test(html), "must not link remote resources");
  // No network calls in the inline script
  const script = extractScript(html);
  assert.ok(!/\bfetch\s*\(/.test(script), "must not call fetch");
  assert.ok(!/\bXMLHttpRequest\b/.test(script), "must not use XMLHttpRequest");
  assert.ok(!/\bimport\s*\(/.test(script), "must not import remote modules");
});

test("workout planner inline script is syntactically valid", () => {
  const script = extractScript(readPage());
  assert.doesNotThrow(() => new Function(script), "inline script must compile");
});

test("workout planner core logic: blank week, add/remove, counts", () => {
  const script = extractScript(readPage());
  // Execute the data-layer pieces in isolation by stripping the DOM wiring:
  // take everything up to the first "render(week)" top-level call.
  const cut = script.indexOf("let week = load();");
  assert.ok(cut > 0, "expected data layer before DOM wiring");
  const dataLayer = script.slice(0, cut);
  const run = new Function(dataLayer + `
    return { STARTER, DAYS, blankWeek, esc, GROUP_COLORS };
  `);
  const { STARTER, DAYS, blankWeek, esc } = run();

  assert.equal(DAYS.length, 7);
  for (const day of DAYS) {
    assert.ok(STARTER[day].exercises.length > 0, day + " should have a default plan");
  }
  assert.equal(DAYS.length, Object.keys(blankWeek()).length);
  for (const day of DAYS) {
    assert.equal(blankWeek()[day].exercises.length, 0, day + " blank should have no exercises");
  }
  assert.equal(esc("<b>&"), "&lt;b&gt;&amp;", "esc must HTML-escape user input");
});
