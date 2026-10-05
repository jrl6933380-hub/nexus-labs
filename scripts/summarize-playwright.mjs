#!/usr/bin/env node
// scripts/summarize-playwright.mjs
// Turns Playwright's JSON report into markdown for $GITHUB_STEP_SUMMARY.
//
// WHY: the "accessibility" check has been red on main, and the check run's
// own summary field is empty — so anyone (human or agent) diagnosing it has
// to open the raw Actions log by hand. The axe violation dump that
// e2e/accessibility.spec.mjs already console.logs is exactly what's needed,
// it just never surfaces anywhere readable. This prints it into the job
// summary instead. Never throws on a missing/odd report; the test step's own
// exit code is what decides pass/fail, not this.

import fs from 'node:fs';

const file = process.argv[2] || 'playwright-report.json';
const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '');

if (!fs.existsSync(file)) {
  console.log(`_No Playwright JSON report found at \`${file}\`._`);
  process.exit(0);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.log(`_Could not parse \`${file}\`: ${error.message}_`);
  process.exit(0);
}

const failures = [];

function walk(suite, trail = []) {
  const path = suite.title ? [...trail, suite.title] : trail;
  for (const spec of suite.specs || []) {
    if (spec.ok) continue;
    const results = (spec.tests || []).flatMap((t) => t.results || []);
    const errors = [
      ...results.flatMap((r) => (r.error?.message ? [r.error.message] : [])),
      ...results.flatMap((r) => (r.errors || []).map((e) => e?.message).filter(Boolean)),
    ];
    const stdout = results.flatMap((r) =>
      (r.stdout || []).map((chunk) => (typeof chunk === 'string' ? chunk : chunk?.text || '')),
    );
    failures.push({
      name: [...path, spec.title].join(' \u203a '),
      errors: [...new Set(errors)],
      stdout,
    });
  }
  for (const child of suite.suites || []) walk(child, path);
}

for (const suite of report.suites || []) walk(suite);

const stats = report.stats || {};
console.log('## Accessibility & mobile checks');
console.log('');
console.log(
  `**${stats.expected ?? '?'} passed \u00b7 ${stats.unexpected ?? failures.length} failed \u00b7 ` +
    `${stats.flaky ?? 0} flaky \u00b7 ${stats.skipped ?? 0} skipped**`,
);

if (failures.length === 0) {
  console.log('');
  console.log('No failing specs recorded.');
  process.exit(0);
}

const MAX_SPECS = 25;
for (const failure of failures.slice(0, MAX_SPECS)) {
  console.log('');
  console.log(`### ${failure.name}`);
  const out = stripAnsi(failure.stdout.join('')).trim();
  if (out) {
    console.log('');
    console.log('```json');
    console.log(out.slice(0, 2000));
    console.log('```');
  }
  for (const error of failure.errors.slice(0, 2)) {
    console.log('');
    console.log('```');
    console.log(stripAnsi(error).trim().slice(0, 1200));
    console.log('```');
  }
}

if (failures.length > MAX_SPECS) {
  console.log('');
  console.log(`_\u2026and ${failures.length - MAX_SPECS} more failing specs._`);
}
