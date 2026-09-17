import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { operatorLoginUrl, redirectToOperatorLogin } from '../public/nex-chat-bar.js';

const loginPage = await readFile(new URL('../public/room-login.html', import.meta.url), 'utf8');

test('operator login redirect preserves a safe same-origin return path', () => {
  assert.equal(
    operatorLoginUrl({ pathname: '/conference-room.html', search: '?view=board', hash: '#nex' }),
    '/room-login.html?next=%2Fconference-room.html%3Fview%3Dboard%23nex',
  );
  assert.equal(
    operatorLoginUrl({ pathname: '//attacker.example/steal', search: '?token=nope' }),
    '/room-login.html?next=%2F',
  );
});

test('only a 401 response triggers operator login navigation', () => {
  const destinations = [];
  const locationLike = {
    pathname: '/',
    search: '',
    hash: '',
    assign: (url) => destinations.push(url),
  };
  assert.equal(redirectToOperatorLogin({ status: 500 }, locationLike), false);
  assert.deepEqual(destinations, []);
  assert.equal(redirectToOperatorLogin({ status: 401 }, locationLike), true);
  assert.deepEqual(destinations, ['/room-login.html?next=%2F']);
});

test('login page preserves operator return paths without weakening customer redirects', () => {
  assert.match(loginPage, /new URL\(requested \|\| '\/', window\.location\.origin\)/u);
  assert.match(loginPage, /candidate\.origin !== window\.location\.origin/u);
  assert.match(loginPage, /data\.operator === true && operatorNextPath/u);
  assert.match(loginPage, /customerWorkspaces\.has\(requested\)/u);
});
