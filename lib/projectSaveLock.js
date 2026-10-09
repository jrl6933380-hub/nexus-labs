import crypto from 'node:crypto';
import {teamCommand} from './teamRuns.js';
export async function withProjectSaveLock(userId,task,{command=teamCommand}={}){
  const key=`nexus:project-save:${encodeURIComponent(userId)}`,token=crypto.randomUUID();
  if(await command(['SET',key,token,'NX','EX',30])!=='OK'){const error=new Error('Another project is saving. Try again in a moment.');error.status=409;throw error;}
  try{return await task();}finally{await command(['EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",1,key,token]);}
}
