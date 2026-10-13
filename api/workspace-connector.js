import {createWorkspaceService,resolveWorkspaceAccount,validateWorkspaceInput,WORKSPACE_WRITES} from '../lib/workspaceConnector.js';
import {workspaceRequests} from '../lib/workspaceRequests.js';
export function createWorkspaceConnectorHandler({resolveAccount=resolveWorkspaceAccount,execute=createWorkspaceService(),once=workspaceRequests}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='POST')return res.status(405).json({error:'Use POST.',code:'METHOD_NOT_ALLOWED'});
    try{
      const account=await resolveAccount(req);
      const body=req.body;
      if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['action','input','request_id'].includes(k)))return res.status(400).json({error:'Provide action, input, and optional request_id only.',code:'INVALID_INPUT'});
      const {action,input={}}=body;validateWorkspaceInput(action,input);
      const run=()=>execute(action,input,account);
      const data=WORKSPACE_WRITES.has(action)?await once(account.id,body.request_id,action,input,run):await run();
      return res.status(200).json({ok:true,data});
    }catch(error){
      const status=error.status || (/not found/iu.test(error.message)?404:400);
      if(status>=500)console.error('Workspace connector failed:',error.message);
      return res.status(status).json({ok:false,error:status>=500?'Nexus storage is temporarily unavailable. Refresh before retrying.':error.message,code:error.code || (status===402?'PROJECT_LIMIT_REACHED':'WORKSPACE_ACTION_FAILED'),...(status===402?{upgrade_url:'https://nexus-labs-sigma.vercel.app/workspace.html?view=workbench'}:{})});
    }
  };
}
export default createWorkspaceConnectorHandler();
