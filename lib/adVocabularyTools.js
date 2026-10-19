// Agent-facing side of the ad vocabulary: describe_nexus_ad_vocabulary output and the strict
// MCP input schema for vocabulary (specVersion 2) ads. Everything derives from the registry in
// public/ad-vocabulary.mjs so dropdowns, validation and agents can never disagree.
import {z} from 'zod';
import {REGISTRY,LIMITS,TAGS,describeVocabulary} from '../public/ad-vocabulary.mjs';
import {composeWorld3DBrief} from './adWorld3D.js';

const ids=list=>list.map(item=>item.id);
const pick=list=>z.enum(ids(list));
const hex=z.string().regex(/^#[\da-f]{6}$/i);
const tag=values=>z.enum(values).optional();

export const adProjectSchemaV2=z.object({
  specVersion:z.literal(2),
  name:z.string().min(1).max(LIMITS.name),
  brand:z.string().max(LIMITS.brand).optional(),
  initial:z.string().max(2).optional(),
  accent:hex.optional(),
  background:hex.optional(),
  mood:pick(REGISTRY.moods),
  palette:pick(REGISTRY.palettes).optional(),
  platform:z.object({format:pick(REGISTRY.formats),lengthSec:z.union(REGISTRY.lengths.map(l=>z.literal(l.seconds))).optional()}).strict(),
  tags:z.object({industry:tag(TAGS.industry),goal:tag(TAGS.goal),tone:tag(TAGS.tone),hook:tag(TAGS.hook)}).strict().optional(),
  concept:z.boolean().optional(),
  scenes:z.array(z.object({
    id:z.string().regex(new RegExp(LIMITS.sceneIdPattern)),
    type:pick(REGISTRY.sceneTypes),
    duration:z.number().min(LIMITS.sceneSecMin).max(LIMITS.sceneSecMax),
    params:z.record(z.any()).describe('Fields for this scene type, exactly as listed in describe_nexus_ad_vocabulary.'),
    camera:pick(REGISTRY.cameras).optional(),
    background:pick(REGISTRY.backgrounds).optional(),
    transitionOut:pick(REGISTRY.transitions).optional(),
    transitionMs:z.number().min(LIMITS.transitionMsMin).max(LIMITS.transitionMsMax).optional(),
  }).strict()).min(LIMITS.scenesMin).max(LIMITS.scenesMax),
}).strict();

// Scene types the stock player draws fully today; any listed under fallback render plain text.
export const PLAYER_SUPPORT=Object.freeze({full:['hook_text','site_mockup','end_card','stat_counter','testimonial','before_after','photo_focus','steps_list','graphic','world3d'],fallback:[]});

export const EXAMPLE_PROJECT=Object.freeze({
  specVersion:2,name:'Sample plumbing concept',brand:'SAMPLE PLUMBING',initial:'S',mood:'bold',palette:'midnight-gold',
  platform:{format:'portrait',lengthSec:15},tags:{industry:'plumber',goal:'call',tone:'bold',hook:'pain_point'},concept:true,
  scenes:[
    {id:'hook',type:'hook_text',duration:4,params:{headline:'Burst pipe at 2am?',support:'We answer.',textAnim:'kinetic_stack'},camera:'push_in',background:'grain',transitionOut:'wipe_left',transitionMs:450},
    {id:'site',type:'site_mockup',duration:5,params:{siteName:'Sample Plumbing',headline:'Fast, honest local plumbing',cta:'Call now',style:'dark',scroll:true},camera:'pull_out',background:'grid',transitionOut:'crossfade',transitionMs:400},
    {id:'close',type:'end_card',duration:4,params:{cta:'Call now',destination:'555-0100',tagline:'Concept preview'},background:'orbits'},
  ],
});

export const AD_AGENT_RULES=Object.freeze([
  'For dimensional products, props and studio shots use world3d: translate the prompt into objects, material, lights, ground contact and a cameraPath. Use metres, Y up, degrees. Compose supported primitives into parented assemblies; do not invent an uploaded model, real brand geometry, scanned textures, reflections, refraction or photorealistic people.',
  'world3d has a 64-object, 4-light budget, up to 32 transform keys per object and 16 camera keys. A plane at y=0 is the floor; centre a box at half its height to rest on it. Use a directional key light for mapped shadows, roughness/metalness for the surface and a perspective cameraPath for orbit/dolly. Use edit_nexus_ad for these scenes; 2D layer tools do not edit 3D objects.',
  'Use only ids from this vocabulary; unknown ids and fields are rejected by validation.',
  'Prefer the scene types in player_support.full; the others render a plain fallback until the player supports them.',
  'Set concept:true for any pitch to a prospect. Concept previews must never be presented as a live site, a real customer result or a finished campaign.',
  'Never invent statistics, testimonials, awards, prices, reviews or guarantees. Use stat_counter or testimonial only with facts the user supplied, and put their source in sourceRef.',
  'Write a hook of 7 words or fewer, one call to action, and one idea per scene.',
  'New ad: use a fresh campaign_id (for example ad-<random>) with no baseline. Edit: call read_nexus_ad first and pass its baseline. If a save is rejected, fix the listed fields and retry.',
  'Vocabulary ads cannot carry custom code; they render with the stock vocabulary player. Do not use save_nexus_ad_design on them.',
  'Do not convert an existing legacy ad: create a new one instead.',
  'To compare looks call make_nexus_ad_variants (new ads; the original is untouched).',
  'To change a saved v2 ad call edit_nexus_ad (scene updates, add/remove/move scenes, name/mood/palette/format) instead of resending the whole project; use dry_run:true to preview.',
  'For a quick first draft call create_nexus_ad_from_brief (dry_run:true previews without saving), then refine with save_nexus_ad_v2. Supply real phone/URL, offers and facts yourself; the composer never invents them.',
  'For a quick 3D draft call create_nexus_ad_from_brief with visual:"studio3d", subject:"bottle"|"device"|"headphones"|"sculpture", material, subject_color, lighting:"studio"|"warm"|"dramatic", camera_move:"orbit"|"dolly"|"static" and dry_run:true. This is a bounded concept constructor. Use world3d objects for compositions outside those presets; do not claim arbitrary prompt-to-3D reconstruction.',
]);

export const describeAdVocabulary=()=>({
  vocabulary:describeVocabulary(),
  player_support:PLAYER_SUPPORT,
  rules:AD_AGENT_RULES,
  example_project:EXAMPLE_PROJECT,
  world3d_example:composeWorld3DBrief({business_name:'Studio Concept',subject:'bottle',material:'metal',lighting:'studio',camera_move:'orbit',length_sec:6}).project,
  save_with:'save_nexus_ad_v2',
});
