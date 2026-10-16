// Deterministic, validated scene edits for vocabulary (v2) ads. Pure functions: no I/O, no model.
// Every edit is applied to a copy, the whole result is re-validated with validateProjectV2, and a
// failure leaves the stored ad untouched.
import {z} from 'zod';
import {REGISTRY,LIMITS,validateProjectV2,totalDurationV2} from '../public/ad-vocabulary.mjs';

const ids=list=>list.map(item=>item.id);
const sceneId=z.string().regex(new RegExp(LIMITS.sceneIdPattern));
const paramsPatch=z.record(z.union([z.string(),z.number(),z.boolean(),z.null(),z.array(z.any()),z.record(z.any())])).describe('Fields to change on the scene. Merged into existing params; a null value removes that field.');
const look={
  duration:z.number().min(LIMITS.sceneSecMin).max(LIMITS.sceneSecMax),
  camera:z.enum(ids(REGISTRY.cameras)),
  background:z.enum(ids(REGISTRY.backgrounds)),
  transitionOut:z.enum(ids(REGISTRY.transitions)),
  transitionMs:z.number().min(LIMITS.transitionMsMin).max(LIMITS.transitionMsMax),
};
export const adEditOpSchema=z.discriminatedUnion('op',[
  z.object({op:z.literal('update_scene'),scene_id:sceneId,params:paramsPatch.optional(),duration:look.duration.optional(),camera:look.camera.optional(),background:look.background.optional(),transitionOut:look.transitionOut.nullable().optional(),transitionMs:look.transitionMs.nullable().optional()}).strict(),
  z.object({op:z.literal('add_scene'),after_scene_id:sceneId.optional(),scene:z.object({id:sceneId.optional(),type:z.enum(ids(REGISTRY.sceneTypes)),duration:look.duration,params:z.record(z.any()),camera:look.camera.optional(),background:look.background.optional(),transitionOut:look.transitionOut.optional(),transitionMs:look.transitionMs.optional()}).strict()}).strict(),
  z.object({op:z.literal('remove_scene'),scene_id:sceneId}).strict(),
  z.object({op:z.literal('move_scene'),scene_id:sceneId,to_index:z.number().int().min(0).max(LIMITS.scenesMax-1)}).strict(),
  z.object({op:z.literal('set_project'),name:z.string().min(1).max(LIMITS.name).optional(),mood:z.enum(ids(REGISTRY.moods)).optional(),palette:z.enum(ids(REGISTRY.palettes)).optional(),format:z.enum(ids(REGISTRY.formats)).optional()}).strict(),
]);
export const adEditSchema=z.object({
  campaign_id:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  baseline:z.string().max(120).optional(),
  edits:z.array(adEditOpSchema).min(1).max(10),
  dry_run:z.boolean().optional(),
}).strict();

const fail=message=>Object.assign(new Error(message),{status:400,code:'AD_INPUT_INVALID'});
const NO_CHANGE=['op','scene_id'];
const find=(project,id)=>{const i=project.scenes.findIndex(s=>s.id===id);if(i<0)throw fail(`Scene "${id}" not found. Scenes: ${project.scenes.map(s=>s.id).join(', ')}.`);return i;};
function freshId(project,type){const used=new Set(project.scenes.map(s=>s.id));const base=type.replace(/_/g,'-').slice(0,30);for(let n=1;n<1000;n++){const id=`${base}-${n}`;if(!used.has(id))return id;}throw fail('Could not generate a scene id.');}

export function applyAdEdits(current,rawEdits){
  const parsed=z.array(adEditOpSchema).min(1).max(10).safeParse(rawEdits);
  if(!parsed.success)throw fail('Invalid edit: '+parsed.error.issues.slice(0,6).map(i=>`${i.path.join('.')||'edit'}: ${i.message}`).join('; '));
  const project=JSON.parse(JSON.stringify(current)),changes=[];
  for(const e of parsed.data){
    if(e.op==='update_scene'){
      const i=find(project,e.scene_id),s=project.scenes[i];
      const fields=Object.keys(e).filter(k=>!NO_CHANGE.includes(k));
      if(!fields.length)throw fail(`update_scene for "${e.scene_id}" changes nothing.`);
      if(e.params){s.params={...s.params};for(const [k,v] of Object.entries(e.params)){if(v===null)delete s.params[k];else s.params[k]=v;}}
      for(const k of ['duration','camera','background']) if(e[k]!==undefined)s[k]=e[k];
      for(const k of ['transitionOut','transitionMs']) if(e[k]!==undefined){if(e[k]===null)delete s[k];else s[k]=e[k];}
      changes.push(`updated ${e.scene_id}: ${fields.join(', ')}`);
    }else if(e.op==='add_scene'){
      const at=e.after_scene_id?find(project,e.after_scene_id)+1:project.scenes.length;
      const id=e.scene.id||freshId(project,e.scene.type);
      if(project.scenes.some(s=>s.id===id))throw fail(`Scene id "${id}" already exists.`);
      project.scenes.splice(at,0,{...e.scene,id});changes.push(`added ${id} (${e.scene.type}) at position ${at+1}`);
    }else if(e.op==='remove_scene'){
      project.scenes.splice(find(project,e.scene_id),1);changes.push(`removed ${e.scene_id}`);
    }else if(e.op==='move_scene'){
      const i=find(project,e.scene_id),[s]=project.scenes.splice(i,1);project.scenes.splice(Math.min(e.to_index,project.scenes.length),0,s);changes.push(`moved ${e.scene_id} to position ${project.scenes.indexOf(s)+1}`);
    }else{
      const fields=['name','mood','palette','format'].filter(k=>e[k]!==undefined);
      if(!fields.length)throw fail('set_project changes nothing.');
      if(e.name!==undefined)project.name=e.name;
      if(e.mood!==undefined)project.mood=e.mood;
      if(e.palette!==undefined)project.palette=e.palette;
      if(e.format!==undefined)project.platform={...project.platform,format:e.format};
      changes.push('changed project '+fields.join(', '));
    }
  }
  // lengthSec is a label for the 6/15/30 s buckets; keep it honest after timing edits.
  const total=totalDurationV2(project),bucket=REGISTRY.lengths.map(l=>l.seconds).find(sec=>sec>=total);
  if(project.platform.lengthSec!==undefined&&bucket&&project.platform.lengthSec!==bucket){project.platform={...project.platform,lengthSec:bucket};changes.push(`length label set to ${bucket}s (total ${Math.round(total*100)/100}s)`);}
  const checked=validateProjectV2(project);
  if(!checked.ok)throw fail('Edit would make the ad invalid, nothing was changed: '+checked.errors.slice(0,6).join('; '));
  return {project:checked.value,changes};
}
