// api/room-history.js
// Read access to a signed-in user's saved live-canvas room builds (see
// lib/roomHistory.js). Requires a valid session — see lib/roomAuth.js.
// GET with no query -> list of that user's past builds (metadata only, no html).
// GET ?id=<id>      -> one full saved build, including its html — only
//                      ever looked up within the caller's own history,
//                      so there's no cross-account access by id guessing.
// Downloading the html (?download=html) additionally requires a paid
// plan — Free tier can preview and iterate, but exporting code is one
// of the things that unlocks with the Hosted tier and above.

import {withProjectSaveLock} from '../lib/projectSaveLock.js';
import {projectDocumentTitle} from '../lib/projectName.js';
import { listBuilds, getBuild, getLatestBuildByProject, listProjects, saveBuild, deleteProject } from '../lib/roomHistory.js';
import { getRequestUser, getUserPlan, isOperatorUser, isPaidPlan, PLANS } from '../lib/roomAuth.js';
import { workbenchProjectAllowance } from '../lib/workbenchPlans.js';
import { getLiveSite, removeLiveSite, takeSiteOffline, listLiveSites } from '../lib/roomLiveSites.js';
import { deleteStaticSite } from '../lib/vercel.js';
import { getOrCreateAnonId } from '../lib/anonSession.js';

