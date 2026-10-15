import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {InvalidClientMetadataError,InvalidGrantError,InvalidRequestError,InvalidScopeError,InvalidTokenError} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {getSafeUser} from './roomAuth.js';
import {teamCommand} from './teamRuns.js';
import {ownerWorkspaceAccount,validWorkspaceAccount} from './workspaceAccount.js';
export const WORKSPACE_ORIGIN='https://nexus-labs-sigma.vercel.app';
export const WORKSPACE_ISSUER=WORKSPACE_ORIGIN+'/';
export const WORKSPACE_RESOURCE=WORKSPACE_ORIGIN+'/api/workspace-mcp';
export const WORKSPACE_SCOPES=['workspace:read','workspace:write'];
const random=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const key=(type,id)=>`nexus:workspace-oauth:v1:${type}:${hash(String(id))}`;
const CAS=`if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]) return 1`;
const TAKE=`if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('DEL',KEYS[1]) return 1`;
// Owner-pilot callback copied from Gemini's connection screen. No Google wildcard.
export const WORKSPACE_GEMINI_CALLBACK='https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-100822304877117152254-nexus-labs-sigma_vercel_app';
export function allowedWorkspaceRedirect(value){
 try{const u=new URL(value);if(value===WORKSPACE_GEMINI_CALLBACK)return true;return u.origin==='https://chatgpt.com' && !u.username && !u.password && !u.search && !u.hash && (u.pathname==='/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[a-zA-Z0-9_-]+$/u.test(u.pathname));}catch{return false;}
}
export function createWorkspaceOAuthProvider({command=teamCommand,now=Date.now,env=process.env,customerExists=async username=>Boolean(await getSafeUser(username))}={}){
 const ownerId=String(env.NEXUS_OWNER_ID || 'justin').trim().toLowerCase();
 if(!/^[a-z0-9_-]{3,32}$/u.test(ownerId))throw new Error('Owner identity is not configured.');
 const ownerAccount=ownerWorkspaceAccount(ownerId);
 function accountFor(identity){
  // Preserve the existing private-owner caller contract; customer identities are canonical server-created accounts.
  const account=identity?.owner===undefined && identity?.id===ownerId?ownerAccount:identity;
  if(!validWorkspaceAccount(account,ownerId))throw new InvalidRequestError('Sign in to your Nexus account first.');
  return account;
 }
 const seconds=()=>Math.floor(now()/1000);
 const read=async(type,id)=>{const raw=await command(['GET',key(type,id)]);return {raw,value:raw?JSON.parse(raw):null};};
 const write=(type,id,value,ttl)=>command(['SET',key(type,id),JSON.stringify(value),...(ttl?['EX',ttl]:[])]);
 function resource(value){if(String(value || '')!==WORKSPACE_RESOURCE)throw new InvalidRequestError('The resource must be the Nexus workspace MCP endpoint.');return WORKSPACE_RESOURCE;}
 function scopes(values){const result=[...new Set(values?.length?values:WORKSPACE_SCOPES)];if(result.some(s=>!WORKSPACE_SCOPES.includes(s)))throw new InvalidScopeError('Only workspace product permissions are supported.');return result;}
 const active=record=>record && record.expiresAt>seconds();
 async function grantActive(id){const {value}=await read('grant',id);return active(value)&&!value.revoked;}
 async function revoke(id){const {value}=await read('grant',id);if(value)await write('grant',id,{...value,revoked:true},Math.max(1,value.expiresAt-seconds()));}
 async function issue(clientId,permissions,grantId,grantExpiry,account){
  if(!validWorkspaceAccount(account,ownerId) || (!account.owner && !await customerExists(account.workbenchUserId)))throw new InvalidGrantError('Invalid workspace account. Reconnect to Nexus.');
  const access_token=random(),refresh_token=random(),accessExpiry=Math.min(seconds()+3600,grantExpiry);
  const base={clientId,account,scopes:permissions,resource:WORKSPACE_RESOURCE,grantId};
  await Promise.all([write('access',access_token,{...base,expiresAt:accessExpiry},Math.max(1,accessExpiry-seconds())),write('refresh',refresh_token,{...base,expiresAt:grantExpiry,used:false},Math.max(1,grantExpiry-seconds()))]);
  return {access_token,refresh_token,token_type:'Bearer',expires_in:accessExpiry-seconds(),scope:permissions.join(' ')};
 }
 const provider={
  clientsStore:{
   async getClient(id){return (await read('client',id)).value;},
   async registerClient(client){
    if(client.token_endpoint_auth_method!=='none' || !client.redirect_uris?.length || client.redirect_uris.length>5 || client.redirect_uris.some(uri=>!allowedWorkspaceRedirect(uri)))throw new InvalidClientMetadataError('Use a public PKCE client with an exact supported workspace callback.');
    if(client.grant_types?.some(t=>!['authorization_code','refresh_token'].includes(t)) || client.response_types?.some(t=>t!=='code'))throw new InvalidClientMetadataError('Only authorization-code and refresh-token grants are supported.');
    const record={...client,client_name:String(client.client_name || 'Workspace client').slice(0,100)};delete record.client_secret;delete record.client_secret_expires_at;
    await write('client',record.client_id,record);return record;
   },
  },
  async authorize(client,params,res){
   resource(params.resource);const permissions=scopes(params.scopes);
   if(!client.redirect_uris.includes(params.redirectUri) || !allowedWorkspaceRedirect(params.redirectUri))throw new InvalidRequestError('Unsupported callback.');
   if(!/^[a-zA-Z0-9_-]{43}$/u.test(params.codeChallenge))throw new InvalidRequestError('S256 PKCE is required.');
   const request=random();await write('pending',request,{clientId:client.client_id,clientName:client.client_name,redirectUri:params.redirectUri,state:params.state,codeChallenge:params.codeChallenge,scopes:permissions,resource:WORKSPACE_RESOURCE,csrf:random(),expiresAt:seconds()+600},600);
   res.redirect(302,WORKSPACE_ORIGIN+'/workspace-connect.html?request='+encodeURIComponent(request));
  },
  async pending(request,identity){
   const account=accountFor(identity);
   const {raw,value}=await read('pending',request);if(!active(value))throw new InvalidRequestError('This connection request expired. Start again from your connected app.');
   if(value.approvalAccountId!==account.id){
    value.approvalAccountId=account.id;value.csrf=random();
    if(await command(['EVAL',CAS,1,key('pending',request),raw,JSON.stringify(value),Math.max(1,value.expiresAt-seconds())])!==1)throw new InvalidRequestError('Connection request changed. Check sign-in again.');
   }
   return {client_name:value.clientName,callback_origin:new URL(value.redirectUri).origin,scopes:value.scopes,csrf:value.csrf,owner:account.owner?account.id:undefined,account:{name:account.owner?account.id:account.workbenchUserId,owner:account.owner}};
  },
  async consent({request,csrf,decision},identity){
   const account=accountFor(identity);
   const {raw,value}=await read('pending',request);if(!active(value) || value.approvalAccountId!==account.id || csrf!==value.csrf || !['allow','deny'].includes(decision))throw new InvalidRequestError('Invalid or expired connection approval.');
   if(await command(['EVAL',TAKE,1,key('pending',request),raw])!==1)throw new InvalidRequestError('This connection request was already used.');
   const target=new URL(value.redirectUri);if(value.state!==undefined)target.searchParams.set('state',value.state);target.searchParams.set('iss',WORKSPACE_ISSUER);
   if(decision==='deny')target.searchParams.set('error','access_denied');
   else{const code=random();await write('code',code,{...value,account,expiresAt:seconds()+300},300);target.searchParams.set('code',code);}
   return {redirect_url:target.href};
  },
  async challengeForAuthorizationCode(client,code){const {value}=await read('code',code);if(!active(value)||value.clientId!==client.client_id)throw new InvalidGrantError('Invalid or expired authorization code.');return value.codeChallenge;},
  async exchangeAuthorizationCode(client,code,_verifier,redirectUri,audience){
   resource(audience);const {raw,value}=await read('code',code);
   if(!active(value)||value.clientId!==client.client_id || redirectUri!==value.redirectUri)throw new InvalidGrantError('Invalid code, client, or callback.');
   // SDK tokenHandler already validated S256 PKCE before this method is called.
   if(await command(['EVAL',TAKE,1,key('code',code),raw])!==1)throw new InvalidGrantError('Authorization code was already used.');
   const account=accountFor(value.account);
   const grantId=randomUUID(),expiresAt=seconds()+30*86400;await write('grant',grantId,{clientId:client.client_id,account,scopes:value.scopes,expiresAt,revoked:false},30*86400);
   return issue(client.client_id,value.scopes,grantId,expiresAt,account);
  },
  async exchangeRefreshToken(client,token,requestedScopes,audience){
   resource(audience);const {raw,value}=await read('refresh',token);
   if(!active(value)||value.clientId!==client.client_id || !await grantActive(value.grantId))throw new InvalidGrantError('Invalid or expired refresh token.');
   if(value.used){await revoke(value.grantId);throw new InvalidGrantError('Refresh token was reused; reconnect to Nexus.');}
   const permissions=requestedScopes?.length?scopes(requestedScopes):value.scopes;if(permissions.some(s=>!value.scopes.includes(s)))throw new InvalidScopeError('Refresh cannot expand approved permissions.');
   if(await command(['EVAL',CAS,1,key('refresh',token),raw,JSON.stringify({...value,used:true}),Math.max(1,value.expiresAt-seconds())])!==1)throw new InvalidGrantError('Refresh token was already used.');
   return issue(client.client_id,permissions,value.grantId,value.expiresAt,value.account);
  },
  async verifyAccessToken(token){
   const {value}=await read('access',token);if(!active(value)||(!validWorkspaceAccount(value.account,ownerId) || (!value.account.owner && !await customerExists(value.account.workbenchUserId))) || value.resource!==WORKSPACE_RESOURCE || !await grantActive(value.grantId))throw new InvalidTokenError('Invalid, expired, or revoked workspace access token.');
   return {token,clientId:value.clientId,scopes:value.scopes,expiresAt:value.expiresAt,resource:WORKSPACE_RESOURCE,extra:{account:value.account}};
  },
  async revokeToken(client,{token}){for(const type of ['access','refresh']){const {value}=await read(type,token);if(value?.clientId===client.client_id){await revoke(value.grantId);return;}}},
 };
 return provider;
}
export const workspaceOAuth=createWorkspaceOAuthProvider();
