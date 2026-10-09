import crypto from 'node:crypto';
import {saveChatProject,checkNewVisualCapacity} from '../lib/chatProjectSave.js';
import { waitUntil } from '@vercel/functions';
import { teamRunner } from '../lib/teamRunner.js';
import { chatRequest, requestKey } from '../lib/nexChatRequests.js';
import { createChatProgress } from '../lib/nexChatProgress.js';
import { INDIVIDUAL_WORK_MS } from '../lib/nexWorkTiming.js';
// /pages/api/chat.js
// Nex's visible chat endpoint — thin wrapper around the shared brain
// in lib/nexBrain.js. Handles the KV-backed rolling history so the
// dashboard shows real conversation continuity; the actual thinking
// (tools, identity, memory) all lives in nexBrain now.

import { initSentry, Sentry } from '../lib/sentry.js';
import { askNex, MODEL_TIERS } from '../lib/nexBrain.js';
import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import {
  clearConversationThreads,
  clearConversationMessages,
  deleteConversationThread,
  listConversationThreads,
  loadConversationThread,
  loadRecentConversation,
  normalizeThreadId,
  recentKeyFor,
  saveConversationThread,
  saveRecentConversation,
} from '../lib/nexConversationStore.js';
import { nexusMessagesStore } from '../lib/nexusMessagesStore.js';
import { teamRunStore } from '../lib/teamRuns.js';

export const config = { maxDuration: 300 };

// ============================================================
// SHORT-TERM ROLLING BUFFER — just enough for mid-conversation
// continuity ("what did you just say"). Long-term facts live in
// structured memory (lib/memory.js) instead of growing forever here.
// Every message resends this whole window to the active model API, so it's a
// direct token/cost tradeoff, not a free knob — bumped from 12 to 24
// (6 to 12 exchanges) since Nex sessions run long when actually
// building something. Tune further either direction if it feels off.
// ============================================================
const RECENT_LIMIT = 24; // ~12 exchanges

function normalizeScreenSnapshot(input) {
  if (!input || typeof input !== 'object') return null;
  const clip = (value, limit) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, limit) : '';
  const list = (value, itemLimit, maxItems) => Array.isArray(value) ? value.map((item) => clip(item, itemLimit)).filter(Boolean).slice(0, maxItems) : [];
  const title = clip(input.title, 180);
  const viewportText = list(input.viewport_text, 240, 30);
  const controls = list(input.controls, 180, 40);
  const focused = clip(input.focused, 360);
  const viewport = input.viewport && typeof input.viewport === 'object' ? {
    width: Number.isFinite(input.viewport.width) ? Math.max(0, Math.min(input.viewport.width, 10000)) : null,
    height: Number.isFinite(input.viewport.height) ? Math.max(0, Math.min(input.viewport.height, 10000)) : null,
    scroll_y: Number.isFinite(input.viewport.scroll_y) ? Math.max(0, Math.min(input.viewport.scroll_y, 10000000)) : null,
  } : null;
  const storyProjectId = /^[a-zA-Z0-9_-]{1,120}$/u.test(String(input.story_project_id || ''))
    ? String(input.story_project_id)
    : null;
  if (!title && !viewportText.length && !controls.length && !focused && !viewport && !storyProjectId) return null;
  return { title, viewport_text: viewportText, controls, focused, viewport, story_project_id:storyProjectId };
}

function normalizeVisualFrame(input) {
  if (!input || typeof input !== 'object') return null;
  const match = typeof input.image_data_url === 'string'
    ? input.image_data_url.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/u)
    : null;
  if (!match || match[2].length > 2_800_000) return null;
  const width = Number.isFinite(input.width) ? Math.max(1, Math.min(Math.round(input.width), 4096)) : null;
  const height = Number.isFinite(input.height) ? Math.max(1, Math.min(Math.round(input.height), 4096)) : null;
  return {
    media_type: match[1],
    data: match[2],
    width,
    height,
    captured_at: Number.isFinite(input.captured_at) ? input.captured_at : null,
  };
}

function normalizeClientContext(input) {
  const activeView = typeof input?.active_view === 'string' ? input.active_view.trim() : '';
  const conversationKind = ['specialist','group'].includes(input?.conversation?.kind) ? input.conversation.kind : null;
  const conversationId = /^[a-zA-Z0-9_-]{1,80}$/u.test(String(input?.conversation?.id || '')) ? String(input.conversation.id) : null;
  return {
    active_view: activeView.startsWith('/') && !activeView.startsWith('//')
      ? activeView.slice(0, 160)
      : null,
    screen: normalizeScreenSnapshot(input?.screen),
    visual: normalizeVisualFrame(input?.visual),
    conversation: conversationKind && conversationId ? { kind:conversationKind, id:conversationId } : null,
  };
}

