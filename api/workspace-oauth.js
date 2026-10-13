import {workspaceOAuthRouter} from '../lib/workspaceOAuthRouter.js';
const paths={authorize:'/authorize',token:'/token',register:'/register',revoke:'/revoke',metadata:'/.well-known/oauth-authorization-server',resource:'/.well-known/oauth-protected-resource/api/workspace-mcp'};
export function createWorkspaceOAuthHandler({router=workspaceOAuthRouter}={}){return function handler(req,res){
 const route=req.query?.route;if(!Object.hasOwn(paths,route))return res.status(404).json({error:'Unknown OAuth endpoint.'});
 const params=new URLSearchParams();for(const [key,value] of Object.entries(req.query || {}))if(key!=='route' && typeof value==='string')params.set(key,value);
 req.url=paths[route]+(params.size?'?'+params.toString():'');
 return router(req,res);
};}
export default createWorkspaceOAuthHandler();
