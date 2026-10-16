// Deterministic brief -> vocabulary ad composer. No model call, no network, no cost.
// Uses only registry ids and never invents facts: every number, phone, price, offer, statistic or
// testimonial in the output must come from the brief itself. Output is always re-validated.
import {z} from 'zod';
import {REGISTRY,TAGS,LIMITS,validateProjectV2} from '../public/ad-vocabulary.mjs';

const ids=list=>list.map(item=>item.id);
const text=max=>z.string().max(max);
export const adBriefSchema=z.object({
  business_name:text(LIMITS.brand).min(1),
  industry:z.enum(TAGS.industry),
  goal:z.enum(TAGS.goal),
  hook:z.enum(TAGS.hook).optional(),
  mood:z.enum(ids(REGISTRY.moods)).optional(),
  palette:z.enum(ids(REGISTRY.palettes)).optional(),
  format:z.enum(ids(REGISTRY.formats)).optional(),
  length_sec:z.union(REGISTRY.lengths.map(l=>z.literal(l.seconds))).optional(),
  location:text(30).optional(),
  headline:text(LIMITS.headline).optional(),
  support:text(LIMITS.support).optional(),
  offer:text(LIMITS.headline).optional(),
  site_headline:text(65).optional(),
  cta:text(25).optional(),
  destination:text(65).optional(),
  concept:z.boolean().optional(),
  campaign_id:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).optional(),
  dry_run:z.boolean().optional(),
}).strict();

