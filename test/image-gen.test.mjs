import test from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, validateImageRequest, findRunningPodId, IMAGE_PORT, IMAGE_DATA_URI_MAX } from '../lib/imageGen.js';
import { createWorkspaceService, WORKSPACE_WRITES, WORKSPACE_ACTIONS } from '../lib/workspaceConnector.js';
import { WORKSPACE_TOOLS } from '../lib/workspaceBoard.js';

const URI = 'data:image/webp;base64,UklGR' + 'A'.repeat(60);
const env = { RUNPOD_API_KEY: 'rp-key', NEX_POD_KEY: 'pod-key' };
const pod = { id: 'pod123', name: 'nex-pod', desiredStatus: 'RUNNING' };
const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

// A fake network: RunPod pod list, the image service health check and generate call.
function network({ pods = [pod], healthOk = true, generate = json({ data_uri: URI, width: 1024, height: 768, seed: 7 }) } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://rest.runpod.io/v1/pods')) return json(pods);
    if (String(url).endsWith('/health')) return json({}, healthOk, healthOk ? 200 : 503);
    if (String(url).endsWith('/v1/images/generate')) return typeof generate === 'function' ? generate() : generate;
    throw Error('unexpected ' + url);
  };
  return { fetchImpl, calls };
}

test('validateImageRequest cleans the prompt and enforces sizes', () => {
  assert.deepEqual(validateImageRequest({ prompt: '  a  red   door ' }), { prompt: 'a red door', width: 1024, height: 1024 });
  assert.equal(validateImageRequest({ prompt: 'a red door', width: 512, height: 768, steps: 8, seed: 5 }).seed, 5);
  for (const bad of [{ prompt: 'hi' }, { prompt: 'x'.repeat(1001) }, { prompt: 'a red door', width: 500 }, { prompt: 'a red door', width: 2048 }, { prompt: 'a red door', steps: 0 }, { prompt: 'a red door', seed: -1 }]) {
    assert.throws(() => validateImageRequest(bad), (e) => e.code === 'INVALID_INPUT' && e.status === 400);
  }
});

test('generateImage finds the running pod, checks health, and sends the pod key only to the pod', async () => {
  const { fetchImpl, calls } = network();
  const out = await generateImage({ prompt: 'a red door at dusk', width: 1024, height: 768 }, { fetchImpl, env });
  assert.equal(out.data_uri, URI);
  assert.equal(out.seed, 7);
  const post = calls.find((c) => c.url.endsWith('/v1/images/generate'));
  assert.equal(post.url, `https://pod123-${IMAGE_PORT}.proxy.runpod.net/v1/images/generate`);
  assert.equal(post.options.headers.Authorization, 'Bearer pod-key');
  assert.deepEqual(JSON.parse(post.options.body), { prompt: 'a red door at dusk', width: 1024, height: 768 });
  assert.equal(calls.find((c) => c.url.startsWith('https://rest.runpod.io')).options.headers.Authorization, 'Bearer rp-key');
  assert.equal(calls.some((c) => c.url.endsWith('/health') && c.options.headers?.Authorization), false);
});

test('generateImage reports the pod as offline instead of starting anything', async () => {
  await assert.rejects(() => generateImage({ prompt: 'a red door' }, { fetchImpl: network({ pods: [{ ...pod, desiredStatus: 'EXITED' }] }).fetchImpl, env }), (e) => e.code === 'IMAGE_POD_OFFLINE' && e.status === 503);
  await assert.rejects(() => generateImage({ prompt: 'a red door' }, { fetchImpl: network({ healthOk: false }).fetchImpl, env }), (e) => e.code === 'IMAGE_POD_OFFLINE');
  await assert.rejects(() => generateImage({ prompt: 'a red door' }, { fetchImpl: network().fetchImpl, env: {} }), (e) => e.code === 'IMAGE_POD_OFFLINE');
  assert.equal(await findRunningPodId({ fetchImpl: async () => { throw Error('down'); }, env }), null);
});

test('generateImage rejects bad service replies without echoing them', async () => {
  const cases = [
    json({ error: 'secret detail' }, false, 500),
    json({ data_uri: 'not-a-picture' }),
    json({ data_uri: 'data:image/webp;base64,' + 'A'.repeat(IMAGE_DATA_URI_MAX) }),
  ];
  for (const generate of cases) {
    await assert.rejects(() => generateImage({ prompt: 'a red door' }, { fetchImpl: network({ generate }).fetchImpl, env }), (e) => e.code === 'IMAGE_POD_ERROR' && !/secret detail|pod-key/.test(e.message));
  }
});

test('generate_nexus_image is registered as an owner write tool', () => {
  const tool = WORKSPACE_TOOLS.find((t) => t[0] === 'generate_nexus_image');
  assert.ok(tool);
  assert.equal(tool[1], 'generate_image');
  assert.equal(tool[4], true);
  assert.ok(WORKSPACE_WRITES.has('generate_image'));
  assert.deepEqual(WORKSPACE_ACTIONS.generate_image, ['name', 'prompt', 'description', 'width', 'height', 'steps', 'seed']);
});

test('generate_image saves an ai_generated picture for the owner and refuses customers', async () => {
  const saved = [];
  const images = { save: async (user, input) => { saved.push({ user, input }); return { image: { id: 'img-0001', name: input.name, source: input.source } }; } };
  const seen = [];
  const imageGen = async (input) => { seen.push(input); return { data_uri: URI, width: 1024, height: 768, seed: 42 }; };
  const execute = createWorkspaceService({ images, imageGen });
  const owner = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's', owner: true };
  const customer = { id: 'someone', workbenchUserId: 'w2', scheduleUserId: 's2' };

  const out = await execute('generate_image', { prompt: 'a red door at dusk', width: 1024, height: 768 }, owner);
  assert.equal(out.image.id, 'img-0001');
  assert.equal(out.seed, 42);
  assert.equal(saved[0].input.source, 'ai_generated');
  assert.equal(saved[0].input.name, 'a red door at dusk');
  assert.equal(saved[0].input.data_uri, URI);
  assert.equal(seen[0].width, 1024);

  await assert.rejects(() => execute('generate_image', { prompt: 'a red door at dusk' }, customer), /owner/i);
  assert.equal(saved.length, 1);
  await assert.rejects(() => execute('generate_image', { prompt: 'a red door', extra: 1 }, owner), /Unsupported field/);
});
