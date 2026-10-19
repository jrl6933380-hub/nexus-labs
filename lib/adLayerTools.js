// The agent-facing layer tools: read what is in a graphic scene, and change it with a short list of named operations.
// Pure functions over a project (no I/O, no model), built on lib/adLayers.js. Every operation addresses layers by stable id,
// the whole result is re-validated, and if any operation fails nothing changes (the error names the failing operation).
import {z} from 'zod';
import {ensureIds,listLayers,readLayer,selectLayers,patchLayer,addLayer,groupLayers,ungroup,reorderLayer,removeLayer,duplicateLayer,replaceAsset,setMatte,clearMatte,revealWipe,layerHash} from './adLayers.js';
import {LAYER_ROLES} from '../public/ad-vocabulary.mjs';

const fail=(message,extra={})=>Object.assign(new Error(message),{status:400,code:'AD_INPUT_INVALID',...extra});
const id=z.string().min(1).max(24);
const sceneId=z.string().min(1).max(60);
const point=z.object({x:z.number().min(-50).max(150),y:z.number().min(-50).max(150)}).strict();
const fieldValue=z.union([z.string(),z.number(),z.boolean(),z.null(),z.array(z.any()),z.record(z.any())]);
export const layerEditOpSchema=z.discriminatedUnion('op',[
  z.object({op:z.literal('patch'),layer_id:id,patch:z.record(fieldValue).describe('Fields to set on the layer (x, y, w, h, color, opacity, rotate, keys, key*, matte*, crop*, visible, locked ...). A null value removes the field. A layer id cannot change.'),baseline:z.string().max(40).optional().describe('The hash from read_nexus_layers; a stale one refuses the edit.')}).strict(),
  z.object({op:z.literal('add'),layer:z.record(fieldValue).describe('A complete layer, e.g. {shape:"circle",x:50,y:50,w:10,color:"accent",name:"Sun",role:"effect"}. Gets a fresh id if it has none.'),index:z.number().int().min(0).max(2048).optional(),after_layer_id:id.optional()}).strict(),
  z.object({op:z.literal('group'),ids:z.array(id).min(1).max(200),group_id:id,name:z.string().max(40).optional(),role:z.enum(LAYER_ROLES).optional()}).strict(),
  z.object({op:z.literal('ungroup'),group_id:id}).strict(),
  z.object({op:z.literal('reorder'),layer_id:id,to_index:z.number().int().min(0).max(2048).optional(),z:z.number().int().min(-100).max(1000).optional()}).strict(),
  z.object({op:z.literal('remove'),layer_id:id,with_children:z.boolean().optional()}).strict(),
  z.object({op:z.literal('duplicate'),layer_id:id,prefix:z.string().max(12).optional(),dx:z.number().min(-100).max(100).optional(),dy:z.number().min(-100).max(100).optional()}).strict(),
  z.object({op:z.literal('replace_asset'),layer_id:id,image_id:z.string().regex(/^(med-[a-z0-9]{6,16}|[a-zA-Z0-9_-]{3,60})$/)}).strict(),
  z.object({op:z.literal('set_key'),layer_id:id,key:z.enum(['green','blue','custom']),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),tolerance:z.number().min(0).max(100).optional(),softness:z.number().min(0).max(100).optional(),feather:z.number().int().min(0).max(20).optional(),grow:z.number().int().min(-10).max(10).optional(),spill:z.number().min(0).max(100).optional(),view:z.enum(['final','original','foreground','matte']).optional()}).strict(),
  z.object({op:z.literal('clear_key'),layer_id:id}).strict(),
  z.object({op:z.literal('set_matte'),layer_id:id,polygons:z.array(z.array(point).min(3).max(64)).min(1).max(8).describe('Polygons in percent of the layer box.'),mode:z.enum(['keep','cut']).optional(),feather:z.number().min(0).max(20).optional()}).strict(),
  z.object({op:z.literal('set_matte_image'),layer_id:id,image_id:z.string().regex(/^(med-[a-z0-9]{6,16}|[a-zA-Z0-9_-]{3,60})$/),channel:z.enum(['luma','alpha']).optional()}).strict(),
  z.object({op:z.literal('clear_matte'),layer_id:id}).strict(),
  z.object({op:z.literal('reveal_wipe'),layer_id:id,direction:z.enum(['left','right','up','down']).optional(),from:z.number().min(0).max(600).optional(),duration:z.number().min(0.05).max(60).optional(),hide:z.boolean().optional(),ease:z.string().max(20).optional()}).strict(),
]);
export const layerEditSchema=z.object({
  campaign_id:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  baseline:z.string().max(120).optional().describe('The ad baseline from read_nexus_ad; a newer saved version refuses the edit.'),
  scene_id:sceneId,
  edits:z.array(layerEditOpSchema).min(1).max(20),
  dry_run:z.boolean().optional(),
}).strict();
export const layerReadSchema=z.object({
  campaign_id:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  scene_id:sceneId.optional().describe('A graphic scene id. Leave out to list the graphic scenes.'),
  layer_id:id.optional().describe('Read one layer completely (its fields, hash and children).'),
  find:z.object({name:z.string().max(40).optional(),role:z.enum(LAYER_ROLES).optional(),shape:z.string().max(20).optional(),color:z.string().max(20).optional(),image_id:z.string().max(60).optional(),parent:id.optional(),visible:z.boolean().optional()}).strict().optional().describe('Find layers by what they are. Returns ids, never guesses.'),
}).strict();

