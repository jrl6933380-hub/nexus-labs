import {randomBytes,createHash} from 'node:crypto';
import {teamCommand} from './teamRuns.js';

// One private, unguessable MCP address per customer account. The token is the
// credential: whoever holds the address can use that one customer's workspace.
// It is never valid for the owner account (the endpoint refuses operators).
const TOKEN_RE=/^nxc_[A-Za-z0-9_-]{43}$/u;
const USER_RE=/^[a-zA-Z0-9_-]{3,32}$/u;
const digest=value=>createHash('sha256').update(value).digest('hex');
const userKey=username=>`nexus:connect-token:v1:user:${username}`;
const tokenKey=token=>`nexus:connect-token:v1:token:${digest(token)}`;

export function createConnectTokenStore({command=teamCommand,generate=()=>`nxc_${randomBytes(32).toString('base64url')}`}={}){
 return {
  // Get-or-create. Stable across page refreshes so the same address is returned.
  async ensure(username){
   if(typeof username!=='string' || !USER_RE.test(username))throw new Error('A valid account is required.');
   let token=await command(['GET',userKey(username)]);
   if(!(typeof token==='string' && TOKEN_RE.test(token))){
    const fresh=generate();
    await command(['SET',userKey(username),fresh,'NX']);
    token=await command(['GET',userKey(username)]);
    if(!(typeof token==='string' && TOKEN_RE.test(token)))throw new Error('Could not create the connector address.');
   }
   await command(['SET',tokenKey(token),username]);
   return token;
  },
  // Token -> username, or null if invalid or revoked.
  async resolve(token){
   if(typeof token!=='string' || !TOKEN_RE.test(token))return null;
   const username=await command(['GET',tokenKey(token)]);
   return typeof username==='string' && USER_RE.test(username) ? username : null;
  },
  // Kills the address immediately. The next ensure() makes a brand new one.
  async revoke(username){
   if(typeof username!=='string' || !USER_RE.test(username))return false;
   const token=await command(['GET',userKey(username)]);
   if(typeof token==='string' && TOKEN_RE.test(token))await command(['DEL',tokenKey(token)]);
   await command(['DEL',userKey(username)]);
   return true;
  },
 };
}
export const connectTokens=createConnectTokenStore();
