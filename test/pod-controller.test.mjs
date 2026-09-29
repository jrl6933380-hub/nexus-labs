import test from 'node:test';
import assert from 'node:assert/strict';
import { controlPod, podStatus } from '../lib/podController.js';

const env = { RUNPOD_API_KEY: 'runpod-secret', NEX_POD_KEY: 'pod-secret' };

function reply(data, ok = true, status = 200) {
  return { ok, status, text: async () => data == null ? '' : JSON.stringify(data), json: async () => data };
}

test('status exposes safe pod facts and authenticated model health', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/pods')) return reply([{ id: 'pod-1', name: 'nex-pod', desiredStatus: 'RUNNING', costPerHr: 1.59 }]);
    return reply({ data: [{ id: 'nex-base' }] });
  };
  const status = await podStatus({ env, fetchImpl });
  assert.equal(status.pod.id, 'pod-1');
  assert.equal(status.pod.costPerHr, 1.59);
  assert.equal(status.health.ready, true);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer pod-secret');
  assert.doesNotMatch(JSON.stringify(status), /runpod-secret|pod-secret/);
});

test('controller only acts on the existing named pod', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.endsWith('/pods')) return reply([{ id: 'pod-9', name: 'nex-pod', desiredStatus: 'EXITED' }]);
    return reply(null);
  };
  await controlPod('start', { env, fetchImpl });
  assert.deepEqual(calls.map((call) => [call.url, call.method]), [
    ['https://rest.runpod.io/v1/pods', 'GET'],
    ['https://rest.runpod.io/v1/pods/pod-9/start', 'POST'],
  ]);
  await assert.rejects(controlPod('delete', { env, fetchImpl }), /Unsupported pod action/);
});

test('controller refuses to invent or create a missing pod', async () => {
  const fetchImpl = async () => reply([]);
  await assert.rejects(controlPod('start', { env, fetchImpl }), /Deploy a fresh pod/);
});
