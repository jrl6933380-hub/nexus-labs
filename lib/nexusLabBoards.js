import {cleanScene,sceneCommand} from '../public/board-scene-core.js';
import {randomUUID} from 'node:crypto';
import {isMediaId} from './adMedia.js';
import {getStore} from './store/index.js';

// Saved Boards for Nexus Lab: a free-form surface that holds any mix of inline visuals, pictures,
// clips, audio, notes and hand sketches. Pictures/clips/audio are only referenced by their Lab media id,
// so the originals stay in the shared media library and keep their provenance.
export const BOARD_LIMITS=Object.freeze({boards:40,items:150,bytes:110000,visualBytes:40000,noteChars:2000,strokes:200,points:6000,pointsPerStroke:400});
const KINDS=new Set(['visual','image','video','audio','note','sketch','scene']);
const LOOKS=new Set(['plain','grid','dots','paper','night']);
const NOTE_COLORS=new Set(['gold','green','sky','rose','paper']);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const ownerId=owner=>{if(typeof owner?.id!=='string'||!owner.id)throw fail('Owner authentication required.',401);return owner.id;};
const key=owner=>`nexus:lab-boards:v1:${encodeURIComponent(ownerId(owner))}:boards`;
const isId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/u.test(v);
const plain=(v,limit,label,{multiline=false}={})=>{if(v===undefined||v===null)return '';if(typeof v!=='string'||v.length>limit)throw fail(`${label} must be text under ${limit+1} characters.`);if((multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u:/[\u0000-\u001f\u007f]/u).test(v))throw fail(`${label} has characters that are not allowed.`);return v;};
const num=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw fail(`${label} must be a number from ${min} to ${max}.`);return Math.round(v*100)/100;};

