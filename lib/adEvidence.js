// Visual evidence plan for review: which moments of an ad to look at so no short scene, transition, call to action or
// loop seam is missed. The old review sheet sampled four points across the whole ad; this picks shots from the
// structure instead. Pure data in and out; scripts/ad-evidence.mjs renders the shots through the stock player's
// capture barrier (the same frames the MP4 export produces).
//
//   const plan = evidencePlan(project);   // { shots:[{t_ms,label,kind,scene_id,...}], coverage:{...} }
export const EVIDENCE_LIMITS = Object.freeze({ minFrames: 8, maxFrames: 48, defaultFrames: 32 });
const PRIORITY = Object.freeze({ mid: 1, settled: 2, enter: 3, scene_start: 3, transition_edge: 3, transition: 4, cta: 5, loop_start: 6, loop_end: 6 });

export function evidencePlan(project, { maxFrames = EVIDENCE_LIMITS.defaultFrames, fps = 30 } = {}) {
  if (!project || !Array.isArray(project.scenes) || !project.scenes.length) throw new Error('A project with scenes is required.');
  const cap = Math.round(maxFrames);
  if (!Number.isFinite(cap) || cap < EVIDENCE_LIMITS.minFrames || cap > EVIDENCE_LIMITS.maxFrames) throw new Error(`maxFrames must be a whole number from ${EVIDENCE_LIMITS.minFrames} to ${EVIDENCE_LIMITS.maxFrames}.`);
  const totalMs = project.scenes.reduce((n, s) => n + s.duration * 1000, 0);
  const lastMs = totalMs - 1000 / fps;
  const raw = [];
  const add = (t, label, kind, scene, index, extra = {}) => raw.push({ t_ms: Math.round(Math.min(Math.max(t, 0), lastMs)), label, kind, scene_id: scene.id, scene_index: index, priority: PRIORITY[kind], ...extra });
  let start = 0;
  project.scenes.forEach((s, i) => {
    const D = s.duration * 1000, next = project.scenes[i + 1];
    const cut = !s.transitionOut || s.transitionOut === 'cut';
    if (i > 0) add(start, `${s.id}: first frame`, 'scene_start', s, i);
    add(start + Math.min(350, D * 0.2), `${s.id}: entrance`, 'enter', s, i);
    if (D >= 4000) add(start + D * 0.5, `${s.id}: middle`, 'mid', s, i);
    add(start + D * 0.85, s.type === 'end_card' ? `${s.id}: call to action` : `${s.id}: settled`, s.type === 'end_card' ? 'cta' : 'settled', s, i);
    if (next && !cut) {
      const win = Math.min(s.transitionMs || 400, D * 0.4), end = start + D;
      add(end - win * 0.75, `${s.id} to ${next.id} (${s.transitionOut}): 25%`, 'transition_edge', s, i, { transition: s.transitionOut });
      add(end - win * 0.4, `${s.id} to ${next.id} (${s.transitionOut}): 60%`, 'transition', s, i, { transition: s.transitionOut });
      add(end - win * 0.1, `${s.id} to ${next.id} (${s.transitionOut}): 90%`, 'transition_edge', s, i, { transition: s.transitionOut });
    }
    start += D;
  });
  const first = project.scenes[0], last = project.scenes[project.scenes.length - 1];
  add(0, 'loop: first frame', 'loop_start', first, 0);
  add(lastMs, 'loop: last frame', 'loop_end', last, project.scenes.length - 1);
  // Keep the higher-priority shot when two land within 80 ms of each other.
  raw.sort((a, b) => a.t_ms - b.t_ms || b.priority - a.priority);
  let shots = [];
  for (const s of raw) {
    const prev = shots[shots.length - 1];
    if (prev && s.t_ms - prev.t_ms < 80) { if (s.priority > prev.priority) shots[shots.length - 1] = s; continue; }
    shots.push(s);
  }
  // Over the cap: drop the lowest-priority shots first (latest first among equals), never a transition midpoint, call to action or loop frame.
  while (shots.length > cap) {
    let worst = -1;
    shots.forEach((s, i) => { if (s.priority < 4 && (worst < 0 || s.priority < shots[worst].priority || (s.priority === shots[worst].priority && s.t_ms >= shots[worst].t_ms))) worst = i; });
    if (worst < 0) break;
    shots.splice(worst, 1);
  }
  const has = (k) => shots.some((s) => s.kind === k);
  const covered = new Set(shots.map((s) => s.scene_id));
  const transitions = project.scenes.filter((s, i) => project.scenes[i + 1] && s.transitionOut && s.transitionOut !== 'cut').map((s) => s.id);
  return {
    totalMs, fps,
    shots: shots.map(({ priority, ...s }) => s),
    coverage: {
      scenes: project.scenes.length, scenes_covered: covered.size,
      transitions: transitions.length, transitions_covered: transitions.filter((id) => shots.some((s) => s.kind === 'transition' && s.scene_id === id)).length,
      cta: project.scenes.some((s) => s.type === 'end_card') ? has('cta') : null,
      loop_boundary: has('loop_start') && has('loop_end'),
      shortest_scene_ms: Math.min(...project.scenes.map((s) => s.duration * 1000)),
    },
  };
}