const FIELD_FROM_KEY={tolerance:'keyTol',softness:'keySoft',feather:'keyFeather',grow:'keyGrow',spill:'keySpill',view:'keyView',color:'keyColor'};

// What is in the project's graphic scenes (no scene given), in one scene (list), one layer (layer_id) or a search (find).
export function readAdLayers(project,input={}){
  // Reads project the same deterministic ids/names an edit will persist. This keeps old
  // anonymous ads addressable without making a read mutate the stored campaign.
  const addressable=ensureIds(project);
  const scenes=(project.scenes||[]).filter(s=>s.type==='graphic');
  if(!input.scene_id){
    return {ok:true,graphic_scenes:scenes.map(s=>({scene_id:s.id,duration:s.duration,layers:(s.params.layers||[]).length,anonymous:(s.params.layers||[]).filter(l=>!l.id).length})),note:scenes.length?'Pass scene_id to list its layers. Anonymous layers receive deterministic ids in read results; the first successful saved edit persists them.':'This ad has no graphic scenes, so there are no layers to read.'};
  }
  if(input.layer_id){const r=readLayer(addressable,input.scene_id,input.layer_id);if(!r.ok)throw fail(r.error);return r;}
  if(input.find){
    const q={};for(const [k,v] of Object.entries(input.find))q[k==='image_id'?'imageId':k]=v;
    const r=selectLayers(addressable,input.scene_id,q);if(!r.ok)throw fail(r.error);return {...r,scene_id:input.scene_id,count:r.matches.length};
  }
  const r=listLayers(addressable,input.scene_id);if(!r.ok)throw fail(r.error);
  const generated=project.scenes.find(s=>s.id===input.scene_id).params.layers.filter(l=>!l.id).length;
  return {...r,generated_ids:generated,hint:generated?'Generated ids and names are read-only projections until the first successful saved edit. Use this ad baseline; edits use the same ids and hashes.':undefined};
}