// Dependencies are injectable so ownership is exercised through the real handler.
export function createHistoryHandler({ resolveUser = getRequestUser, readBuild = getBuild, readLatestProject = getLatestBuildByProject, readList = listBuilds, readProjects = listProjects, writeBuild = saveBuild, removeProject = deleteProject, freeLiveSite = takeSiteOffline, readLiveSites = listLiveSites, readLiveSite = getLiveSite, deleteSite = deleteStaticSite, resolvePlan = getUserPlan, projectLock = async (_user,task)=>task() } = {}) {
return async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
  let username = await resolveUser(req);
  if (!username) username = getOrCreateAnonId(req, res);

    if (req.method === 'POST') return await projectLock(username,async()=>{
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if(body.action==='save_project_draft'){
        const projectId=String(body.projectId || ''),html=body.html;
        if(!/^[a-zA-Z0-9_-]{1,120}$/.test(projectId) || typeof html!=='string' || !html.trim() || html.length>100000)return res.status(400).json({error:'That project draft is not valid.'});
        const existing=await readLatestProject(username,projectId);
        if(existing){if(existing.html===html)return res.status(200).json({build:existing,projectId,alreadySaved:true});return res.status(409).json({error:'This project already has a saved version. Reopen it before saving.'});}
        const [projects,plan]=await Promise.all([readProjects(username),resolvePlan(username)]);const allowance=workbenchProjectAllowance(plan,isOperatorUser(username));
        if(projects.length>=allowance.limit)return res.status(402).json({error:'Your Projects limit is reached.',code:'PROJECT_LIMIT_REACHED'});
        const build=await writeBuild(username,{projectId,html,label:projectDocumentTitle(html,body.label),requestMessage:String(body.requestMessage || '').slice(0,4000),sourceConversation:body.sourceConversation});
        return res.status(201).json({build,projectId});
      }
      if (body.action === 'save_project_edit'  || body.action === 'restore_project_version') {
        const current = await readLatestProject(username, String(body.projectId || ''));
        if (!current) return res.status(404).json({ error: 'Project not found' });
        if (body.baseline !== current.id) return res.status(409).json({ error: 'This project changed. Reopen its latest version before saving.' });
        const version = body.action === 'restore_project_version' ? await readBuild(username, String(body.buildId || '')) : null;
        if (body.action === 'restore_project_version' && (!version || (version.projectId || version.id) !== (current.projectId || current.id))) return res.status(404).json({ error: 'Version not found in this project' });
        const html = version?.html || body.html;
        if (typeof html !== 'string' || !html.trim() || html.length > 100000) return res.status(400).json({ error: 'That project change is not valid.' });
        const build = await writeBuild(username, {projectId:current.projectId || current.id, label:current.label, html, requestMessage:body.action === 'restore_project_version' ? 'Restore a saved version' : 'Fine-tune project', sourceConversation:current.sourceConversation});
        return res.status(201).json({build,projectId:current.projectId || current.id});
      }
      if (body.action !== 'save_chat_visual') return res.status(400).json({ error: 'Unknown project action' });
      const html = typeof body.html === 'string' ? body.html.trim() : '';
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
      const requestMessage = typeof body.requestMessage === 'string' ? body.requestMessage.trim().slice(0, 4000) : '';
      const promotionId = typeof body.promotionId === 'string' ? body.promotionId.trim() : '';
      if (!html || html.length > 100000 || !promotionId || promotionId.length > 180 || !/^[a-zA-Z0-9_-]+$/.test(promotionId)) {
        return res.status(400).json({ error: 'That visual build is not valid.' });
      }
      const projectId = `chatvisual-${promotionId}`.slice(0, 120);
      const existing = await readLatestProject(username, projectId);
      if (existing) return res.status(200).json({ build: existing, projectId, alreadySaved: true });
      const [projects, plan] = await Promise.all([readProjects(username), resolvePlan(username)]);
      const allowance = workbenchProjectAllowance(plan, isOperatorUser(username));
      if (projects.length >= allowance.limit) {
        return res.status(402).json({ error: `Your ${allowance.planName} plan has reached its Projects limit.`, code: 'PROJECT_LIMIT_REACHED' });
      }
      const build = await writeBuild(username, {
        projectId,
        label: projectDocumentTitle(html,label || 'Saved chat build'),
        requestMessage,
        sourceConversation: body.sourceConversation,
        html: /^\s*<!doctype\b/i.test(html) || /^\s*<html\b/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`,
      });
      return res.status(201).json({ build, projectId, alreadySaved: false });
    });

    // DELETE ?projectId=<key> removes every saved version of one project.
    // Scoped to the caller's own history like every other path here, so a
    // guessed id can only ever delete something the caller already owns.
    if (req.method === 'DELETE') return await projectLock(username,async()=>{
      const projectId = (req.query || {}).projectId;
      if (typeof projectId !== 'string' || !projectId || projectId.length > 200) {
        return res.status(400).json({ error: 'A projectId is required' });
      }
      const result = await removeProject(username, projectId);
      if (!result.removed) return res.status(404).json({ error: 'Project not found' });
      // Deleting the project takes its live site down too — leaving a URL
      // serving a project the customer just deleted would be worse than
      // leaving the slot used. Best-effort: failing to tear down must not
      // fail the delete the customer asked for, and the log is how an
      // orphaned deployment gets noticed.
      try {
        await freeLiveSite({ userId: username, projectId, deleteSite });
      } catch (slotError) {
        console.error('room-history: taking the live site down failed:', slotError.message);
      }
      return res.status(200).json(result);
    });

    const { id, download } = req.query || {};
    if ((id !== undefined && (typeof id !== 'string' || !id || id.length > 200)) ||
        (download !== undefined && download !== 'html')) {
      return res.status(400).json({ error: 'Invalid export request' });
    }
    if (download && !id) return res.status(400).json({ error: 'Build id required' });
    if (id) {
      const build = await readBuild(username, id);
      if (!build) return res.status(404).json({ error: 'Build not found' });
      if (download === 'html') {
        const plan = await resolvePlan(username);
        if (!isPaidPlan(plan)) {
          return res.status(402).json({
            error: 'Exporting your code requires a paid plan.',
            code: 'EXPORT_REQUIRES_PAID_PLAN',
          });
        }
        if (typeof build.html !== 'string') throw new Error('Build HTML unavailable');
        // Never use a model-authored label or request input as a header/filename.
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="nexus-build.html"');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        return res.status(200).send(build.html);
      }
      let liveSite = null;
      if (build.projectId) {
        try { liveSite = await readLiveSite(username, build.projectId); }
        catch (liveError) { console.error('room-history: live-site lookup failed:', liveError.message); }
      }
      return res.status(200).json({
        build: {
          ...build,
          liveUrl: liveSite?.url || null,
          livePublishedAt: liveSite?.publishedAt || null,
        },
      });
    }
    const builds = await readList(username);
    const projects = await readProjects(username);
    // Attach each project's live URL so the panel can show what is actually
    // online and offer a way to take it down, rather than the customer
    // having to remember which of their projects they published.
    let liveByProject = new Map();
    try {
      const sites = await readLiveSites(username);
      liveByProject = new Map(sites.map((site) => [site.projectId, site.url || null]));
    } catch (liveError) {
      console.error('room-history: live-site lookup failed:', liveError.message);
    }
    const withLive = projects.map((project) => ({
      ...project,
      liveUrl: project.projectId ? liveByProject.get(project.projectId) ?? null : null,
    }));
    let plan = PLANS.FREE;
    try { plan = await resolvePlan(username); }
    catch (planError) { console.error('room-history: plan lookup failed:', planError.message); }
    const allowance = workbenchProjectAllowance(plan, isOperatorUser(username));
    // `builds` stays for anything still reading the flat version list;
    // `projects` is the one-row-per-project view the panel now renders.
    return res.status(200).json({
      builds,
      projects: withLive,
      workbench: {
        count: withLive.length,
        limit: allowance.limit,
        planName: allowance.planName,
        canCreate: withLive.length < allowance.limit,
      },
    });
  } catch (err) {
    if(err.status)return res.status(err.status).json({error:err.message});
    console.error('room-history handler crashed:', err.message);
    return res.status(500).json({ error: req.method==='POST'?'That change could not be saved. Try again.':'Failed to load room history' });
  }
};
}

export default createHistoryHandler({projectLock:withProjectSaveLock});
