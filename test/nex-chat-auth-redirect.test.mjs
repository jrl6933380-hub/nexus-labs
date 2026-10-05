import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  operatorLoginUrl,
  redirectToOperatorLogin,
  shouldRedirectToOperatorLogin,
} from '../public/nex-chat-bar.js';

const loginPage = await readFile(new URL('../public/nexus-login.html', import.meta.url), 'utf8');

test('operator login redirect preserves a safe same-origin return path', () => {
  assert.equal(
    operatorLoginUrl({ pathname: '/conference-room.html', search: '?view=board', hash: '#nex' }),
    '/nexus-login.html?next=%2Fconference-room.html%3Fview%3Dboard%23nex',
  );
  assert.equal(
    operatorLoginUrl({ pathname: '//attacker.example/steal', search: '?token=nope' }),
    '/nexus-login.html?next=%2F',
  );
});

test('only a user-initiated 401 redirects to operator login', () => {
  const destinations = [];
  const locationLike = {
    pathname: '/',
    search: '',
    hash: '',
    assign: (url) => destinations.push(url),
  };

  assert.equal(shouldRedirectToOperatorLogin({ status: 500 }, 'message'), false);
  assert.equal(shouldRedirectToOperatorLogin({ status: 401 }, 'history'), false);
  assert.equal(
    redirectToOperatorLogin({ status: 401 }, locationLike, { requestIntent: 'history' }),
    false,
  );
  assert.deepEqual(destinations, []);

  assert.equal(shouldRedirectToOperatorLogin({ status: 401 }, 'message'), true);
  assert.equal(redirectToOperatorLogin({ status: 401 }, locationLike), true);
  assert.deepEqual(destinations, ['/nexus-login.html?next=%2F']);
});

test('Nexus login preserves only safe same-origin return paths', () => {
  assert.match(loginPage, /requestedNext\.startsWith\('\/'\)/u);
  assert.match(loginPage, /!requestedNext\.startsWith\('\/\/'\)/u);
  assert.match(loginPage, /!requestedNext\.startsWith\('\/nexus-login\.html'\)/u);
  assert.match(loginPage, /separate from every Forge account/u);
});
