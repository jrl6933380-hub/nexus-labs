import {ownerWorkbenchUsername} from './roomAuth.js';

// Account selection is derived only from authenticated sessions or stored grants.
// Customer IDs cannot collide with the private owner's custom-board/journal keys.
export function customerWorkspaceAccount(username){
 if(typeof username!=='string' || !/^[a-zA-Z0-9_-]{3,32}$/u.test(username))throw new Error('A signed-in Nexus account is required.');
 return {id:'customer:'+username,owner:false,workbenchUserId:username,scheduleUserId:'room:'+username};
}
export function ownerWorkspaceAccount(id){
 return {id,owner:true,workbenchUserId:ownerWorkbenchUsername(),scheduleUserId:'owner:'+id};
}
export function validWorkspaceAccount(account,ownerId){
 if(!account || typeof account!=='object')return false;
 const expected=account.owner===true?ownerWorkspaceAccount(ownerId):account.owner===false?(()=>{try{return customerWorkspaceAccount(account.workbenchUserId);}catch{return null;}})():null;
 return Boolean(expected && ['id','owner','workbenchUserId','scheduleUserId'].every(key=>account[key]===expected[key]));
}
