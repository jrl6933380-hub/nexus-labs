// Local-only Qwen memory and chat continuity.
// Fixed paths beneath the current user's NexusAlly folder. No cloud sync.
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const MAX_MEMORIES=32;
const MAX_HISTORY=24;
const MAX_BYTES=50000;
const clean=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const queues=new Map();
async function serialize(root,fn){
 const prior=queues.get(root)||Promise.resolve();
 const next=prior.catch(()=>{}).then(fn);
 queues.set(root,next);
 try{return await next;}finally{if(queues.get(root)===next)queues.delete(root);}
}
async function read(root,name,fallback){
 const path=join(root,name);
 let content;
 try {
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('Invalid local Qwen data file');
  content=await readFile(path,'utf8');
 } catch(error) {
  if(error.code==='ENOENT')return fallback;
  throw error;
 }
 const data=JSON.parse(content);
 if(!Array.isArray(data))throw Error('Invalid local Qwen data format');
 return data;
}
async function write(root,name,items){
 await mkdir(root,{recursive:true,mode:0o700});
 const file=join(root,name),tmp=file+'.'+randomUUID()+'.tmp';
 await writeFile(tmp,JSON.stringify(items,null,2),{flag:'wx',mode:0o600});
 await rename(tmp,file);
}
const memValid=x=>x&&typeof x.id==='string'&&/^[0-9a-f-]{36}$/i.test(x.id)&&clean(x.text,350);
const msgValid=x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string'&&x.content.length<=1400&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(x.content);
export async function listMemories(root){
 const rows=await read(root,'memory.json',[]);
 if(rows.length>MAX_MEMORIES||!rows.every(memValid))throw Error('Invalid stored Qwen memory');
 return rows.map(x=>({id:x.id,text:x.text,createdAt:x.createdAt||null}));
}
export async function addMemory(root,text){
 if(!clean(text,350))throw Error('Memory must be 1–350 printable characters, on one line.');
 return serialize(root,async()=>{
  const rows=await listMemories(root);
  const value=text.trim();
  const same=rows.find(x=>x.text.toLowerCase()===value.toLowerCase());
  if(same)return same;
  const item={id:randomUUID(),text:value,createdAt:new Date().toISOString()};
  const updated=[...rows,item].slice(-MAX_MEMORIES);
  await write(root,'memory.json',updated);return item;
 });
}
export async function deleteMemory(root,id){
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid memory ID');
 return serialize(root,async()=>{
  const rows=await listMemories(root);
  const updated=rows.filter(x=>x.id!==id);
  if(updated.length===rows.length)return false;
  await write(root,'memory.json',updated);return true;
 });
}
export async function loadChat(root){
 const rows=await read(root,'chat-history.json',[]);
 if(rows.length>MAX_HISTORY||!rows.every(msgValid))throw Error('Invalid stored Qwen chat history');
 return rows;
}
export async function saveExchange(root,user,assistant){
 if(!clean(user,1400)||!clean(assistant,1400))throw Error('Invalid chat exchange');
 return serialize(root,async()=>{
  const rows=await loadChat(root);
  const next=[...rows,{role:'user',content:user.trim()},{role:'assistant',content:assistant.trim()}].slice(-MAX_HISTORY);
  await write(root,'chat-history.json',next);return next;
 });
}
export async function clearChat(root){return serialize(root,async()=>{await write(root,'chat-history.json',[]);return true;});}
export function memoryContext(notes){
 return notes.slice(-12).map(x=>x.text).filter(x=>clean(x,350)).join('\n').slice(0,1800);
}
export function suggestedMemory(message){
 if(typeof message!=='string')return null;
 const match=/^\s*(?:remember(?:\s+that|\s+this)?|save\s+(?:a\s+)?memory(?:\s+that)?|save\s+this\s+note)\s*[:,-]?\s+(.+)$/iu.exec(message);
 return match&&clean(match[1],350)?match[1].trim():null;
}
