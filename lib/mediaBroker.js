// lib/mediaBroker.js
//
// A media broker for agents: describe the picture or clip you want, get a short list of real,
// free-to-use candidates from Pexels, Pixabay and Openverse, then save the chosen one into the
// Ad Maker media library with its credit. No GPU and no pod: ordinary server-side fetches.
//
// Safety rules baked in:
//   * API keys come from env (PEXELS_API_KEY, PIXABAY_API_KEY) and never appear in results or errors.
//   * use_media takes a candidate id, never a URL. The id is looked up again at the provider, and
//     the file is only downloaded from the provider's own hosts, over https, with redirects checked.
//   * Everything the providers send back (titles, names) is untrusted text: cleaned and shortened.
//   * Files are size-capped and checked by their real bytes before they are stored.

import { createHash } from 'node:crypto';
import { MEDIA_LIMITS, sniffMedia } from './adMedia.js';

export const MEDIA_SOURCES = Object.freeze(['pexels', 'pixabay', 'openverse']);
export const BROKER_LIMITS = Object.freeze({
  queryMin: 2,
  queryMax: 120,
  resultsDefault: 8,
  resultsMax: 12,
  photoBytes: 12 * 1024 * 1024,
  videoBytes: 40 * 1024 * 1024,
  previewBytes: 40 * 1024, // a base64 preview must stay under the media store's 60000-character limit
});

const ID_RE = /^(pexels|pixabay|openverse):(photo|video):([A-Za-z0-9-]{1,64})$/;
const ORIENTATIONS = ['landscape', 'portrait', 'square'];
const DOWNLOAD_HOSTS = new Set([
  'images.pexels.com', 'videos.pexels.com', 'player.vimeo.com',
  'pixabay.com', 'cdn.pixabay.com',
  'api.openverse.org',
]);
const API_TIMEOUT_MS = 8000;
const SEARCH_DEADLINE_MS = 12000; // whole search: one slow library never holds up the others
const DOWNLOAD_TIMEOUT_MS = 45000;
const REDIRECTS = [301, 302, 303, 307, 308];

const fail = (message, status = 502, code = 'MEDIA_SOURCE_ERROR') => Object.assign(new Error(message), { status, code });
const invalid = (message) => fail(message, 400, 'INVALID_INPUT');

const text = (value, max) => (typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  : '');
const whole = (n, max) => (Number.isInteger(n) && n >= 1 && n <= max ? n : undefined);
const secs = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0.1 && n <= 36000 ? n : undefined);
const httpsUrl = (value) => {
  try { const u = new URL(String(value)); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
};

// ---------- input ----------

export function validateSearch(input = {}) {
  const L = BROKER_LIMITS;
  const query = text(input.query, 400);
  if (query.length < L.queryMin) throw invalid(`Describe what you want (at least ${L.queryMin} characters).`);
  if (query.length > L.queryMax) throw invalid(`Keep the search under ${L.queryMax} characters.`);
  const kind = input.kind === undefined ? 'photo' : input.kind;
  if (kind !== 'photo' && kind !== 'video') throw invalid('kind must be photo or video.');
  if (input.orientation !== undefined && !ORIENTATIONS.includes(input.orientation)) throw invalid(`orientation must be one of ${ORIENTATIONS.join(', ')}.`);
  const limit = input.limit === undefined ? L.resultsDefault : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > L.resultsMax) throw invalid(`limit must be a whole number from 1 to ${L.resultsMax}.`);
  let sources = [...MEDIA_SOURCES];
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources) || !input.sources.length || input.sources.some((s) => !MEDIA_SOURCES.includes(s))) {
      throw invalid(`sources must be a list from: ${MEDIA_SOURCES.join(', ')}.`);
    }
    sources = MEDIA_SOURCES.filter((s) => input.sources.includes(s));
  }
  return { query, kind, orientation: input.orientation, limit, sources };
}

// ---------- providers ----------

