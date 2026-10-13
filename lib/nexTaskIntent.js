import {createHash} from 'node:crypto';
const normalize=value=>String(value || '').replace(/\s+/gu,' ').trim().toLowerCase();
export const requestFingerprint=message=>createHash('sha256').update(normalize(message)).digest('hex');
export function newBuildRequest(message){
 const text=normalize(message);
 if(/^(?:how|why|what|should i|is it)\b/iu.test(text))return false;
 if(/\b(?:existing|same|saved|current)\s+(?:project|page|site|website|app)\b/iu.test(text) && !/\b(?:fresh|new|another)\s+(?:project|page|site|website|app|build)\b/iu.test(text))return false;
 return /\b(?:build|create|make|design)\b[\s\S]*\b(?:page|site|website|app|project|tool|dashboard)\b/iu.test(text);
}
export function startsNewAssignment(message,state){
 if(!state?.resumed || !newBuildRequest(message))return false;
 const previous=state.requestFingerprint || requestFingerprint(state.goal);
 return requestFingerprint(message)!==previous;
}
