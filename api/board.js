// /api/board.js
import { readBoard, createTask, claimTask, updateProgress, markBlocked, attachResult, completeTask, postMessage } from '../lib/board.js';
import { startExecution, finishExecution, checkpointExecution, getExecutionResume, listExecutionEvents } from '../lib/executionLedger.js';
import { listAgents } from '../lib/agents.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [board, agents] = await Promise.all([readBoard(), listAgents()]);
      return res.status(200).json({ ...board, agents });
    }
    if (req.method === 'POST') {
      const { action, ...params } = req.body || {};
      if (!action) return res.status(400).json({ error: 'Missing action' });
      if (action === 'create_task') return res.status(200).json({ task: await createTask(params) });
      if (action === 'claim_task') return res.status(200).json({ task: await claimTask(params) });
      if (action === 'update_progress') return res.status(200).json({ task: await updateProgress(params) });
      if (action === 'mark_blocked') return res.status(200).json({ task: await markBlocked(params) });
      if (action === 'attach_result') return res.status(200).json({ task: await attachResult(params) });
      if (action === 'complete_task') return res.status(200).json({ task: await completeTask(params) });
      if (action === 'post_message') return res.status(200).json({ message: await postMessage(params) });
      if (action === 'start_execution') return res.status(200).json(await startExecution(params));
      if (action === 'finish_execution') return res.status(200).json({ event: await finishExecution(params) });
      if (action === 'checkpoint_execution') return res.status(200).json({ pointer: await checkpointExecution(params) });
      if (action === 'get_execution_resume') return res.status(200).json({ pointer: await getExecutionResume(params.run_id) });
      if (action === 'list_execution_events') return res.status(200).json({ events: await listExecutionEvents(params.run_id, params.limit) });
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('board handler crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
