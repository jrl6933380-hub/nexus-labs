import {createHash} from 'node:crypto';
import {teamCommand} from './teamRuns.js';

// Fixed-window limit on NEW guest accounts per IP, so the open landing page
// cannot be used to flood the user table.
export function clientIp(req){
 const forwarded=String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
 return forwarded || String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
}
export async function allowConnect(req,{limit=20,windowSeconds=3600,command=teamCommand,now=Date.now}={}){
 const bucket=Math.floor(now()/1000/windowSeconds);
 const key=`nexus:connect-rate:v1:${createHash('sha256').update(clientIp(req)).digest('hex').slice(0,32)}:${bucket}`;
 const count=Number(await command(['INCR',key]));
 if(count===1)await command(['EXPIRE',key,String(windowSeconds*2)]);
 return count<=limit;
}
