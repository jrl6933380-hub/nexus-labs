import test from 'node:test';
import assert from 'node:assert/strict';

import { matchTemplate, TEMPLATES, getTemplateById } from '../lib/forge/templates/index.js';

test('every template has a unique id and non-empty html', () => {
  const ids = new Set();
  for (const t of TEMPLATES) {
    assert.ok(t.id && !ids.has(t.id), `duplicate or missing id: ${t.id}`);
    ids.add(t.id);
    assert.ok(t.html.startsWith('<!DOCTYPE html>'), `${t.id} should be a full HTML document`);
    assert.ok(t.keywords.length > 0, `${t.id} should have match keywords`);
  }
});

test('matchTemplate finds the service one-pager for a local-service request', () => {
  const match = matchTemplate('I need a site for my plumbing business');
  assert.equal(match?.id, 'service-one-pager');
});

test('matchTemplate finds the restaurant template for a menu request', () => {
  const match = matchTemplate('build a website for my new restaurant with a menu');
  assert.equal(match?.id, 'restaurant-menu');
});

test('matchTemplate finds the calculator template for an estimator request', () => {
  const match = matchTemplate('make a mortgage calculator');
  assert.equal(match?.id, 'calculator-tool');
});

test('matchTemplate returns null for something with no clear match', () => {
  const match = matchTemplate('build an interactive 3d solar system simulator with orbital mechanics');
  assert.equal(match, null);
});

test('matchTemplate returns null for an empty request', () => {
  assert.equal(matchTemplate(''), null);
  assert.equal(matchTemplate(undefined), null);
});

test('getTemplateById returns the matching template or null', () => {
  assert.equal(getTemplateById('portfolio')?.name, 'Personal Portfolio');
  assert.equal(getTemplateById('does-not-exist'), null);
});