async function resolveConversationContext(owner, requested) {
  if (!requested) return null;
  const state = await nexusMessagesStore.overview(owner);
  if (requested.kind === 'specialist') {
    const specialist = state.specialists.find((item) => item.id === requested.id);
    return specialist ? { kind:'specialist', ...specialist } : null;
  }
  const group = state.groups.find((item) => item.id === requested.id);
  if (!group) return null;
  const recentTeam=(await teamRunStore.list(owner,group.id).catch(()=>[])).slice(0,2);
  const team_brief=recentTeam.map(run=>JSON.stringify({goal:run.goal,state:run.state,steps:run.steps.map(step=>({name:step.name,state:step.state,result:step.result?.slice(0,1500),evidence:step.evidence}))})).join('\n');
  return { kind:'group', ...group, team_brief, members:group.member_ids.map((id) => state.specialists.find((item) => item.id === id)).filter(Boolean) };
}


async function loadRecent(operatorUser) {
  recentKeyFor(operatorUser); // fail closed before touching storage
  return loadRecentConversation(operatorUser);
}

async function saveRecent(operatorUser, fullHistory) {
  return saveRecentConversation(operatorUser, fullHistory.slice(-RECENT_LIMIT));
}

async function loadConversation(operatorUser, threadId) {
  if (!threadId) return loadRecent(operatorUser);
  const thread = await loadConversationThread(operatorUser, threadId);
  return thread?.messages || [];
}

async function saveConversation(operatorUser, fullHistory, threadId) {
  if (!threadId) return saveRecent(operatorUser, fullHistory);
  return saveConversationThread(operatorUser, {
    id: threadId,
    title: fullHistory.find((message) => message?.role === 'user')?.content,
    messages: fullHistory,
  });
}

