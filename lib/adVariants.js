// Deterministic ad variants: copy a saved vocabulary ad and change only its look (mood, palette,
// format) and, optionally, which stock hook question the first scene uses. No model call, no
// invented facts. Each variant goes through the same validated edit path as edit_nexus_ad.
import {z} from 'zod';
import {REGISTRY,LIMITS} from '../public/ad-vocabulary.mjs';
import {applyAdEdits} from './adEdit.js';
import {hookLine} from './adComposer.js';

const ids=list=>list.map(item=>item.id);
export const adVariantSpecSchema=z.object({
  mood:z.enum(ids(REGISTRY.moods)).optional(),
  palette:z.enum(ids(REGISTRY.palettes)).optional(),
  format:z.enum(ids(REGISTRY.formats)).optional(),
  hook:z.enum(['question','pain_point']).optional().describe('Swap the first scene to the stock question or pain-point line for this industry. Only for ads whose first scene is a hook and whose industry tag is set.'),
}).strict();
export const adVariantsSchema=z.object({
  campaign_id:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  count:z.number().int().min(2).max(4).optional().describe('Auto mode: make this many look variants with different mood/palette combinations.'),
  variants:z.array(adVariantSpecSchema).min(1).max(4).optional().describe('Explicit mode: one entry per variant.'),
  dry_run:z.boolean().optional(),
}).strict();

const fail=message=>Object.assign(new Error(message),{status:400,code:'AD_INPUT_INVALID'});
const paletteLabel=id=>REGISTRY.palettes.find(p=>p.id===id)?.label||id;

// Auto mode: palettes that suit the ad's industry first, never the current palette, one per mood where possible.
function autoSpecs(project,count){
  const industry=project.tags?.industry,pals=REGISTRY.palettes.filter(p=>p.id!==project.palette);
  const rank=p=>(industry&&p.tags.industry.includes(industry)?0:2)+(p.tags.mood.includes(project.mood)?1:0);
  const sorted=[...pals].sort((a,b)=>rank(a)-rank(b)||ids(REGISTRY.palettes).indexOf(a.id)-ids(REGISTRY.palettes).indexOf(b.id));
  const specs=[],seenMoods=new Set();
  for(const p of sorted){
    const mood=p.tags.mood.find(m=>!seenMoods.has(m))||p.tags.mood[0];
    seenMoods.add(mood);specs.push({mood,palette:p.id});
    if(specs.length===count)break;
  }
  return specs;
}

export function planVariants(project,{count,variants}={}){
  if(variants&&count)throw fail('Use either count or variants, not both.');
  const specs=variants?variants.map(v=>adVariantSpecSchema.parse(v)):autoSpecs(project,count||3);
  return specs.map((spec,i)=>{
    const edits=[];
    const setProject={op:'set_project'};
    if(spec.mood)setProject.mood=spec.mood;
    if(spec.palette)setProject.palette=spec.palette;
    if(spec.format)setProject.format=spec.format;
    // A mood change alone borrows a matching palette so the colors still suit the mood.
    if(spec.mood&&!spec.palette){const match=REGISTRY.palettes.find(p=>p.tags.mood.includes(spec.mood)&&(!project.tags?.industry||p.tags.industry.includes(project.tags.industry)))||REGISTRY.palettes.find(p=>p.tags.mood.includes(spec.mood));if(match)setProject.palette=match.id;}
    const label=[spec.mood&&REGISTRY.moods.find(m=>m.id===spec.mood)?.label,setProject.palette&&paletteLabel(setProject.palette),spec.format&&spec.format,spec.hook&&spec.hook.replace('_',' ')].filter(Boolean).join(' · ');
    if(!label)throw fail(`Variant ${i+1} changes nothing. Give it a mood, palette, format or hook.`);
    if(Object.keys(setProject).length>1)edits.push({...setProject,name:undefined});
    if(spec.hook){
      const first=project.scenes[0],line=hookLine(project.tags?.industry,spec.hook);
      if(!line||first?.type!=='hook_text')throw fail('hook variants need a first hook scene and an industry tag on the ad.');
      edits.push({op:'update_scene',scene_id:first.id,params:{headline:line}});
    }
    const name=`${project.name} · ${label}`.slice(0,LIMITS.name);
    edits.push({op:'set_project',name});
    return {label,edits:edits.map(e=>JSON.parse(JSON.stringify(e)))};
  });
}

export function buildVariants(project,request){
  return planVariants(project,request).map(({label,edits})=>{
    const {project:next,changes}=applyAdEdits(project,edits);
    return {label,project:next,changes};
  });
}
