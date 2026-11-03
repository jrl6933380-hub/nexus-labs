import {createHash,randomUUID} from 'node:crypto';
import {teamCommand} from './teamRuns.js';

export const AD_REVIEW_CHUNK_BYTES=131072;
export const AD_REVIEW_MAX_BYTES=8*1024*1024;
const TTL=90*86400;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const validProject=id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(id);
const base=owner=>'nexus:ally-ad-reviews:v1:'+encodeURIComponent(owner);
const metaKey=(owner,id)=>base(owner)+':'+id;
const chunkKey=(owner,id,part)=>metaKey(owner,id)+':chunk:'+part;
const indexKey=owner=>base(owner)+':index';
const safe=record=>record&&({id:record.id,project_id:record.project_id,title:record.title,status:record.status,created_at:record.created_at,updated_at:record.updated_at,bytes:record.bytes,duration_ms:record.duration_ms,review_note:record.review_note||'',sha256:record.sha256,device_id:record.device_id,revision_of:record.revision_of||null,revision_state:record.revision_state||null,revision_child_id:record.revision_child_id||null,revision_error:record.revision_error||null,revision_attempts:record.revision_attempts||0});
export function createAllyAdReviewQueue({command=teamCommand,now=Date.now}={}){
  async function read(owner,id){
    if(!validId(id))throw fail('Invalid review ID.');
    const raw=await command(['GET',metaKey(owner,id)]);
    if(!raw)throw fail('Review not found.',404);
    return JSON.parse(raw);
  }
  async function list(owner){
    const ids=await command(['LRANGE',indexKey(owner),'0','49'])||[];
    if(!ids.length)return [];
    const raws=await command(['MGET',...ids.map(id=>metaKey(owner,id))])||[];
    return raws.filter(Boolean).map(raw=>safe(JSON.parse(raw)));
  }
  async function begin(owner,device_id,input){
    const {project_id,title,bytes,sha256,duration_ms,revision_of}=input||{};
    if(!validProject(project_id))throw fail('Invalid ad project ID.');
    if(typeof title!=='string'||!title.trim()||title.length>120||/[\u0000-\u001f]/.test(title))throw fail('Invalid ad title.');
    if(!Number.isInteger(bytes)||bytes<128||bytes>AD_REVIEW_MAX_BYTES)throw fail('Video must be 128 bytes to 8 MB.');
    if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw fail('SHA-256 required.');
    if(!Number.isInteger(duration_ms)||duration_ms<500||duration_ms>120000)throw fail('Invalid ad duration.');
    const id=hash(project_id+'\n'+sha256).slice(0,32),key=metaKey(owner,id);
    if(revision_of!==undefined&&revision_of!==null){
      if(!validId(revision_of))throw fail('Invalid parent review ID.');
      const parent=await read(owner,revision_of);
      if(parent.device_id!==device_id||parent.project_id!==project_id||parent.status!=='rejected')throw fail('Revision must belong to the same project and active paired device.',403);
      if(parent.revision_state!=='claimed'&&!(parent.revision_state==='submitted'&&parent.revision_child_id===id))throw fail('Revision was not claimed by the Ally.',409);
      if(parent.id===id)throw fail('Revision must produce new video bytes.',409);
    }
    const existing=await command(['GET',key]);
    if(existing){const old=JSON.parse(existing);if(old.device_id!==device_id)throw fail('This review belongs to a different paired device.',409);return {id,part_bytes:AD_REVIEW_CHUNK_BYTES,status:old.status};}
    const record={id,project_id,title:title.trim(),bytes,sha256,duration_ms,device_id,status:'uploading',created_at:now(),updated_at:now(),review_note:'',...(revision_of?{revision_of}:{})};
    if(await command(['SET',key,JSON.stringify(record),'NX','EX',String(TTL)])==='OK'){
      await command(['LPUSH',indexKey(owner),id]);
      await command(['LTRIM',indexKey(owner),'0','49']);
      await command(['EXPIRE',indexKey(owner),String(TTL)]);
    }
    return {id,part_bytes:AD_REVIEW_CHUNK_BYTES,status:'uploading'};
  }
  async function part(owner,device_id,{id,index,data}={}){
    const record=await read(owner,id);
    if(record.device_id!==device_id)throw fail('Wrong paired device.',403);
    if(record.status!=='uploading')throw fail('This upload is closed.',409);
    const count=Math.ceil(record.bytes/AD_REVIEW_CHUNK_BYTES);
    if(!Number.isInteger(index)||index<0||index>=count)throw fail('Invalid part index.');
    const expected=index===count-1?record.bytes-index*AD_REVIEW_CHUNK_BYTES:AD_REVIEW_CHUNK_BYTES;
    if(typeof data!=='string'||data.length>Math.ceil(AD_REVIEW_CHUNK_BYTES/3)*4+4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw fail('Invalid base64 part.');
    const buffer=Buffer.from(data,'base64');
    if(buffer.length!==expected||buffer.toString('base64')!==data)throw fail('Part size or encoding mismatch.');
    const key=chunkKey(owner,id,index);
    const added=await command(['SET',key,data,'NX','EX',String(TTL)]);
    if(added!=='OK'&&await command(['GET',key])!==data)throw fail('Part already uploaded with different bytes.',409);
    return {accepted:true,index};
  }
  async function finish(owner,device_id,id){
    const record=await read(owner,id);
    if(record.device_id!==device_id)throw fail('Wrong paired device.',403);
    if(record.status==='pending_review'||record.status==='approved'||record.status==='rejected')return safe(record);
    if(record.status!=='uploading')throw fail('Upload is no longer open.',409);
    const count=Math.ceil(record.bytes/AD_REVIEW_CHUNK_BYTES), keys=Array.from({length:count},(_,i)=>chunkKey(owner,id,i));
    const raws=await command(['MGET',...keys])||[];
    if(raws.length!==count||raws.some(x=>typeof x!=='string'))throw fail('Upload is incomplete.',409);
    const buffers=raws.map(x=>Buffer.from(x,'base64')),video=Buffer.concat(buffers);
    if(video.length!==record.bytes||hash(video)!==record.sha256||video.toString('ascii',4,8)!=='ftyp')throw fail('Video integrity check failed.',422);
    const updated={...record,status:'pending_review',updated_at:now()};
    const cas="if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') return 1";
    if(Number(await command(['EVAL',cas,1,metaKey(owner,id),JSON.stringify(record),JSON.stringify(updated)]))!==1)throw fail('Upload state changed; refresh the queue.',409);
    return safe(updated);
  }
  async function decide(owner,id,decision,review_note=''){
    if(!['approved','rejected'].includes(decision))throw fail('Choose Approve or Request changes.');
    if(typeof review_note!=='string'||review_note.length>500||/[\u0000-\u0008\u000e-\u001f]/.test(review_note))throw fail('Review note too long.');
    const record=await read(owner,id);
    if(record.status===decision)return safe(record);
    if(record.status!=='pending_review')throw fail('Only pending ads can be decided.',409);
    if(decision==='rejected'&&review_note.trim().length<3)throw fail('Describe the requested changes (at least three characters).');
    const next={...record,status:decision,review_note:review_note.trim(),updated_at:now(),...(decision==='rejected'?{revision_state:'queued',revision_attempts:0,revision_error:null}:{})};
    // CAS prevents a second tab from overwriting an earlier review decision.
    const script="if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') return 1";
    if(Number(await command(['EVAL',script,1,metaKey(owner,id),JSON.stringify(record),JSON.stringify(next)]))!==1)throw fail('Review changed; refresh before deciding.',409);
    return safe(next);
  }
  async function claimRevision(owner,device_id){
    const ids=await command(['LRANGE',indexKey(owner),'0','49'])||[];
    for(const id of [...ids].reverse()){
      let record;
      try{record=await read(owner,id);}catch(e){if(e.status===404)continue;throw e;}
      if(record.device_id!==device_id||record.status!=='rejected')continue;
      const expired=record.revision_state==='claimed'&&now()-(record.revision_claimed_at||0)>60*60*1000;
      if(record.revision_state!=='queued'&&!expired)continue;
      if((record.revision_attempts||0)>=2)continue;
      const claim_id=randomUUID();
      const next={...record,revision_state:'claimed',revision_attempts:(record.revision_attempts||0)+1,revision_claim_id:claim_id,revision_claimed_at:now(),revision_error:null,updated_at:now()};
      if(Number(await command(['EVAL',"if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') return 1",1,metaKey(owner,id),JSON.stringify(record),JSON.stringify(next)]))!==1)continue;
      return {id,claim_id,project_id:record.project_id,title:record.title,review_note:record.review_note,attempt:next.revision_attempts};
    }
    return null;
  }
  async function revisionResult(owner,device_id,{id,claim_id,status,child_id,reason}={}){
    if(!validId(id)||typeof claim_id!=='string'||!/^[a-f0-9-]{36}$/.test(claim_id))throw fail('Invalid revision receipt.');
    if(!['submitted','failed'].includes(status))throw fail('Invalid revision status.');
    const record=await read(owner,id);
    if(record.device_id!==device_id)throw fail('Wrong paired device.',403);
    if(record.revision_state===status&&record.revision_claim_id===claim_id)return safe(record);
    if(record.status!=='rejected'||record.revision_state!=='claimed'||record.revision_claim_id!==claim_id)throw fail('Revision claim is no longer active.',409);
    if(status==='submitted'){
      if(!validId(child_id))throw fail('Revised review ID required.');
      const child=await read(owner,child_id);
      if(child.revision_of!==id||child.project_id!==record.project_id||child.device_id!==device_id||child.status==='uploading')throw fail('The revised video has not reached the private review inbox.',409);
    }else if(typeof reason!=='string'||reason.length>200)throw fail('Invalid revision error.');
    const next={...record,revision_state:status,revision_child_id:status==='submitted'?child_id:null,revision_error:status==='failed'?reason.trim().slice(0,200):null,updated_at:now()};
    const ok=await command(['EVAL',"if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') return 1",1,metaKey(owner,id),JSON.stringify(record),JSON.stringify(next)]);
    if(Number(ok)!==1)throw fail('Revision changed; refresh.',409);
    return safe(next);
  }
  async function retryRevision(owner,id){
    const record=await read(owner,id);
    if(record.status!=='rejected'||!['failed','claimed'].includes(record.revision_state))throw fail('Only stalled or failed revisions can be retried.',409);
    if(record.revision_state==='claimed'&&now()-(record.revision_claimed_at||0)<60*60*1000)throw fail('Qwen is still working; try later.',409);
    const next={...record,revision_state:'queued',revision_attempts:0,revision_error:null,revision_claim_id:null,updated_at:now()};
    const ok=await command(['EVAL',"if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') return 1",1,metaKey(owner,id),JSON.stringify(record),JSON.stringify(next)]);
    if(Number(ok)!==1)throw fail('Revision changed; refresh.',409);
    return safe(next);
  }
  async function videoRange(owner,id,range){
    const record=await read(owner,id);
    if(record.status==='uploading')throw fail('Video is still uploading.',409);
    const total=record.bytes;
    let start=0,end=total-1,partial=false;
    if(range!==undefined){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||(!match[1]&&!match[2]))throw fail('Invalid byte range.',416);
      if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)throw fail('Invalid byte range.',416);start=Math.max(0,total-suffix);}
      else{start=Number(match[1]);if(match[2])end=Number(match[2]);}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=total||end<start)throw fail('Invalid byte range.',416);
      end=Math.min(end,total-1);partial=true;
    }
    const first=Math.floor(start/AD_REVIEW_CHUNK_BYTES),last=Math.floor(end/AD_REVIEW_CHUNK_BYTES);
    const data=await command(['MGET',...Array.from({length:last-first+1},(_,j)=>chunkKey(owner,id,first+j))]);
    if(!Array.isArray(data)||data.some(x=>!x))throw fail('Video temporarily unavailable.',503);
    const bytes=Buffer.concat(data.map(x=>Buffer.from(x,'base64')));
    const part=bytes.subarray(start-first*AD_REVIEW_CHUNK_BYTES,end-first*AD_REVIEW_CHUNK_BYTES+1);
    return {data:part,start,end,total,partial,sha256:record.sha256};
  }
  return {list,begin,part,finish,decide,claimRevision,revisionResult,retryRevision,videoRange,read};
}
export const allyAdReviewQueue=createAllyAdReviewQueue();