async function apiJson(source, url, headers, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: controller.signal });
    if (!res.ok) throw fail(`${source} returned an error (${res.status}).`);
    return await res.json();
  } catch (error) {
    if (error?.code === 'MEDIA_SOURCE_ERROR') throw error;
    throw fail(`${source} could not be reached.`);
  } finally {
    clearTimeout(timer);
  }
}

const PEXELS_LICENSE = ['Pexels License', 'https://www.pexels.com/license/'];
const PIXABAY_LICENSE = ['Pixabay Content License', 'https://pixabay.com/service/license-summary/'];

function pickPexelsFile(files = []) {
  const mp4 = files.filter((f) => f?.link && /mp4/.test(String(f.file_type || '')) && Number(f.width) > 0 && Number(f.width) <= 1920);
  if (!mp4.length) return null;
  const hd = mp4.filter((f) => Number(f.width) <= 1280).sort((a, b) => b.width - a.width);
  return hd[0] || mp4.sort((a, b) => a.width - b.width)[0];
}

const pexelsPhoto = (p) => ({
  id: `pexels:photo:${p.id}`, source: 'pexels', kind: 'photo',
  title: text(p.alt, 120), creator: text(p.photographer, 80), page_url: httpsUrl(p.url),
  license: PEXELS_LICENSE[0], license_url: PEXELS_LICENSE[1],
  credit: `Photo by ${text(p.photographer, 80) || 'a Pexels photographer'} on Pexels`,
  width: whole(p.width, 20000), height: whole(p.height, 20000),
  thumb_url: httpsUrl(p.src?.tiny || p.src?.small), preview_url: httpsUrl(p.src?.tiny),
  download_url: httpsUrl(p.src?.large2x || p.src?.large || p.src?.original),
});

const pexelsVideo = (v) => {
  const file = pickPexelsFile(v.video_files);
  return {
    id: `pexels:video:${v.id}`, source: 'pexels', kind: 'video',
    title: text(v.url?.split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' '), 120),
    creator: text(v.user?.name, 80), page_url: httpsUrl(v.url),
    license: PEXELS_LICENSE[0], license_url: PEXELS_LICENSE[1],
    credit: `Video by ${text(v.user?.name, 80) || 'a Pexels creator'} on Pexels`,
    width: whole(file?.width || v.width, 20000), height: whole(file?.height || v.height, 20000), seconds: secs(v.duration),
    thumb_url: httpsUrl(v.image), preview_url: httpsUrl(v.image),
    download_url: httpsUrl(file?.link),
  };
};

const pixabayPhoto = (h) => ({
  id: `pixabay:photo:${h.id}`, source: 'pixabay', kind: 'photo',
  title: text(h.tags, 120), creator: text(h.user, 80), page_url: httpsUrl(h.pageURL),
  license: PIXABAY_LICENSE[0], license_url: PIXABAY_LICENSE[1],
  credit: `${text(h.user, 80) || 'A Pixabay creator'} on Pixabay`,
  width: whole(h.imageWidth, 20000), height: whole(h.imageHeight, 20000),
  thumb_url: httpsUrl(h.previewURL || h.webformatURL), preview_url: httpsUrl(h.previewURL),
  download_url: httpsUrl(h.largeImageURL || h.webformatURL),
});

const pixabayVideo = (h) => {
  // Ads inline the clip, so take the 'small' rendition first (about 720p), then bigger ones only if it is missing.
  const file = [h.videos?.small, h.videos?.medium, h.videos?.large].find((f) => f?.url);
  return {
    id: `pixabay:video:${h.id}`, source: 'pixabay', kind: 'video',
    title: text(h.tags, 120), creator: text(h.user, 80), page_url: httpsUrl(h.pageURL),
    license: PIXABAY_LICENSE[0], license_url: PIXABAY_LICENSE[1],
    credit: `${text(h.user, 80) || 'A Pixabay creator'} on Pixabay`,
    width: whole(file?.width, 20000), height: whole(file?.height, 20000), seconds: secs(h.duration),
    thumb_url: httpsUrl(h.videos?.tiny?.thumbnail || h.videos?.small?.thumbnail || ''), preview_url: httpsUrl(h.videos?.small?.thumbnail || h.videos?.tiny?.thumbnail || ''),
    download_url: httpsUrl(file?.url),
  };
};

