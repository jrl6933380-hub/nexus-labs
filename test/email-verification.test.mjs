import test from 'node:test';
import assert from 'node:assert/strict';

import { verificationEmailHtml } from '../lib/emailVerification.js';

test('the confirmation email escapes the username and link', () => {
  const html = verificationEmailHtml({
    username: '<script>alert(1)</script>',
    link: 'https://example.com/?token=abc"onmouseover="evil()',
  });
  assert.ok(!html.includes('<script>'), 'a username must not be able to inject markup into the email');
  assert.ok(!html.includes('onmouseover="evil()'), 'the link must not break out of its attribute');
  assert.match(html, /&lt;script&gt;/);
});

test('the confirmation email contains the link and an expiry notice', () => {
  const html = verificationEmailHtml({ username: 'dana', link: 'https://example.com/confirm' });
  assert.match(html, /https:\/\/example\.com\/confirm/);
  assert.match(html, /24 hours/);
  assert.match(html, /dana/);
});
