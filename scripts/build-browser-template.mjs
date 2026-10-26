// Builds the E2B sandbox template that can actually run Chromium (the default 512 MB sandbox runs out of memory).
// Run from GitHub Actions (workflow "Build browser template"), which provides E2B_API_KEY. Needs e2b v2 (Template builder) and Node 22.
// Usage: REPO_ROOT=<path to repo> node build-browser-template.mjs
import {Template, defaultBuildLogger} from 'e2b';

export const TEMPLATE_ALIAS = 'nexus-browser';
export const TEMPLATE_CPU = 2;
export const TEMPLATE_MEMORY_MB = 2048;
const DIR = '/opt/nexus-browser';

export function browserTemplate(root = process.env.REPO_ROOT || process.cwd()) {
  return Template({fileContextPath: root})
    // Playwright's own image ships Chromium and its system libraries; the npm package version must match the image tag.
    .fromImage('mcr.microsoft.com/playwright:v1.48.0-jammy')
    .runCmd(`mkdir -p ${DIR} && cd ${DIR} && npm init -y && npm i playwright@1.48.0 && chmod -R a+rX ${DIR}`, {user: 'root'})
    .copy('scripts/live-browser-agent.mjs', `${DIR}/live-browser-agent.mjs`)
    .runCmd(`chmod a+r ${DIR}/live-browser-agent.mjs`, {user: 'root'});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.E2B_API_KEY) { console.error('E2B_API_KEY is not set.'); process.exit(1); }
  const info = await Template.build(browserTemplate(), {
    alias: TEMPLATE_ALIAS, cpuCount: TEMPLATE_CPU, memoryMB: TEMPLATE_MEMORY_MB, onBuildLogs: defaultBuildLogger(),
  });
  console.log('Built template:', JSON.stringify(info));
}