// ============================================================
// HANDLER
// ============================================================
export default async function handler(req, res) {
  initSentry();
  const owner = await getNexusOwner(req).catch(() => null);
  if (!owner) return res.status(401).json({ error: 'Nexus owner authentication required.' });
  const operatorUser = owner.id;

  // GET — used by the frontend on page load to re-render whatever
  // conversation is already saved, instead of always showing the
  // same hardcoded starter message.
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.query?.requestId) {
        const request = await chatRequest(operatorUser, req.query.requestId);
        return res.status(200).json({ request });
      }
      if (String(req.query?.threads || '') === '1') {
        const threads = await listConversationThreads(operatorUser);
        return res.status(200).json({ threads });
      }
      const requestedThreadId = req.query?.threadId ? normalizeThreadId(req.query.threadId) : null;
      const recent = await loadConversation(operatorUser, requestedThreadId);
      return res.status(200).json({ messages: recent });
    } catch (err) {
      if (req.query?.requestId) return res.status(503).json({ error: 'Request status is temporarily unavailable.' });
      console.error('GET /api/chat failed to load history:', err.message);
      return res.status(200).json({ messages: [] });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, message, model, workspace, effort, deepThought, resumeRunId, forceSkill, requestId } = req.body || {};
  let threadId = null;
  try {
    threadId = req.body?.threadId ? normalizeThreadId(req.body.threadId) : null;
  } catch {
    return res.status(400).json({ error: 'Invalid thread id' });
  }
  if(action==='clear_thread'){
    if(!threadId)return res.status(400).json({error:'A thread id is required'});
    try{
      const runs=await teamRunStore.list(operatorUser,threadId);
      if(runs.some(run=>['queued','running','stopping'].includes(run.state)))return res.status(409).json({error:'Let this chat finish its current work before clearing it.'});
      return res.status(200).json(await clearConversationMessages(operatorUser,threadId));
    }catch(error){return res.status(503).json({error:'Could not check and preserve important details. Your chat is still available. Try again.'});}
  }
  if (action === 'delete_thread') {
    if (!threadId) return res.status(400).json({ error: 'A thread id is required' });
    const deleted = await deleteConversationThread(operatorUser, threadId);
    return res.status(200).json({ deleted });
  }
  if (action === 'clear_threads') {
    try {
      const result = await clearConversationThreads(operatorUser, req.body?.keepThreadIds);
      return res.status(200).json(result);
    } catch {
      return res.status(503).json({ error:'Those conversations could not be cleared. Please try again.' });
    }
  }
  if (action === 'save_thread') {
    if (!threadId) return res.status(400).json({ error: 'A thread id is required' });
    const thread = await saveConversationThread(operatorUser, {
      id: threadId,
      title: req.body?.title,
      updated_at: Number(req.body?.updated_at) || undefined,
      messages: req.body?.messages,
    });
    return res.status(200).json({
      thread: { id:thread.id, title:thread.title, updated_at:thread.updated_at, message_count:thread.messages.length },
    });
  }
  if (!message) return res.status(400).json({ error: 'Missing message' });
  const wantsBuildStream = String(req.headers.accept || '').includes('text/event-stream');
  let buildStreamStarted = false;
  let tracked = false;
  if (requestId) {
    try { requestKey(operatorUser, requestId); } catch { return res.status(400).json({ error: 'Invalid request id' }); }
  }
  const saveStatus = async (value) => {
    if (requestId) await chatRequest(operatorUser, requestId, { ...value, updatedAt: Date.now() }).catch(() => {});
  };
  const sendBuildEvent = (event, payload) => {
    if (buildStreamStarted && !res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const progress=createChatProgress({
    save:value=>saveStatus({state:'running',...value}),
    emit:sendBuildEvent,
  });

  // The installed iPhone app may be suspended as soon as Mr. Lopez switches
  // away from it. For workspace requests, acknowledge immediately and let a
  // server-to-server invocation own the real Nex turn. The request status and
  // final conversation are durable, so closing the app cannot sever the work.
  if (req.body?.respondAsync === true && process.env.VERCEL_URL) {
    if (!requestId) return res.status(400).json({ error: 'A request id is required for background work.' });
    await saveStatus({ state: 'queued' });
    const cookie = String(req.headers?.cookie || '');
    const backgroundBody = { ...req.body, respondAsync: false };
    const work = fetch(`https://${process.env.VERCEL_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(backgroundBody),
    }).then(async (response) => {
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`Background Nex request failed (${response.status})`);
    }).catch(async (error) => {
      console.error('Background Nex request failed:', error.message);
      const latest=await chatRequest(operatorUser,requestId).catch(()=>null);
      if(['finished','failed'].includes(latest?.state))return;
      await saveStatus({
        ...latest,
        state: 'failed',
        error: 'Nex could not finish that request. Your message is saved and can be retried.',
      });
    });
    waitUntil(work);
    return res.status(202).json({ requestId, state: 'queued' });
  }

  // model is an optional tier override from the model picker: 'cheap',
  // 'standard', or 'heavy'. Anything else (including 'auto', missing,
  // or a typo) falls through to normal auto-routing in askNex.
  const forcedTier = MODEL_TIERS[model] ? model : null;

  // effort is an optional reasoning-depth override from the same picker
  // row. Anthropic only allows disabling thinking (deepThought: false,
  // below) at effort high or below, so xhigh/max are deliberately not
  // offered in the UI at all -- only low/medium/high are valid here.
  const ALLOWED_EFFORT_LEVELS = new Set(['low', 'medium', 'high']);
  const forcedEffort = ALLOWED_EFFORT_LEVELS.has(effort) ? effort : undefined;
  // deepThought is an optional boolean toggle; anything but an explicit
  // `false` leaves Nex's normal adaptive-thinking-on default untouched.
  const deepThoughtEnabled = deepThought === false ? false : undefined;
  const deepThoughtRequested = deepThought === true;
  // forceSkill is an explicit override from the Skills panel's "force
  // this skill" button. Validated against the same shape as a real
  // skill name -- an invalid/garbage value just falls through to
  // normal keyword-matched skill selection rather than erroring.
  const SKILL_NAME_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
  const forcedSkill = typeof forceSkill === 'string' && SKILL_NAME_SHAPE.test(forceSkill.trim()) ? forceSkill.trim() : undefined;

  try {
    // Deliberate test hook — send this exact phrase to force a real error,
    // useful for confirming Sentry (or any error monitoring) is actually working.
    if (message.trim() === 'TEST_SENTRY_ERROR') {
      throw new Error('This is a deliberate test error, triggered on purpose to confirm Sentry is catching things.');
    }

    const recent = await loadConversation(operatorUser, threadId);
    const runningHistory = recent.filter((msg) => msg.role !== 'system');

    // A specialist or group is an owner-scoped server record, not a persona
    // supplied by the browser. Fail clearly when an old conversation points
    // at a record that was removed instead of silently turning it into Nex.
    const clientContext = normalizeClientContext(workspace);
    const requestedConversation = clientContext.conversation;
    clientContext.conversation = await resolveConversationContext(operatorUser, requestedConversation).catch(() => null);
    if (requestedConversation && !clientContext.conversation) {
      return res.status(404).json({
        error: 'This specialist or group is no longer available. Start a new conversation from Messages.',
      });
    }

    if(clientContext.conversation && threadId!==clientContext.conversation.id)return res.status(400).json({error:'Choose the matching specialist or group conversation.'});
    const collaborationThread=clientContext.conversation?.id || threadId || 'nex-main';
    if(/(^|\s)@[\p{L}\p{N}_"-]/u.test(message) || (clientContext.conversation?.kind==='group' && clientContext.conversation.include_nex===false)){
      try{
        const current=await teamRunner.group(operatorUser,collaborationThread);
        const run=await teamRunStore.create(operatorUser,collaborationThread,current.available_members || current.members,message,requestId || `chat-${crypto.randomUUID()}`,{includeNex:current.include_nex!==false,teamMemberIds:current.kind==='group'?current.member_ids:null});
        const response={reply:'Assignments saved in this conversation. Review the plan to start your agents.',model:'team-planner',usage:{input_tokens:0,output_tokens:0},teamRun:{id:run.id,thread_id:collaborationThread,state:run.state}};
        await saveConversation(operatorUser,[...runningHistory,{role:'user',content:message},{role:'assistant',content:response.reply}],collaborationThread);
        await saveStatus({state:'finished',response});
        return res.status(200).json(response);
      }catch(error){if(error.status)return res.status(error.status).json({error:error.message});throw error;}
    }
    const agentActivity=(await teamRunStore.list(operatorUser,collaborationThread).catch(()=>[])).slice(0,2).map(run=>JSON.stringify({goal:run.goal,state:run.state,steps:run.steps.map(step=>({name:step.name,state:step.state,result:step.result?.slice(0,3000)}))})).join('\n');

    tracked = true;
    await checkNewVisualCapacity(req,message);
    await saveStatus({ state: 'running' });
    if (wantsBuildStream) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.flushHeaders?.();
      buildStreamStarted = true;
      sendBuildEvent('stage', { state: 'running', tool: 'planning', label: 'Planning build' });
    }

    // Owner chat is direct-work-first. A dev-team handoff remains available
    // when explicitly requested, but ordinary build verbs do not force Nex
    // into a context-packaging workflow.
    const messageForModel = message;

    const {
      reply,
      updatedHistory,
      model: answeredModel,
      provider,
      usage,
      navigation,
      question,
      suggestedReplies,
      pendingApproval,
      cognitivePlan,
      contextManifest,
      completionReceipt,
      skills,
      capabilities,
      crew,
      runState,
      securityReceipt,
      degraded,
    } = await askNex(messageForModel, runningHistory, forcedTier, clientContext, (stage) => progress.record(stage), {providerTimeoutMs:INDIVIDUAL_WORK_MS,reasoningBudgets:{maxElapsedMs:INDIVIDUAL_WORK_MS},userId:operatorUser,threadId:collaborationThread,agentActivity,scheduleUserId:`owner:${operatorUser}`,storyProjectId:clientContext.screen?.story_project_id || null, effort:forcedEffort, deepThoughtEnabled, deepThoughtRequested, resumeRunId, forceSkill:forcedSkill});

    await progress.flush();

    // Store which model actually answered and token usage alongside the
    // message itself, so "who answered" and token count survive a page
    // reload — not just visible on the live response.
    const finalHistory = [
      ...updatedHistory,
      ...progress.snapshot().updates.filter(update=>update.text!==reply).map(update=>({role:'assistant',content:update.text})),
      { role: 'assistant', content: reply, model: answeredModel, usage },
    ];
    await saveConversation(operatorUser, finalHistory, threadId);
    let projectSaveError=null;try{await saveChatProject(req,collaborationThread,reply,message);}catch(error){projectSaveError=error.message;console.error('Chat project save failed:',error.message);}

    const response = {
      reply,projectSaveError,
      model: answeredModel,
      provider,
      usage,
      navigation,
      question,
      suggestedReplies,
      pendingApproval,
      cognitivePlan,
      contextManifest,
      completionReceipt,
      skills,
      capabilities,
      crew,
      runState,
      securityReceipt,
      degraded,
    };
    await saveStatus({ state: 'finished', response, ...progress.snapshot() });
    if (wantsBuildStream) {
      sendBuildEvent('stage', { state: 'complete', tool: 'planning', label: 'Build response ready' });
      sendBuildEvent('result', response);
      return res.end();
    }
    return res.status(200).json(response);
  } catch (err) {
    await progress.flush();
    if(err.status){await saveStatus({state:'failed',error:err.message});return res.status(err.status).json({error:err.message});}
    if (tracked) await saveStatus({ state: 'failed', error: 'Nex hit a server error. Inspect the last saved progress before trying again.', ...progress.snapshot() });
    console.error('Nex chat handler crashed:', err);
    Sentry.captureException(err);
    await Sentry.flush(2000); // wait for Sentry to actually send before the function ends
    if (buildStreamStarted) {
      sendBuildEvent('error', { error: 'Internal system error processing your message.' });
      return res.end();
    }
    return res.status(500).json({ error: 'Internal system error processing your message.' });
  }
}
