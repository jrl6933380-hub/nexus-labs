// The real renderer for render jobs: runs the existing export scripts (MP4, still, evidence) as child processes,
// turns their frame progress into job progress, and stops them when the job is canceled.
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = (name) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));

function run(chromium, script, argv, { signal, onProgress }) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [S(script), ...argv, ...(chromium ? ['--chromium', chromium] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '', out = '';
    const kill = () => child.kill('SIGKILL');
    signal.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      const text = String(d); err = (err + text).slice(-4000);
      for (const m of text.matchAll(/\((\d+)\/(\d+) frames\)/g)) onProgress(Number(m[1]), Number(m[2]));
    });
    child.on('error', rej);
    child.on('close', (code) => {
      signal.removeEventListener('abort', kill);
      if (signal.aborted) return rej(Object.assign(new Error('Canceled'), { name: 'AbortError' }));
      if (code !== 0) return rej(Object.assign(new Error(`${script} failed (exit ${code}). ${(err.trim().split('\n').pop() || '').slice(0, 300)}`), { code: 'EXPORT_FAILED', details: err }));
      res(out);
    });
  });
}

export const createRunner = ({ chromium } = {}) => async ({ kind, options, projectFile, imagesFile, audioFile, outDir, signal, onProgress }) => {
  if (kind === 'mp4') {
    const out = join(outDir, 'ad.mp4');
    await run(chromium, 'export-ad-mp4.mjs', ['--project', projectFile, '--images', imagesFile, '--out', out, '--fps', String(options.fps), '--scale', String(options.scale), '--crf', String(options.crf), ...(audioFile ? ['--audio', audioFile] : [])], { signal, onProgress });
    const manifest = JSON.parse(await readFile(join(outDir, 'ad.manifest.json'), 'utf8'));
    return { files: [{ name: 'ad.mp4', path: out, mime: 'video/mp4' }, { name: 'ad.manifest.json', path: join(outDir, 'ad.manifest.json'), mime: 'application/json' }], result: { frames: manifest.frames, duration_sec: manifest.durationSec, width: manifest.width, height: manifest.height, frames_sha256: manifest.framesSha256, audio: manifest.audio } };
  }
  if (kind === 'still') {
    const out = join(outDir, 'still.png');
    await run(chromium, 'export-ad-still.mjs', ['--project', projectFile, '--images', imagesFile, '--out', out, '--scale', String(options.scale), ...(options.at !== undefined ? ['--at', String(options.at)] : []), ...(options.scene ? ['--scene', options.scene] : []), ...(options.progress !== undefined ? ['--progress', String(options.progress)] : [])], { signal, onProgress });
    return { files: [{ name: 'still.png', path: out, mime: 'image/png' }], result: {} };
  }
  const dir = join(outDir, 'ev');
  await run(chromium, 'ad-evidence.mjs', ['--project', projectFile, '--images', imagesFile, '--out', dir, '--max-frames', String(options.max_frames), '--scale', String(options.scale)], { signal, onProgress });
  const frames = (await readdir(join(dir, 'frames'))).sort();
  const report = JSON.parse(await readFile(join(dir, 'evidence.json'), 'utf8'));
  return {
    files: [{ name: 'sheet.png', path: join(dir, 'sheet.png'), mime: 'image/png' }, { name: 'evidence.json', path: join(dir, 'evidence.json'), mime: 'application/json' }, ...frames.map((f) => ({ name: `frame-${f}`, path: join(dir, 'frames', f), mime: 'image/png' }))],
    result: { coverage: report.coverage, shots: report.shots.map((s) => ({ file: `frame-${s.file.split('/').pop()}`, t_ms: s.t_ms, label: s.label, kind: s.kind, scene_id: s.scene_id, same_as_previous: s.same_as_previous })) },
  };
};
