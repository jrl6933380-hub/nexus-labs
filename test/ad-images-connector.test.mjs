import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { createAdImageStore } from '../lib/adImages.js';
import { composeAdFromBrief } from '../lib/adComposer.js';
import { createWorkspaceService, WORKSPACE_WRITES, WORKSPACE_ACTIONS } from '../lib/workspaceConnector.js';
import { WORKSPACE_TOOLS } from '../lib/workspaceBoard.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const owner = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's' };
const other = { id: 'someone', workbenchUserId: 'w2', scheduleUserId: 's2' };
const brief = { business_name: 'Sunrise Cafe', industry: 'cafe', goal: 'visit', length_sec: 15 };

function stores() {
  const hashes = new Map();
  let n = 0;
  const command = async ([op, ...args]) => {
    const hash = hashes.get(args[0]) || new Map();
    hashes.set(args[0], hash);
    if (op === 'HGET') return hash.get(args[1]) || null;
    if (op === 'HVALS') return [...hash.values()];
    if (op === 'HLEN') return hash.size;
    if (op === 'HSET') { hash.set(args[1], args[2]); return 1; }
    if (op === 'HDEL') return hash.delete(args[1]) ? 1 : 0;
    if (op === 'EVAL') {
      const [, , key, id, previous, value] = args;
      const h = hashes.get(key) || new Map();
      if ((h.get(id) || '') !== previous) return 0;
      h.set(id, value);
      hashes.set(key, h);
      return 1;
    }
    throw Error(op);
  };
  return {
    ads: createAdCampaignStore({ command, uuid: () => 'b' + ++n, now: () => 1 }),
    images: createAdImageStore({ command, now: () => 1, newId: () => 'img-' + String(++n).padStart(4, '0') }),
  };
}

test('image tools are registered with the right write flags and connector fields', () => {
  const byName = Object.fromEntries(WORKSPACE_TOOLS.map((t) => [t[0], t]));
  assert.equal(byName.list_nexus_images[4], false);
  assert.equal(byName.save_nexus_image[4], true);
  assert.equal(byName.delete_nexus_image[4], true);
  for (const action of ['save_image', 'delete_image']) assert.ok(WORKSPACE_WRITES.has(action));
  assert.ok(!WORKSPACE_WRITES.has('images'));
  assert.deepEqual(WORKSPACE_ACTIONS.save_image, ['name', 'source', 'description', 'data_uri', 'thumb']);
});

test('save, list, attach to a photo scene, preview and delete work end to end', async () => {
  const { ads, images } = stores();
  const run = createWorkspaceService({ ads, images });
  const saved = await run('save_image', { name: 'Sunrise', source: 'ai_generated', description: 'Cafe at dawn', data_uri: PNG }, owner);
  assert.equal(saved.saved, true);
  assert.equal(saved.source, 'ai_generated');
  const listed = await run('images', {}, owner);
  assert.equal(listed.images.length, 1);
  assert.ok(!JSON.stringify(listed).includes('base64,'), 'list never returns picture data');
  assert.equal((await run('images', {}, other)).images.length, 0, 'libraries are per account');

  const created = await run('create_ad_from_brief', { ...brief, campaign_id: 'pic-ad' }, owner);
  const plain = await run('open_ad', { campaign_id: 'pic-ad' }, owner);
  assert.doesNotMatch(plain.preview_html, /id="ad-images"/);

  const edited = await run('edit_ad', {
    campaign_id: 'pic-ad', baseline: created.baseline,
    edits: [{ op: 'remove_scene', scene_id: 's2' }, { op: 'add_scene', after_scene_id: 's1', scene: { type: 'photo_focus', duration: 3, params: { imageId: saved.image_id, fit: 'full', caption: 'Sample caption' } } }],
  }, owner);
  assert.equal(edited.saved, true);
  const opened = await run('open_ad', { campaign_id: 'pic-ad' }, owner);
  assert.match(opened.preview_html, /<script id="ad-images" type="application\/json">/);
  assert.ok(opened.preview_html.includes(PNG.split(',')[1]));
  assert.match(opened.preview_html, /"source":"ai_generated"/);

  assert.deepEqual(await run('delete_image', { image_id: saved.image_id }, owner), { deleted: true, image_id: saved.image_id });
  assert.equal((await run('images', {}, owner)).images.length, 0);
  const afterDelete = await run('open_ad', { campaign_id: 'pic-ad' }, owner);
  assert.doesNotMatch(afterDelete.preview_html, /id="ad-images"/, 'a deleted image falls back to the brand mark');
});

test('an ad cannot point at an image that is not in the account library', async () => {
  const { ads, images } = stores();
  const run = createWorkspaceService({ ads, images });
  const created = await run('create_ad_from_brief', { ...brief, campaign_id: 'no-pic' }, owner);
  const edit = (imageId) => run('edit_ad', {
    campaign_id: 'no-pic', baseline: created.baseline,
    edits: [{ op: 'remove_scene', scene_id: 's2' }, { op: 'add_scene', scene: { type: 'photo_focus', duration: 3, params: { imageId } } }],
  }, owner);
  await assert.rejects(edit('img-nope0001'), (e) => e.code === 'IMAGE_NOT_FOUND' && /list_nexus_images/.test(e.message));
  assert.equal((await run('ad', { campaign_id: 'no-pic' }, owner)).project.scenes.some((s) => s.type === 'photo_focus'), false, 'a refused edit changes nothing');
  await assert.rejects(run('save_image', { name: 'Bad', data_uri: 'data:image/png;base64,AAAA' }, owner), /not a real PNG/);
  const other2 = await run('save_image', { name: 'Theirs', data_uri: PNG }, other);
  await assert.rejects(edit(other2.image_id), (e) => e.code === 'IMAGE_NOT_FOUND', "another account's image cannot be used");
});
