// Per-account track library for Ad Maker. A track is NOT the audio file: it is what the board worked out from the
// file in the browser (length, tempo, loudness envelopes) plus the words, so an assistant can read lyrics and timing
// as data and wire them into an ad. Raw audio stays with the user. Same shape as the image library: pure validation
// plus an injectable store, no zod, so it runs anywhere.
import {randomBytes} from 'node:crypto';
import {AUDIO_MAX_SAMPLES} from '../public/ad-audio.mjs';

export const TRACK_LIMITS=Object.freeze({
  maxTracks:30,
  name:60,
  description:240,
  transcript:4000,
  maxWords:600,
  word:40,
  maxSeconds:600,
  songChars:40000,
});
export const TRACK_SOURCES=Object.freeze(['uploaded','recorded','generated_song']);
const ID=/^trk-[a-z0-9]{4,24}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const fail=(message,status=400,code='TRACK_INVALID')=>Object.assign(new Error(message),{status,code});
const key=user=>{if(typeof user!=='string'||!user)throw fail('Authenticated account required.',401,'UNAUTHORIZED');return 'nexus:ad-tracks:v1:'+encodeURIComponent(user);};
const round=(v,d=3)=>Math.round(v*10**d)/10**d;
const num=(v,label,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw fail(`${label} must be a number from ${min} to ${max}.`);return v;};

const clean=(v,max,label,{required=false}={})=>{
  if(v===undefined||v===null||v==='') {if(required)throw fail(`${label} is required.`);return '';}
  if(typeof v!=='string'||CONTROL.test(v.replace(/[\n\t]/g,'')))throw fail(`${label} must be plain text.`);
  const t=v.trim();
  if(required&&!t)throw fail(`${label} is required.`);
  if([...t].length>max)throw fail(`${label} is too long (max ${max} characters).`);
  return t;
};

function checkEnvelope(env){
  if(!env||typeof env!=='object')throw fail('envelope must be { rate, low, mid, high }.');
  const rate=num(env.rate,'envelope.rate',1,60);
  const out={rate:Math.round(rate)};
  let len=null;
  for(const band of ['low','mid','high']){
    const arr=env[band];
    if(!Array.isArray(arr)||arr.length<1||arr.length>AUDIO_MAX_SAMPLES)throw fail(`envelope.${band} must be a list of 1-${AUDIO_MAX_SAMPLES} numbers.`);
    if(len!==null&&arr.length!==len)throw fail('envelope.low, mid and high must be the same length.');
    len=arr.length;
    out[band]=arr.map((v,i)=>Math.round(num(v,`envelope.${band}[${i}]`,0,100)));
  }
  return out;
}
function checkWords(words,seconds){
  if(words===undefined||words===null)return [];
  if(!Array.isArray(words)||words.length>TRACK_LIMITS.maxWords)throw fail(`words must be a list of at most ${TRACK_LIMITS.maxWords} { w, s, e } entries.`);
  let last=0;
  return words.map((item,i)=>{
    if(!item||typeof item!=='object')throw fail(`words[${i}] must be { w, s, e }.`);
    const w=clean(item.w,TRACK_LIMITS.word,`words[${i}].w`,{required:true});
    const s=round(num(item.s,`words[${i}].s`,0,seconds+1)),e=round(num(item.e,`words[${i}].e`,0,seconds+1));
    if(e<s)throw fail(`words[${i}] ends before it starts.`);
    if(s<last-0.5)throw fail(`words[${i}] starts before the previous word. List words in time order.`);
    last=s;
    return {w,s,e};
  });
}
function checkSong(song){
  if(song===undefined||song===null)return null;
  if(typeof song!=='object'||Array.isArray(song))throw fail('song must be a song object (see describe_nexus_song).');
  const text=JSON.stringify(song);
  if(text.length>TRACK_LIMITS.songChars)throw fail(`song is too large (limit ${TRACK_LIMITS.songChars} characters).`);
  return JSON.parse(text);
}

/** Validates a full track, or the merged result of an update. `input` uses the connector's field names. */
export function validateTrackInput(input){
  const name=clean(input.name,TRACK_LIMITS.name,'name',{required:true});
  const description=clean(input.description,TRACK_LIMITS.description,'description');
  const source=input.source===undefined?'uploaded':input.source;
  if(!TRACK_SOURCES.includes(source))throw fail(`source must be one of ${TRACK_SOURCES.join(', ')}.`);
  const seconds=round(num(input.seconds,'seconds',0.5,TRACK_LIMITS.maxSeconds),2);
  let bpm=null,bpm_confidence=0,beat_offset=0;
  if(input.bpm!==undefined&&input.bpm!==null){
    bpm=round(num(input.bpm,'bpm',40,240),1);
    bpm_confidence=input.bpm_confidence===undefined?0:round(num(input.bpm_confidence,'bpm_confidence',0,1),2);
    beat_offset=input.beat_offset===undefined?0:round(num(input.beat_offset,'beat_offset',0,10),3);
  }
  const envelope=input.envelope===undefined||input.envelope===null?null:checkEnvelope(input.envelope);
  const transcript=clean(input.transcript,TRACK_LIMITS.transcript,'transcript');
  return {name,description,source,seconds,bpm,bpm_confidence,beat_offset,envelope,transcript,words:checkWords(input.words,seconds),song:checkSong(input.song)};
}