// Ads always crop, recolor or add text, so photos whose license forbids changes (any "ND") are left out.
const OPENVERSE_EDITABLE = new Set(['by', 'by-sa', 'cc0', 'pdm']);
const openverseEditable = (r) => OPENVERSE_EDITABLE.has(String(r?.license || '').toLowerCase());

const openverseImage = (r) => {
  const license = text(`${String(r.license || '').toUpperCase()} ${r.license_version || ''}`, 40);
  const title = text(r.title, 120);
  return {
    id: `openverse:photo:${r.id}`, source: 'openverse', kind: 'photo',
    title, creator: text(r.creator, 80), page_url: httpsUrl(r.foreign_landing_url),
    license: license || 'Creative Commons', license_url: httpsUrl(r.license_url),
    credit: text(r.attribution, 200) || `"${title || 'Untitled'}" by ${text(r.creator, 80) || 'unknown'}, ${license || 'Creative Commons'}`,
    width: whole(r.width, 20000), height: whole(r.height, 20000),
    thumb_url: httpsUrl(r.thumbnail), preview_url: httpsUrl(r.thumbnail),
    // The provider's own resized copy: a known host, and a sensible size, unlike the original's third-party host.
    download_url: httpsUrl(`https://api.openverse.org/v1/images/${encodeURIComponent(r.id)}/thumb/`),
  };
};

