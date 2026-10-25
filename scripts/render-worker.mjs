#!/usr/bin/env node
import '../lib/store/installFetch.js';
// Render worker: claims queued render jobs (lib/adRenderJobs.js) and runs them with the real exporters. Run it anywhere
// that has Node 20+, Chromium (Playwright), ffmpeg and the same KV_REST_API_URL / KV_REST_API_TOKEN as the app:
//
//   node scripts/render-worker.mjs [--once] [--poll 3] [--chromium /path/to/chrome] [--worker-id name]
//
// It does not talk to any other service. Jobs carry a snapshot of the ad, so edits made after a render starts do not leak in.
import { adRenderJobStore } from '../lib/adRenderJobs.js';
import { workOnce } from '../lib/adRenderWorker.js';
import { createRunner } from '../lib/adRenderRunner.js';
import { adImageStore } from '../lib/adImages.js';
import { adMediaStore } from '../lib/adMedia.js';
import { hostname } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const args = (() => { const o = {}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { if (a[i] === '--once') o.once = true; else if (a[i].startsWith('--')) o[a[i].slice(2)] = a[++i]; } return o; })();
const chromium = args.chromium || process.env.CHROMIUM_PATH;
const workerId = args['worker-id'] || `${hostname()}-${process.pid}`;
const runner = createRunner({ chromium });

// Optional: --copy-to <dir> (or RENDER_COPY_DIR) also writes every finished file to <dir>/<job_id>/<name>, so a CI run can
// hand the video over as a downloadable artifact. The normal result upload to the store is unchanged.
const copyDir = args['copy-to'] || process.env.RENDER_COPY_DIR;
const store = !copyDir ? adRenderJobStore : new Proxy(adRenderJobStore, {
  get(target, prop) {
    if (prop === 'putFile') {
      return async (user, jobId, file) => {
        try {
          const dir = join(copyDir, basename(String(jobId)));
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, basename(String(file.name))), file.buffer);
        } catch (e) { console.error(`copy-to failed: ${e.message}`); }
        return target.putFile(user, jobId, file);
      };
    }
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

const resolveImages = async (user, ids) => {
  const lib = ids.filter((i) => !i.startsWith('med-')), med = ids.filter((i) => i.startsWith('med-'));
  const a = lib.length ? await adImageStore.resolve(user, lib) : { images: {}, missing: [] };
  const b = med.length ? await adMediaStore.resolveImages(user, med) : { images: {}, missing: [] };
  return { images: { ...a.images, ...b.images }, missing: [...a.missing, ...b.missing] };
};

const poll = Number(args.poll || 3) * 1000;
for (;;) {
  try {
    const job = await workOnce({ store, workerId, runner, resolveImages, media: adMediaStore });
    if (job) { console.log(JSON.stringify({ job_id: job.job_id, status: job.status, kind: job.kind, error: job.error?.code })); if (!args.once) continue; }
    if (args.once) break;
  } catch (e) { console.error(`worker error: ${e.message}`); if (args.once) { process.exitCode = 1; break; } }
  await new Promise((r) => setTimeout(r, poll));
}
