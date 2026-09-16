import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://room-projects-test.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

let list = [];
global.fetch = async (_url, options) => {
  const cmd = JSON.parse(options.body);
  const [command] = cmd;
  let result;
  if (command === 'LPUSH') { list.unshift(cmd[2]); result = list.length; }
  else if (command === 'RPUSH') { list.push(...cmd.slice(2)); result = list.length; }
  else if (command === 'LTRIM') { list = list.slice(Number(cmd[2]), Number(cmd[3]) + 1); result = 'OK'; }
  else if (command === 'LRANGE') { result = list.slice(Number(cmd[2]), Number(cmd[3]) + 1); }
  else if (command === 'DEL') { list = []; result = 1; }
  else throw new Error(`Unexpected command ${command}`);
  return { ok: true, json: async () => ({ result }) };
};

const { saveBuild, listBuilds, listProjects, deleteProject } = await import('../lib/roomHistory.js');

test.beforeEach(() => { list = []; });

test('repeated edits to one project collapse into a single project row', async () => {
  // The bug: every edit calls saveBuild, so a project edited three times
  // showed up as three separate entries in the Projects panel.
  await saveBuild('alice', { label: 'First version', html: '<p>1</p>', projectId: 'proj-a' });
  await saveBuild('alice', { label: 'Add a header', html: '<p>2</p>', projectId: 'proj-a' });
  await saveBuild('alice', { label: 'Make it rain', html: '<p>3</p>', projectId: 'proj-a' });

  assert.equal((await listBuilds('alice')).length, 3, 'all versions are still stored');
  const projects = await listProjects('alice');
  assert.equal(projects.length, 1, 'but they are one project');
  assert.equal(projects[0].versionCount, 3);
  assert.equal(projects[0].label, 'Make it rain', 'the newest save is the current state');
});

test('separate projects stay separate, newest-updated first', async () => {
  await saveBuild('alice', { label: 'Older project', html: '<p>a</p>', projectId: 'proj-a' });
  await saveBuild('alice', { label: 'Newer project', html: '<p>b</p>', projectId: 'proj-b' });
  const projects = await listProjects('alice');
  assert.equal(projects.length, 2);
  assert.equal(projects[0].label, 'Newer project');
  assert.equal(projects[1].label, 'Older project');
});

test('a legacy save with no projectId still appears as its own project', async () => {
  await saveBuild('alice', { label: 'Before projects existed', html: '<p>x</p>' });
  const projects = await listProjects('alice');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectId, null);
  assert.ok(projects[0].key.startsWith('build:'));
});

test('deleting a project removes all its versions and leaves others alone', async () => {
  await saveBuild('alice', { label: 'Keep me', html: '<p>keep</p>', projectId: 'proj-keep' });
  await saveBuild('alice', { label: 'Doomed v1', html: '<p>1</p>', projectId: 'proj-doomed' });
  await saveBuild('alice', { label: 'Doomed v2', html: '<p>2</p>', projectId: 'proj-doomed' });

  const result = await deleteProject('alice', 'proj-doomed');
  assert.equal(result.removed, 2, 'every version of the project goes');

  const projects = await listProjects('alice');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].label, 'Keep me');
  assert.equal((await listBuilds('alice')).length, 1, 'the survivor is intact, not half-deleted');
});

test('deleting preserves the newest-first order of what remains', async () => {
  await saveBuild('alice', { label: 'A', html: '<p>a</p>', projectId: 'p-a' });
  await saveBuild('alice', { label: 'B', html: '<p>b</p>', projectId: 'p-b' });
  await saveBuild('alice', { label: 'C', html: '<p>c</p>', projectId: 'p-c' });
  await deleteProject('alice', 'p-b');
  const builds = await listBuilds('alice');
  assert.deepEqual(builds.map((b) => b.label), ['C', 'A'], 'order must survive the rewrite');
});

test('deleting an unknown project reports zero rather than clearing history', async () => {
  await saveBuild('alice', { label: 'Keep me', html: '<p>keep</p>', projectId: 'proj-keep' });
  const result = await deleteProject('alice', 'does-not-exist');
  assert.equal(result.removed, 0);
  assert.equal((await listBuilds('alice')).length, 1, 'a miss must never wipe the list');
});

test('deleteProject requires a projectId', async () => {
  await assert.rejects(() => deleteProject('alice'), /projectId is required/);
});