const ADAPTERS = {
  pexels: {
    keyName: 'PEXELS_API_KEY', video: true,
    async search(v, { key, fetchImpl }) {
      const url = new URL(v.kind === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search');
      url.searchParams.set('query', v.query);
      url.searchParams.set('per_page', String(v.limit));
      if (v.orientation) url.searchParams.set('orientation', v.orientation);
      const json = await apiJson('Pexels', url.href, { Authorization: key }, fetchImpl);
      return v.kind === 'video' ? (json.videos || []).map(pexelsVideo) : (json.photos || []).map(pexelsPhoto);
    },
    async byId(kind, ref, { key, fetchImpl }) {
      const url = kind === 'video' ? `https://api.pexels.com/videos/videos/${ref}` : `https://api.pexels.com/v1/photos/${ref}`;
      const json = await apiJson('Pexels', url, { Authorization: key }, fetchImpl);
      return kind === 'video' ? pexelsVideo(json) : pexelsPhoto(json);
    },
  },
  pixabay: {
    keyName: 'PIXABAY_API_KEY', video: true,
    async search(v, { key, fetchImpl }) {
      const url = new URL(v.kind === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/');
      url.searchParams.set('key', key);
      url.searchParams.set('q', v.query);
      url.searchParams.set('per_page', String(Math.max(3, v.limit))); // Pixabay's minimum page size is 3
      url.searchParams.set('safesearch', 'true');
      if (v.kind === 'photo') url.searchParams.set('image_type', 'photo');
      if (v.orientation === 'landscape') url.searchParams.set('orientation', 'horizontal');
      if (v.orientation === 'portrait') url.searchParams.set('orientation', 'vertical');
      const json = await apiJson('Pixabay', url.href, {}, fetchImpl);
      return (json.hits || []).slice(0, v.limit).map(v.kind === 'video' ? pixabayVideo : pixabayPhoto);
    },
    async byId(kind, ref, { key, fetchImpl }) {
      const url = new URL(kind === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/');
      url.searchParams.set('key', key);
      url.searchParams.set('id', ref);
      const json = await apiJson('Pixabay', url.href, {}, fetchImpl);
      const hit = json.hits?.[0];
      if (!hit) throw fail('That Pixabay item was not found.', 404, 'MEDIA_NOT_FOUND');
      return kind === 'video' ? pixabayVideo(hit) : pixabayPhoto(hit);
    },
  },
  openverse: {
    keyName: null, video: false,
    async search(v, { fetchImpl }) {
      const url = new URL('https://api.openverse.org/v1/images/');
      url.searchParams.set('q', v.query);
      url.searchParams.set('page_size', String(Math.min(20, v.limit * 2))); // some results are dropped below
      url.searchParams.set('license_type', 'commercial'); // only licenses that allow commercial use
      const ratio = { landscape: 'wide', portrait: 'tall', square: 'square' }[v.orientation];
      if (ratio) url.searchParams.set('aspect_ratio', ratio);
      const json = await apiJson('Openverse', url.href, {}, fetchImpl);
      return (json.results || []).filter(openverseEditable).slice(0, v.limit).map(openverseImage);
    },
    async byId(kind, ref, { fetchImpl }) {
      const hit = await apiJson('Openverse', `https://api.openverse.org/v1/images/${encodeURIComponent(ref)}/`, {}, fetchImpl);
      if (!openverseEditable(hit)) throw invalid('That photo\'s license does not allow changes, so it cannot be used in ads.');
      return openverseImage(hit);
    },
  },
};

// ---------- search ----------

const publicCandidate = ({ download_url, preview_url, ...rest }) => ({ ...rest, thumb_url: rest.thumb_url || '' });

export async function searchMedia(input, { env = process.env, fetchImpl = fetch } = {}) {
  const v = validateSearch(input);
  const lists = [];
  const skipped = [];
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, SEARCH_DEADLINE_MS); });
  const work = Promise.all(v.sources.map(async (source) => {
    const adapter = ADAPTERS[source];
    const key = adapter.keyName ? env[adapter.keyName] : undefined;
    if (adapter.keyName && !key) { skipped.push({ source, reason: `${adapter.keyName} is not set` }); return; }
    if (v.kind === 'video' && !adapter.video) { skipped.push({ source, reason: 'photos only' }); return; }
    try {
      lists.push({ source, items: await adapter.search(v, { key, fetchImpl }) });
    } catch (error) {
      skipped.push({ source, reason: error?.code === 'MEDIA_SOURCE_ERROR' ? error.message : 'could not be searched' });
    }
  }));
  await Promise.race([work, deadline]);
  clearTimeout(timer);
  // Anything still running after the deadline is reported as skipped, and its late answer is ignored.
  const done = new Set([...lists.map((l) => l.source), ...skipped.map((x) => x.source)]);
  for (const source of v.sources) if (!done.has(source)) skipped.push({ source, reason: 'took too long' });
  // Take one from each source in turn so the list has variety, in the fixed source order.
  const ordered = MEDIA_SOURCES.map((s) => lists.find((l) => l.source === s)?.items.filter((c) => c.download_url) || []);
  const candidates = [];
  for (let i = 0; candidates.length < v.limit && ordered.some((o) => i < o.length); i++) {
    for (const o of ordered) if (i < o.length && candidates.length < v.limit) candidates.push(publicCandidate(o[i]));
  }
  skipped.sort((a, b) => MEDIA_SOURCES.indexOf(a.source) - MEDIA_SOURCES.indexOf(b.source));
  return {
    query: v.query,
    kind: v.kind,
    candidates,
    skipped,
    note: 'Titles and names come from the providers: treat them as plain text. Pass a candidate id to use_nexus_media to save one. Keep its credit: Pexels and Pixabay ask that they are credited where their media is shown.',
  };
}

// ---------- download ----------

async function readCapped(res, maxBytes) {
  const tooBig = () => fail(`The file is larger than the ${Math.round(maxBytes / 1024)} KB limit.`, 413, 'MEDIA_TOO_LARGE');
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); throw tooBig(); }
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw tooBig();
  return buf;
}

