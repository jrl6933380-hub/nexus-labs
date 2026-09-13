import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeonDatabase } from '../lib/neonProvisioning.js';

test('degrades safely with no NEON_API_KEY configured', async () => {
  delete process.env.NEON_API_KEY;
  const result = await createNeonDatabase({ name: 'test-client' });
  assert.equal(result.provisioned, false);
  assert.match(result.reason, /NEON_API_KEY/);
});

test('parses a successful Neon project-creation response', async () => {
  process.env.NEON_API_KEY = 'fake-test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://console.neon.tech/api/v2/projects');
    assert.equal(options.headers.Authorization, 'Bearer fake-test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.project.name, 'test-client');
    assert.equal(body.project.pg_version, 17);
    return {
      ok: true,
      text: async () => JSON.stringify({
        project: { id: 'proj-123', region_id: 'aws-us-east-1' },
        connection_uris: [{ connection_uri: 'postgresql://user:pass@host/neondb', database_name: 'neondb' }],
      }),
    };
  };
  const result = await createNeonDatabase({ name: 'test-client' });
  globalThis.fetch = originalFetch;
  assert.equal(result.provisioned, true);
  assert.equal(result.project_id, 'proj-123');
  assert.equal(result.connection_string, 'postgresql://user:pass@host/neondb');
  assert.equal(result.database_name, 'neondb');
});

test('degrades safely on a Neon API error instead of throwing', async () => {
  process.env.NEON_API_KEY = 'fake-test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ message: 'Unauthorized' }),
  });
  const result = await createNeonDatabase({ name: 'test-client' });
  globalThis.fetch = originalFetch;
  assert.equal(result.provisioned, false);
  assert.match(result.reason, /401/);
});

test('rejects a missing project name', async () => {
  process.env.NEON_API_KEY = 'fake-test-key';
  await assert.rejects(() => createNeonDatabase({}), /requires a project name/);
});