// Apply a list of layer operations to one graphic scene. Returns {project, changes, hashes}; throws one error naming the failing operation.
export function applyLayerEdits(current,{scene_id,edits}){
  const parsed=z.array(layerEditOpSchema).min(1).max(20).safeParse(edits);
  if(!parsed.success)throw fail('Invalid layer edit: '+parsed.error.issues.slice(0,6).map(i=>`${i.path.join('.')||'edit'}: ${i.message}`).join('; '));
  const si=(current.scenes||[]).findIndex(s=>s.id===scene_id&&s.type==='graphic');
  if(si<0)throw fail(`Scene "${scene_id}" is not a graphic scene in this ad. Graphic scenes: ${(current.scenes||[]).filter(s=>s.type==='graphic').map(s=>s.id).join(', ')||'none'}.`);
  const anon=current.scenes[si].params.layers.filter(l=>!l.id).length;
  let project=ensureIds(current);const changes=[];
  if(anon)changes.push(`gave ids and names to ${anon} layer(s) that had none`);
  const step=(n,e,r)=>{if(!r.ok)throw fail(`Edit ${n+1} (${e.op}): ${r.error}`,{edit_index:n,current:r.current});project=r.project;};
  parsed.data.forEach((e,n)=>{
    const sceneArg={sceneId:scene_id};
    switch(e.op){
      case 'patch':step(n,e,patchLayer(project,{...sceneArg,layerId:e.layer_id,patch:e.patch,baseline:e.baseline}));changes.push(`patched ${e.layer_id}: ${Object.keys(e.patch).join(', ')}`);break;
      case 'add':{const r=addLayer(project,{...sceneArg,layer:e.layer,index:e.index,afterLayerId:e.after_layer_id});step(n,e,r);changes.push(`added ${r.layerId}`);break;}
      case 'group':step(n,e,groupLayers(project,{...sceneArg,ids:e.ids,groupId:e.group_id,name:e.name,role:e.role}));changes.push(`grouped ${e.ids.join(', ')} as ${e.group_id}`);break;
      case 'ungroup':step(n,e,ungroup(project,{...sceneArg,groupId:e.group_id}));changes.push(`ungrouped ${e.group_id}`);break;
      case 'reorder':step(n,e,reorderLayer(project,{...sceneArg,layerId:e.layer_id,toIndex:e.to_index,z:e.z}));changes.push(`reordered ${e.layer_id}`);break;
      case 'remove':step(n,e,removeLayer(project,{...sceneArg,layerId:e.layer_id,withChildren:e.with_children}));changes.push(`removed ${e.layer_id}`);break;
      case 'duplicate':{const r=duplicateLayer(project,{...sceneArg,layerId:e.layer_id,prefix:e.prefix,dx:e.dx,dy:e.dy});step(n,e,r);changes.push(`duplicated ${e.layer_id} as ${r.newIds.join(', ')}`);break;}
      case 'replace_asset':step(n,e,replaceAsset(project,{...sceneArg,layerId:e.layer_id,imageId:e.image_id}));changes.push(`${e.layer_id} now uses ${e.image_id}`);break;
      case 'set_key':{
        const patch={key:e.key};for(const [k,field] of Object.entries(FIELD_FROM_KEY))if(e[k]!==undefined)patch[field]=e[k];
        step(n,e,patchLayer(project,{...sceneArg,layerId:e.layer_id,patch}));changes.push(`keyed ${e.layer_id} (${e.key})`);break;}
      case 'clear_key':step(n,e,patchLayer(project,{...sceneArg,layerId:e.layer_id,patch:{key:null,keyColor:null,keyTol:null,keySoft:null,keyFeather:null,keyGrow:null,keySpill:null,keyView:null}}));changes.push(`removed the key from ${e.layer_id}`);break;
      case 'set_matte':step(n,e,setMatte(project,{...sceneArg,layerId:e.layer_id,polygons:e.polygons,mode:e.mode,feather:e.feather}));changes.push(`${e.mode==='cut'?'cut':'kept'} matte on ${e.layer_id}`);break;
      case 'set_matte_image':step(n,e,patchLayer(project,{...sceneArg,layerId:e.layer_id,patch:{matteImage:e.image_id,matteChannel:e.channel||null}}));changes.push(`${e.layer_id} uses matte image ${e.image_id}`);break;
      case 'clear_matte':step(n,e,clearMatte(project,{...sceneArg,layerId:e.layer_id}));changes.push(`removed the matte from ${e.layer_id}`);break;
      case 'reveal_wipe':step(n,e,revealWipe(project,{...sceneArg,layerId:e.layer_id,direction:e.direction,from:e.from,duration:e.duration,hide:e.hide,ease:e.ease}));changes.push(`${e.hide?'hide':'reveal'} wipe on ${e.layer_id}`);break;
    }
  });
  const layers=project.scenes[si].params.layers;
  return {project,changes,hashes:Object.fromEntries(layers.filter(l=>l.id).map(l=>[l.id,layerHash(l)]))};
}