const meta=r=>({track_id:r.track_id,name:r.name,source:r.source,description:r.description,seconds:r.seconds,bpm:r.bpm,bpm_confidence:r.bpm_confidence,beat_offset:r.beat_offset,has_envelope:Boolean(r.envelope),has_transcript:Boolean(r.transcript),word_count:r.words.length,has_song:Boolean(r.song),transcript_preview:r.transcript.slice(0,120),created_at:r.created_at});

/**
 * Graphic-scene params for the part of a track that plays while a scene is on screen. `start` is where the scene
 * begins in the track (scenes run one after another, so it is the total length of the scenes before it).
 */
export function sceneParamsFor(record,{start=0,duration=15}={}){
  if(!record.envelope)throw fail('This track has no loudness envelope to wire into an ad.',409,'TRACK_NO_ENVELOPE');
  num(start,'start',0,TRACK_LIMITS.maxSeconds);num(duration,'duration',0.5,30);
  const {rate,low,mid,high}=record.envelope,from=Math.round(start*rate),to=Math.min(low.length,from+Math.ceil(duration*rate));
  if(from>=low.length)throw fail(`The track is only ${record.seconds}s long; start ${start}s is past the end.`);
  const out={audioRate:rate,audioLow:low.slice(from,to),audioMid:mid.slice(from,to),audioHigh:high.slice(from,to)};
  if(record.bpm){
    const spb=60/record.bpm;
    out.bpm=Math.max(60,Math.min(200,Math.round(record.bpm)));
    out.beatOffset=round((((record.beat_offset-start)%spb)+spb)%spb);
  }
  return out;
}

export function createAdTrackStore({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts),now=Date.now,newId=()=>'trk-'+randomBytes(5).toString('hex')}={}){
  const load=async(user,track_id)=>{
    if(typeof track_id!=='string'||!ID.test(track_id))throw fail('A valid track_id is required.');
    const raw=await command(['HGET',key(user),track_id]);
    if(!raw)throw fail('Track not found in your library.',404,'TRACK_NOT_FOUND');
    return JSON.parse(raw);
  };
  return {
    async list(user){
      const rows=(await command(['HVALS',key(user)])||[]).map(raw=>meta(JSON.parse(raw)));
      return {tracks:rows.sort((a,b)=>b.created_at-a.created_at),limit:TRACK_LIMITS.maxTracks};
    },
    async save(user,input){
      const v=validateTrackInput(input);
      const count=Number(await command(['HLEN',key(user)]))||0;
      if(count>=TRACK_LIMITS.maxTracks)throw fail(`Your track library is full (${TRACK_LIMITS.maxTracks} tracks). Delete one first.`,409,'TRACK_LIMIT');
      const track_id=newId();
      if(!ID.test(track_id))throw fail('Could not create a track id.',500,'TRACK_ID');
      const record={track_id,created_at:now(),...v};
      await command(['HSET',key(user),track_id,JSON.stringify(record)]);
      return {...meta(record),saved:true};
    },
    // Full record without the raw envelope arrays (large); ask for scene_start/scene_duration to get ready-to-use scene params.
    async read(user,track_id,{scene_start,scene_duration}={}){
      const r=await load(user,track_id);
      const {envelope,...rest}=r;
      const out={...rest,has_envelope:Boolean(envelope),envelope_rate:envelope?envelope.rate:null,envelope_samples:envelope?envelope.low.length:0};
      if(scene_start!==undefined||scene_duration!==undefined)out.scene_params=sceneParamsFor(r,{start:scene_start??0,duration:scene_duration??Math.min(15,r.seconds)});
      return out;
    },
    // Add or fix words, tempo, name, description or the song after the fact (for example once a transcript exists).
    async update(user,track_id,patch){
      const r=await load(user,track_id);
      const merged={...r};
      for(const k of ['name','description','transcript','words','bpm','bpm_confidence','beat_offset','song','envelope','seconds'])if(patch[k]!==undefined)merged[k]=patch[k];
      const v=validateTrackInput(merged);
      const record={track_id:r.track_id,created_at:r.created_at,...v};
      await command(['HSET',key(user),track_id,JSON.stringify(record)]);
      return {...meta(record),updated:true};
    },
    async remove(user,track_id){
      if(typeof track_id!=='string'||!ID.test(track_id))throw fail('A valid track_id is required.');
      const removed=Number(await command(['HDEL',key(user),track_id]))||0;
      if(!removed)throw fail('Track not found in your library.',404,'TRACK_NOT_FOUND');
      return {deleted:true,track_id};
    },
  };
}
export const adTrackStore=createAdTrackStore();
