import {connectTokens} from './customerConnectToken.js';
import {customerWorkspaceAccount} from './workspaceAccount.js';
import {isOperatorUser} from './roomAuth.js';
import {teamCommand} from './teamRuns.js';

// A private key is the credential, never a model-supplied username/account ID.
export const CUSTOMER_KEY_PATTERN=/^nxc_[A-Za-z0-9_-]{43}$/u;
export async function resolveCustomerAccount(token,{tokens=connectTokens,command=teamCommand}={}){
 if(typeof token!=='string' || !CUSTOMER_KEY_PATTERN.test(token))return null;
 const username=await tokens.resolve(token);
 if(!username || isOperatorUser(username))return null;
 if(!await command(['HGET','nexus:room:users',username]))return null;
 return customerWorkspaceAccount(username);
}
