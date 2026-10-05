// /lib/venturesOverview.js
// Ambient, standing view across every venture canvas — not just the one
// currently open. Powers Nex's "how's everything looking?" from any
// canvas instead of only knowing about whichever one is on screen.
//
// Honest limitation: task linkage only works forward from here. A board
// task only shows up under a venture if it was created WITH that
// venture's canvas_id (create_venture_canvas does this automatically —
// see lib/nexBrain.js). Tasks created before this existed have no
// canvas_id and won't appear linked to any venture; they still show up
// on the plain Board, just not in this per-venture rollup.

import { listCanvases as listCanvasesReal, DEFAULT_CANVAS_ID } from './canvasState.js';
import { readBoard as readBoardReal } from './board.js';

const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // a week with no canvas activity

// listCanvases/readBoard are injectable (same pattern as
// lib/cleanupAgent.js's buildSystemStatus) so this is directly testable
// with fakes; real callers can omit them and get the real data.
export async function getVenturesOverview({
  listCanvases = listCanvasesReal,
  readBoard = readBoardReal,
  now = () => Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const [canvases, board] = await Promise.all([listCanvases(), readBoard()]);
  const tasks = board.tasks || [];
  const checkedAt = now();

  const ventures = canvases
    .filter((canvas) => canvas.id !== DEFAULT_CANVAS_ID)
    .map((canvas) => {
      const linkedTasks = tasks.filter((task) => task.canvas_id === canvas.id);
      const openTasks = linkedTasks.filter((task) => task.status !== 'complete');
      const needsAttention = linkedTasks.filter((task) => task.status === 'waiting_for_justin' || task.status === 'blocked');
      const lastActivity = canvas.updated_at || canvas.created_at || null;

      return {
        id: canvas.id,
        name: canvas.name,
        created_at: canvas.created_at,
        last_activity: lastActivity,
        stale: Boolean(lastActivity) && (checkedAt - lastActivity) > staleAfterMs,
        panel_count: Object.keys(canvas.panels || {}).length,
        tasks: {
          total: linkedTasks.length,
          open: openTasks.length,
          needs_attention: needsAttention.length,
        },
        url: `/canvas.html?id=${encodeURIComponent(canvas.id)}&name=${encodeURIComponent(canvas.name)}`,
      };
    })
    .sort((a, b) => (b.last_activity || 0) - (a.last_activity || 0));

  return {
    checked_at: checkedAt,
    venture_count: ventures.length,
    stale_count: ventures.filter((v) => v.stale).length,
    needs_attention_count: ventures.reduce((sum, v) => sum + v.tasks.needs_attention, 0),
    ventures,
  };
}
