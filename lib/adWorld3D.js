// High-level studio vocabulary -> validated, editable world3d data. No model,
// external asset, paid generation or fictitious product specification involved.
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';

export const WORLD3D_SUBJECTS = ['bottle', 'device', 'headphones', 'sculpture'];
export const WORLD3D_LIGHTING = ['studio', 'warm', 'dramatic'];
export const WORLD3D_CAMERA_MOVES = ['orbit', 'dolly', 'static'];
export function studioObjects(subject = 'bottle', material = 'metal', color = '#49a7c9') {
  const obj = (id, shape, fields) => ({ id, shape, parent: 'product', material, color, ...fields });
  const root = { id: 'product', shape: 'group', name: 'Concept assembly', y: subject === 'headphones' ? -.35 : 0 };
  const floor = { id: 'floor', shape: 'plane', name: 'Studio floor', w: 12, d: 12, color: '#3c4450', material: 'rubber', castShadow: false };
  const presets = {
    bottle: [obj('body', 'lathe', { name: 'Continuous bottle body', y: .8, w: .7, h: 1.6, d: .7,
      profile: [{r:.43,y:-.5},{r:.49,y:-.48},{r:.5,y:-.43},{r:.5,y:.16},{r:.48,y:.23},{r:.37,y:.30},{r:.21,y:.36},{r:.19,y:.40},{r:.19,y:.5}] }),
      obj('cap', 'lathe', { y: 1.61, w: .34, h: .16, d: .34, material: 'chrome', color: '#b8c1cd',
        profile: [{r:.43,y:-.5},{r:.5,y:-.38},{r:.5,y:.32},{r:.44,y:.5}] }),
      obj('band', 'cylinder', { y: .63, w: .711, h: .32, d: .711, material: 'rubber', color: '#24323a' })],
    device: [obj('case', 'rounded_box', { y: .8, w: .85, h: 1.6, d: .18, radius: .065 }),
      obj('screen', 'rounded_box', { y: .84, z: .094, w: .73, h: 1.35, d: .02, radius: .008, material: 'ceramic', color: '#081c2b' }),
      obj('screen-glow', 'box', { y: .8, z: .12, w: .6, h: .02, d: .02, color: '#49a7c9', emission: 1 }),
      obj('lens', 'sphere', { x: .23, y: 1.37, z: -.11, w: .12, h: .12, d: .06, material: 'chrome', color: '#172733' })],
    headphones: [obj('band', 'torus', { y: .68, w: 1.5, h: 1.5, d: 1.5, rx: -90, thickness: .12, arc: 180 }),
      obj('cup-l', 'cylinder', { x: -.68, y: .65, w: .6, h: .24, d: .6, rz: 90 }),
      obj('cup-r', 'cylinder', { x: .68, y: .65, w: .6, h: .24, d: .6, rz: 90 }),
      obj('pad-l', 'sphere', { x: -.52, y: .65, w: .18, h: .55, d: .55, material: 'rubber', color: '#15191f' }),
      obj('pad-r', 'sphere', { x: .52, y: .65, w: .18, h: .55, d: .55, material: 'rubber', color: '#15191f' })],
    sculpture: [obj('base', 'cylinder', { y: .12, w: 1.2, h: .24, d: 1.2, material: 'stone', color: '#55515b' }),
      obj('ring', 'torus', { y: .9, w: 1.5, h: 1.5, d: 1.5, rx: 68, rz: 20, thickness: .19 }),
      obj('pearl', 'sphere', { x: .05, y: .93, z: .04, w: .5, h: .5, d: .5, material: 'ceramic', color: '#eee2ce' })],
  };
  if (!presets[subject]) throw Error(`Unknown 3D subject "${subject}". Build other shapes with world3d objects.`);
  return [floor, root, ...presets[subject]];
}
export function studioLights(kind = 'studio') {
  return [
    { type: 'directional', x: 3, y: 6, z: 4, color: kind === 'warm' ? '#ffd2a3' : '#ffffff', intensity: 3.8 },
    { type: 'directional', x: -4, y: 2, z: -3, color: kind === 'warm' ? '#a4c3e3' : '#8dbcf0', intensity: kind === 'dramatic' ? .4 : 2 },
    { type: 'point', x: 1, y: 2, z: -2, color: kind === 'dramatic' ? '#f59b73' : '#dbe8f5', intensity: 3 },
  ];
}
export function studioCamera(move = 'orbit', seconds = 4) {
  if (move === 'static') return [{ t: 0, x: 3.2, y: 2, z: 4.8, lookY: .8, fov: 34 }];
  if (move === 'dolly') return [{ t: 0, x: 2, y: 1.5, z: 5.8, lookY: .8, fov: 34 }, { t: seconds, x: 1.2, y: 1.2, z: 3.5, ease: 'smooth' }];
  return [{ t: 0, x: 3, y: 1.8, z: 4.2, lookY: .8, fov: 34 },
    { t: seconds / 2, x: -.8, y: 1.5, z: 4.5, ease: 'smooth' },
    { t: seconds, x: -3.6, y: 1.8, z: 3.2, ease: 'smooth' }];
}
export function composeWorld3DBrief(brief) {
  const seconds = brief.length_sec || 15, subject = brief.subject || 'bottle', material = brief.material || 'metal';
  const duration = seconds === 30 ? 14 : seconds - 2;
  const one = { id: 'studio-3d', type: 'world3d', duration, background: 'gradient', transitionOut: 'cut', params: {
    objects: studioObjects(subject, material, brief.subject_color || '#49a7c9'), lights: studioLights(brief.lighting),
    cameraPath: studioCamera(brief.camera_move, duration), ambient: .35, exposure: 1.1,
    ...(brief.headline ? { caption: brief.headline } : {}),
  } };
  const scenes = [one];
  if (seconds === 30) scenes.push({ ...structuredClone(one), id: 'studio-detail', params: { ...structuredClone(one.params), cameraPath: studioCamera('dolly', 14) } });
  scenes.push({ id: 'close', type: 'end_card', duration: 2, params: { cta: brief.cta || 'Explore the concept', ...(brief.destination ? { destination: brief.destination } : {}), tagline: brief.business_name } });
  const project = { specVersion: 2, name: `${brief.business_name} · 3D ${subject} concept`.slice(0, 80), brand: brief.business_name,
    initial: brief.business_name.slice(0, 1), mood: brief.mood || 'luxury', palette: brief.palette || 'midnight-gold',
    platform: { format: brief.format || 'landscape', lengthSec: seconds }, concept: true, scenes };
  const checked = validateProjectV2(project);
  if (!checked.ok) throw Error('3D brief is invalid: ' + checked.errors.join('; '));
  return { project: checked.value, notes: ['Procedural concept geometry, not a supplied product model or a claim about a real product.', 'Use save_nexus_ad_v2 or edit_nexus_ad to refine objects, surfaces, lights and cameraPath.', 'Requires WebGL. The first directional light casts a 512px shadow map; no texture imports, true reflections, refraction or rigged human assets in this first release.'] };
}