const MOOD_BY_INDUSTRY={plumber:'bold',cafe:'warm',salon:'luxury',restaurant:'warm',contractor:'bold',dental:'clean',fitness:'bold',retail:'playful',auto:'bold',other:'clean'};
// Questions and scenarios only: nothing here asserts a fact about the business.
const HOOKS={
  plumber:{question:'Need a plumber today?',pain_point:'Burst pipe at midnight?'},
  cafe:{question:'Where is your next coffee?',pain_point:'Another dull morning coffee?'},
  salon:{question:'Ready for a fresh look?',pain_point:'Bad hair day again?'},
  restaurant:{question:'What is for dinner tonight?',pain_point:'Too tired to cook?'},
  contractor:{question:'Planning a home project?',pain_point:'Project stuck on hold?'},
  dental:{question:'Due for a checkup?',pain_point:'Still putting off the dentist?'},
  fitness:{question:'Ready to start training?',pain_point:'Skipping the gym again?'},
  retail:{question:'Looking for something special?',pain_point:'Tired of the big stores?'},
  auto:{question:'Car trouble?',pain_point:'Warning light on again?'},
  other:{question:'Looking for a local business?',pain_point:'Need a hand with a project?'},
};
const SERVICE={plumber:'Plumbing services',cafe:'Coffee and breakfast',salon:'Hair and beauty',restaurant:'Local restaurant',contractor:'Home improvement',dental:'Dental care',fitness:'Fitness training',retail:'Local shop',auto:'Auto repair',other:'Local services'};
const CTA={call:'Call now',book:'Book today',visit:'Visit us',buy:'Shop now',signup:'Sign up'};
// Backgrounds (hook, site, end) and transition pair that suit each mood.
const LOOK={
  bold:{bg:['grain','grid','orbits'],tr:['wipe_left','crossfade']},
  warm:{bg:['gradient','grain','orbits'],tr:['crossfade','crossfade']},
  luxury:{bg:['gradient','gradient','orbits'],tr:['crossfade','crossfade']},
  playful:{bg:['particles','grid','orbits'],tr:['slide_up','zoom_through']},
  clean:{bg:['gradient','grid','solid'],tr:['crossfade','slide_up']},
};
const BG_SLOT={hook_text:0,site_mockup:1,end_card:2};
const CAMERA={hook_text:'push_in',site_mockup:'pull_out',end_card:'static'};
const LAYOUT={
  6:[['hook_text',3],['end_card',3]],
  15:[['hook_text',4.5],['site_mockup',5.5],['end_card',5]],
  30:[['hook_text',5],['hook_text',5],['site_mockup',8],['hook_text',4],['end_card',8]],
};
const clean=s=>String(s??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const clip=(s,max)=>{const a=[...clean(s)];return a.length<=max?a.join(''):a.slice(0,max-1).join('').trimEnd()+'…';};

export function composeAdFromBrief(input){
  const parsed=adBriefSchema.safeParse(input);
  if(!parsed.success)throw Object.assign(new Error('Invalid brief: '+parsed.error.issues.slice(0,6).map(i=>`${i.path.join('.')||'brief'}: ${i.message}`).join('; ')),{status:400,code:'AD_INPUT_INVALID'});
  const brief=parsed.data,notes=[];
  const name=clip(brief.business_name,LIMITS.brand);
  if(!name)throw Object.assign(new Error('business_name is required.'),{status:400,code:'AD_INPUT_INVALID'});
  const mood=brief.mood||MOOD_BY_INDUSTRY[brief.industry];
  const palette=brief.palette||(REGISTRY.palettes.find(p=>p.tags.mood.includes(mood)&&p.tags.industry.includes(brief.industry))||REGISTRY.palettes.find(p=>p.tags.mood.includes(mood))).id;
  const seconds=brief.length_sec||15,format=brief.format||'portrait',cta=clip(brief.cta||CTA[brief.goal],25);
  const look=LOOK[mood],textAnim=REGISTRY.moods.find(m=>m.id===mood).textAnim,concept=brief.concept!==false;
  let hook=brief.hook||'pain_point';
  if(hook==='offer'&&!clean(brief.offer)){notes.push('hook "offer" needs offer text; used a question hook instead.');hook='question';}
  if((hook==='stat'||hook==='proof')&&!clean(brief.headline)){notes.push(`hook "${hook}" needs your own sourced headline; used a question hook instead.`);hook='question';}
  const headline=clip(brief.headline||(hook==='offer'?brief.offer:HOOKS[brief.industry][hook==='pain_point'?'pain_point':'question']),LIMITS.headline);
  const support=clip(brief.support||name,LIMITS.support);
  const service=SERVICE[brief.industry]+(clean(brief.location)?' in '+clean(brief.location):'');
  const siteHeadline=clip(brief.site_headline||service,65);
  const destination=clean(brief.destination);
  const scenes=LAYOUT[seconds].map(([type,duration],i,all)=>{
    let params;
    if(type==='hook_text')params=i===0?{headline,support,textAnim}:{headline:i===1?clip(service,LIMITS.headline):'Ready when you are.',support:name,textAnim};
    else if(type==='site_mockup')params={siteName:clip(name,30),headline:siteHeadline,cta:cta.slice(0,25),style:mood==='clean'?'light':'dark',scroll:true};
    else params={cta,...(destination?{destination:clip(destination,65)}:{}),...(concept?{tagline:clip('Concept preview for '+name,60)}:{})};
    return {id:`s${i+1}`,type,duration,params,camera:CAMERA[type],background:look.bg[BG_SLOT[type]],...(i<all.length-1?{transitionOut:look.tr[i%2],transitionMs:420}:{})};
  });
  if(!destination)notes.push('No destination (phone/URL) was given, so none was added. Provide the real one before using this ad.');
  const project={specVersion:2,name:clip(`${name} · ${concept?'concept':'ad'}`,LIMITS.name),brand:name,initial:[...name][0].toUpperCase(),mood,palette,
    platform:{format,lengthSec:seconds},tags:{industry:brief.industry,goal:brief.goal,tone:mood,hook},...(concept?{concept:true}:{}),scenes};
  const checked=validateProjectV2(project);
  if(!checked.ok)throw Object.assign(new Error('Could not compose a valid ad: '+checked.errors.slice(0,5).join('; ')),{status:400,code:'AD_INPUT_INVALID'});
  return {project:checked.value,notes};
}