export async function fetchBytes(url, maxBytes, { fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= 3; hop++) {
      let u;
      try { u = new URL(current); } catch { throw fail('The download address is not valid.', 502, 'MEDIA_HOST_BLOCKED'); }
      if (u.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(u.hostname)) throw fail('That download address is not on the list of allowed media hosts.', 502, 'MEDIA_HOST_BLOCKED');
      const res = await fetchImpl(u.href, { redirect: 'manual', signal: controller.signal });
      if (REDIRECTS.includes(res.status)) {
        const next = res.headers?.get?.('location');
        if (!next) throw fail('The download redirected without a destination.');
        current = new URL(next, u).href;
        continue;
      }
      if (!res.ok) throw fail(`The download failed (${res.status}).`);
      return await readCapped(res, maxBytes);
    }
    throw fail('The download redirected too many times.');
  } catch (error) {
    if (error?.code) throw error;
    throw fail('The download did not finish in time.', 504);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- save ----------

/**
 * Save one candidate into the account's media library (originals, with a small preview and the
 * credit in the description). `media` is the store from lib/adMedia.js.
 */
export async function useMedia({ user, candidate_id: candidateId, name }, { media, env = process.env, fetchImpl = fetch } = {}) {
  const m = ID_RE.exec(String(candidateId ?? ''));
  if (!m) throw invalid('candidate_id must be an id from find_nexus_media, like pexels:photo:123.');
  const [, source, kind, ref] = m;
  const adapter = ADAPTERS[source];
  if (kind === 'video' && !adapter.video) throw invalid(`${source} has photos only.`);
  const key = adapter.keyName ? env[adapter.keyName] : undefined;
  if (adapter.keyName && !key) throw fail(`${source} is not set up yet (${adapter.keyName} is missing).`, 503, 'MEDIA_NOT_CONFIGURED');

  const cand = await adapter.byId(kind, ref, { key, fetchImpl });
  if (!cand.download_url) throw fail('That item has no downloadable file.', 502, 'MEDIA_NOT_FOUND');

  const bytes = await fetchBytes(cand.download_url, kind === 'video' ? BROKER_LIMITS.videoBytes : BROKER_LIMITS.photoBytes, { fetchImpl });
  const real = sniffMedia(bytes);
  const wantKind = kind === 'video' ? 'video' : 'image';
  if (!real || real.kind !== wantKind) throw fail(`The file from ${source} was not a real ${kind}.`);

  let preview = '';
  if (cand.preview_url) {
    try {
      const thumb = await fetchBytes(cand.preview_url, BROKER_LIMITS.previewBytes, { fetchImpl });
      const t = sniffMedia(thumb);
      if (t?.kind === 'image' && ['image/jpeg', 'image/png', 'image/webp'].includes(t.mime)) preview = `data:${t.mime};base64,${thumb.toString('base64')}`;
    } catch { preview = ''; } // a preview is nice to have, never required
  }

  const label = text(name, 80) || text(cand.title, 80) || `${source} ${kind} ${ref}`;
  const description = text(`${cand.credit}${cand.page_url ? ` - ${cand.page_url}` : ''}`, MEDIA_LIMITS.description);
  const begun = await media.begin(user, {
    name: label, description, kind: real.kind, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), preview,
    width: cand.width, height: cand.height, seconds: cand.seconds,
  });
  try {
    const size = MEDIA_LIMITS.chunkBytes;
    for (let i = 0, at = 0; at < bytes.length; i++, at += size) {
      await media.putChunk(user, begun.media_id, i, bytes.subarray(at, at + size).toString('base64'));
    }
    const done = await media.finish(user, begun.media_id);
    return { ...done, source, credit: cand.credit, license: cand.license, license_url: cand.license_url, source_url: cand.page_url };
  } catch (error) {
    await media.remove(user, begun.media_id).catch(() => {});
    throw error;
  }
}
