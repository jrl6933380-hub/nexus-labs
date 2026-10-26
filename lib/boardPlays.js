// /lib/boardPlays.js
// Plays: short, reusable how-to recipes that Claude, ChatGPT and Nex share through
// the Agent Board. A play is what worked, written down once, so the next agent does
// not rediscover it: when to use it, the steps in order, the tools involved, and the
// gotchas that cost time.
//
// Storage is injected (the same Redis command function lib/board.js uses) so this
// file has no I/O of its own and can be tested with a Map.
//
// Nothing secret belongs in a play. Every text field goes through the same secret
// scanner as board tasks, and a flag is attached if anything looked like a credential.

import { redactSecrets } from './secretScan.js';

export const PLAYS_KEY = 'nexus:board:plays';
export const PLAY_LIMIT = 200;
export const AUTHORS = ['claude', 'chatgpt', 'nex', 'justin'];

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const squash = (value, limit) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);

export function playId(text) {
  const id = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
    .replace(/-+$/u, '');
  if (id.length < 3) throw fail('A play needs a title with letters or numbers in it');
  return id;
}

function cleanAuthor(author) {
  const by = squash(author, 20).toLowerCase();
  if (!AUTHORS.includes(by)) throw fail('author must be one of: ' + AUTHORS.join(', '));
  return by;
}

// Builds the stored record from tool or API input. Fields left out keep their
// existing value, so an agent can fix one step list without resending the rest.
export function buildPlay(input = {}, { existing = null, now = Date.now(), author } = {}) {
  const hits = new Set();
  const text = (value, limit) => {
    const scrubbed = redactSecrets(squash(value, limit));
    scrubbed.matchedPatterns.forEach((name) => hits.add(name));
    return scrubbed.text;
  };
  const list = (value, max, limit) => (Array.isArray(value) ? value : [])
    .map((entry) => text(typeof entry === 'string' ? entry : entry?.text, limit))
    .filter(Boolean)
    .slice(0, max);
  const pick = (key) => (input[key] !== undefined ? input[key] : existing?.[key]);

  const title = text(pick('title'), 120);
  if (!title) throw fail('A play needs a title');
  const steps = list(pick('steps'), 30, 500);
  if (!steps.length) throw fail('A play needs at least one step');
  const by = cleanAuthor(author);

  const play = {
    id: existing?.id || playId(input.id || title),
    title,
    when: text(pick('when'), 300),
    steps,
    gotchas: list(pick('gotchas'), 15, 400),
    tools: list(pick('tools'), 15, 80),
    tags: list(pick('tags'), 8, 30).map((tag) => tag.toLowerCase()),
    author: existing?.author || by,
    updated_by: by,
    created_at: existing?.created_at || now,
    updated_at: now,
    version: (existing?.version || 0) + 1,
    uses: existing?.uses || 0,
    last_used_at: existing?.last_used_at || null,
    last_used_by: existing?.last_used_by || null,
  };
  if (hits.size) play.secret_check = { flagged: true, matched_patterns: [...hits], flagged_at: now };
  return play;
}

function haystack(play) {
  return [play.title, play.when, ...play.tags, ...play.tools, ...play.steps, ...play.gotchas].join(' ').toLowerCase();
}

export function createPlayStore(command, { now = Date.now } = {}) {
  const parse = (raw) => {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const get = async (id) => parse(await command(['HGET', PLAYS_KEY, id]));
  const put = (play) => command(['HSET', PLAYS_KEY, play.id, JSON.stringify(play)]);

  return {
    // Newest change first. `query` keeps plays where every word appears somewhere in the play.
    async list({ query } = {}) {
      const raw = await command(['HGETALL', PLAYS_KEY]);
      const plays = [];
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i += 2) {
          const play = parse(raw[i + 1]);
          if (play) plays.push(play);
        }
      }
      const words = squash(query, 200).toLowerCase().split(' ').filter(Boolean);
      return plays
        .filter((play) => words.every((word) => haystack(play).includes(word)))
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    },

    async read(id) {
      const play = await get(String(id || ''));
      if (!play) throw fail('No play with that id', 404);
      return play;
    },

    // Create or update by id (or by title when no id is given). Pass expected_version
    // when updating so two agents cannot silently overwrite each other.
    async save(input = {}) {
      const id = playId(input.id || input.title);
      const existing = await get(id);
      if (existing && input.expected_version !== undefined && Number(input.expected_version) !== existing.version) {
        throw fail(`That play changed (now version ${existing.version}). Read it again, merge your change, and save with expected_version ${existing.version}.`, 409);
      }
      if (!existing && Number(await command(['HLEN', PLAYS_KEY])) >= PLAY_LIMIT) {
        throw fail('The play book is full. Delete one nobody uses first.', 429);
      }
      const play = buildPlay(input, { existing, now: now(), author: input.author });
      await put(play);
      return play;
    },

    // Call this when you actually followed a play, so the book shows which ones earn their place.
    async use({ id, by } = {}) {
      const play = await this.read(id);
      play.uses = (play.uses || 0) + 1;
      play.last_used_at = now();
      play.last_used_by = cleanAuthor(by);
      await put(play);
      return { id: play.id, title: play.title, uses: play.uses };
    },

    async remove({ id } = {}) {
      const play = await this.read(id);
      const removed = Number(await command(['HDEL', PLAYS_KEY, play.id]));
      if (removed !== 1) throw fail('The play was not removed. Try again.', 500);
      return { id: play.id, title: play.title, deleted: true };
    },
  };
}