function stroke(s){
  if(!s||typeof s!=='object'||Array.isArray(s))throw fail('A sketch stroke is not valid.');
  if(typeof s.c!=='string'||!/^#[0-9a-f]{6}$/iu.test(s.c))throw fail('A sketch stroke needs a #rrggbb color.');
  if(!Array.isArray(s.p)||s.p.length<1||s.p.length>BOARD_LIMITS.pointsPerStroke)throw fail('A sketch stroke has too many points.');
  return {c:s.c.toLowerCase(),s:num(s.s,1,60,'Brush size'),p:s.p.map(pt=>{if(!Array.isArray(pt)||pt.length!==2)throw fail('A sketch point is not valid.');return [num(pt[0],-1000,6000,'Sketch x'),num(pt[1],-1000,6000,'Sketch y')];})};
}
export function cleanItem(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw fail('Each board item must be an object.');
  if(!isId(raw.id))throw fail('Each board item needs an id.');
  if(!KINDS.has(raw.kind))throw fail('Choose a supported board item type.');
  const item={id:raw.id,kind:raw.kind,x:num(raw.x,-100000,100000,'Item x'),y:num(raw.y,-100000,100000,'Item y'),w:num(raw.w,20,6000,'Item width'),h:num(raw.h,20,6000,'Item height'),z:Math.round(num(raw.z??0,0,100000,'Item layer')),title:plain(raw.title,80,'Item title')};
  if(raw.kind==='visual'){
    const html=plain(raw.html,BOARD_LIMITS.visualBytes,'Visual code',{multiline:true});if(!html.trim())throw fail('A visual needs some code.');
    if(Buffer.byteLength(html)>BOARD_LIMITS.visualBytes)throw fail('That visual is too large for a board.');item.html=html;
    if(raw.scene_target_id!==undefined){if(!isId(raw.scene_target_id))throw fail('Choose a valid scene target.');item.scene_target_id=raw.scene_target_id;}
  }else if(raw.kind==='scene'){
    item.scene=cleanScene(raw.scene);
  }else if(raw.kind==='note'){
    item.text=plain(raw.text,BOARD_LIMITS.noteChars,'Note text',{multiline:true});
    if(raw.color!==undefined&&!NOTE_COLORS.has(raw.color))throw fail('Choose a supported note color.');item.color=raw.color||'gold';
  }else if(raw.kind==='sketch'){
    if(!Array.isArray(raw.strokes)||raw.strokes.length>BOARD_LIMITS.strokes)throw fail('That sketch has too many strokes.');
    item.strokes=raw.strokes.map(stroke);
  }else{
    if(!isMediaId(raw.media_id))throw fail('Choose a saved media asset.');item.media_id=raw.media_id;
    if(raw.kind==='video'||raw.kind==='audio'){if(raw.loop!==undefined)item.loop=raw.loop===true;}
  }
  return item;
}
export function cleanBoard(raw,{id}={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw fail('Supply a board.');
  const name=plain(raw.name,80,'Board name').trim();if(!name)throw fail('Give the board a name.');
  if(!Array.isArray(raw.items)||raw.items.length>BOARD_LIMITS.items)throw fail(`A board holds up to ${BOARD_LIMITS.items} items.`);
  const items=raw.items.map(cleanItem);if(new Set(items.map(i=>i.id)).size!==items.length)throw fail('Board item ids must be unique.');
  let points=0;for(const i of items)if(i.kind==='sketch')for(const s of i.strokes)points+=s.p.length;
  if(points>BOARD_LIMITS.points)throw fail('That board has too many sketch points. Clear or simplify a sketch.');
  const look=raw.look===undefined?'plain':raw.look;if(!LOOKS.has(look))throw fail('Choose a supported board look.');
  const bg=raw.bg===undefined?'':raw.bg;if(bg!==''&&!/^#[0-9a-f]{6}$/iu.test(bg))throw fail('Board color must be #rrggbb.');
  const v=raw.view||{};
  const board={id:id||raw.id,name,look,bg:bg.toLowerCase(),view:{x:num(v.x??0,-100000,100000,'View x'),y:num(v.y??0,-100000,100000,'View y'),z:num(v.z??1,0.2,4,'Zoom')},items};
  if(Buffer.byteLength(JSON.stringify(board))>BOARD_LIMITS.bytes)throw fail('This board is too large to save. Remove a big visual or sketch.',413);
  return board;
}
const parse=value=>typeof value==='string'?JSON.parse(value):value;
export function createNexusLabBoards({command=async args=>{const store=getStore();if(!store)throw fail('Board storage is unavailable.',503);return store.command(args);},now=Date.now,uuid=randomUUID}={}){
  const summary=b=>({id:b.id,name:b.name,look:b.look,items:b.items.length,rev:b.rev,updated_at:b.updated_at});
  async function get(owner,id){if(!isId(id))throw fail('Choose a saved board.');const value=await command(['HGET',key(owner),id]);return value?parse(value):null;}
  return {
    async list(owner){const raw=await command(['HGETALL',key(owner)]);const entries=Array.isArray(raw)?Array.from({length:raw.length/2},(_,i)=>raw[i*2+1]):Object.values(raw||{});
      return {boards:entries.map(parse).map(summary).sort((a,b)=>b.updated_at-a.updated_at),limits:BOARD_LIMITS};},
    async read(owner,id){const board=await get(owner,id);if(!board)throw fail('That board was not found.',404);return board;},
    // Saves a board. New boards get an id and rev 1. Existing boards must pass the revision they were opened at,
    // so a stale tab cannot silently overwrite a newer save.
    async save(owner,input){
      if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Supply a board.');
      const raw=input.board,existing=raw?.id?await get(owner,raw.id):null;
      if(raw?.id&&!isId(raw.id))throw fail('Choose a saved board.');
      if(existing&&input.base_rev!==existing.rev)throw fail('This board changed somewhere else. Reload it to keep the newer version.',409);
      if(!existing&&raw?.id&&input.base_rev!==undefined&&input.base_rev!==0)throw fail('That board no longer exists.',404);
      if(!existing){const list=await this.list(owner);if(list.boards.length>=BOARD_LIMITS.boards)throw fail(`You can keep up to ${BOARD_LIMITS.boards} boards. Delete one first.`,409);}
      const id=existing?.id||(isId(raw?.id)?raw.id:uuid().replace(/-/gu,'').slice(0,20));
      const board={...cleanBoard(raw,{id}),rev:(existing?.rev||0)+1,updated_at:now()};
      if(existing){
        const changed=await command(['EVAL',"local current=redis.call('HGET',KEYS[1],ARGV[1]); if current~=ARGV[2] then return 0 end; redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]); return 1",'1',key(owner),id,JSON.stringify(existing),JSON.stringify(board)]);
        if(!Number(changed))throw fail('This board changed somewhere else. Reload it to keep the newer version.',409);
      }else await command(['HSET',key(owner),id,JSON.stringify(board)]);
      return board;
    },
    async editScene(owner,{id,item_id,base_rev,commands}){
      if(!Array.isArray(commands)||!commands.length||commands.length>20)throw fail('Supply 1 to 20 scene commands.');
      const board=await this.read(owner,id);if(board.rev!==base_rev)throw fail('This board changed. Reload before editing the scene.',409);
      const item=board.items.find(i=>i.id===item_id&&i.kind==='scene');if(!item)throw fail('That scene was not found.',404);
      for(const command of commands)item.scene=sceneCommand(item.scene,command);
      return this.save(owner,{board,base_rev});
    },
    async remove(owner,id){const board=await get(owner,id);if(!board)throw fail('That board was not found.',404);await command(['HDEL',key(owner),id]);return {deleted:true,id};}
  };
}
export const nexusLabBoards=createNexusLabBoards();
