import express from 'express';
import {mcpAuthRouter,createOAuthMetadata} from '@modelcontextprotocol/sdk/server/auth/router.js';
import {workspaceOAuth,WORKSPACE_ISSUER,WORKSPACE_RESOURCE,WORKSPACE_ORIGIN,WORKSPACE_SCOPES,allowedWorkspaceRedirect} from './workspaceOAuth.js';
export function createWorkspaceOAuthRouter({provider=workspaceOAuth}={}){
 const app=express();app.disable('x-powered-by');
 const options={provider,issuerUrl:new URL(WORKSPACE_ISSUER),resourceServerUrl:new URL(WORKSPACE_RESOURCE),scopesSupported:WORKSPACE_SCOPES,resourceName:'Nexus workspace'};
 app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');const redirect=res.redirect.bind(res);res.redirect=(status,url)=>{if(url===undefined){url=status;status=302;}if(allowedWorkspaceRedirect(String(url).split('?')[0])){const target=new URL(url);target.searchParams.set('iss',WORKSPACE_ISSUER);url=target.href;}return redirect(status,url);};next();});
 app.get('/.well-known/oauth-authorization-server',(_req,res)=>res.json({...createOAuthMetadata(options),token_endpoint_auth_methods_supported:['none'],authorization_response_iss_parameter_supported:true}));
 app.use(mcpAuthRouter(options));
 return app;
}
export const workspaceOAuthRouter=createWorkspaceOAuthRouter();
