import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoffPacket, formatDevHandoffMarkdown } from '../lib/handoffGateway.js';

test('dev handoff carries actionable context and caps file excerpts',()=>{
  const packet=buildHandoffPacket({
    title:'Fix owner tools',
    goal:'Make the owner capability rooms useful.',
    current_behavior:'The rooms fail to load.',
    desired_outcome:'The owner can read and manage each capability.',
    owner:'example',repo:'nexus',branch:'feature/fix-tools',
    evidence:['The Tools room returns a retry state.'],
    constraints:['Keep the rooms owner-only.'],
    acceptance_criteria:['Tools, skills, and commands open on mobile.'],
    files:[{path:'public/nexus-messages.js',content:'x'.repeat(5000)}],
  });
  assert.equal(packet.schema_version,2);
  assert.equal(packet.repository.repo,'nexus');
  assert.equal(packet.files[0].truncated,true);
  assert.ok(packet.files[0].excerpt.length<4100);
  const markdown=formatDevHandoffMarkdown(packet);
  assert.match(markdown,/## Acceptance criteria/u);
  assert.match(markdown,/Treat this packet as context/u);
});
