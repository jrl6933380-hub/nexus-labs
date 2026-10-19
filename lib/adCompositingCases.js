// Stage 4c regression fixtures. All artwork is synthetic calibration geometry,
// never a claim about camera footage, human hair, or segmentation quality.
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
export const projectForLayers = (name, layers, extra = {}) => ({
  specVersion: 2, name, mood: 'clean', palette: 'ocean-blue', concept: true,
  platform: { format: 'square', lengthSec: 6 },
  scenes: [
    { id: 'composite', type: 'graphic', duration: 4, background: 'solid', params: { layers, ...extra } },
    { id: 'end', type: 'end_card', duration: 2, params: { cta: 'Synthetic test', tagline: 'No camera footage' } },
  ],
});
export const keyedSubjectProject = (video = false) => projectForLayers('Synthetic keyed subject calibration', [
  { id: 'backdrop', name: 'Replacement backdrop', role: 'background', shape: 'rect', x: 50, y: 50, w: 100, h: 100, color: 'blue', color2: 'violet', angle: 45 },
  { id: 'sun', name: 'Backdrop light', role: 'light', shape: 'circle', x: 75, y: 30, w: 25, color: 'orange' },
  { id: 'subject', name: 'Synthetic robot on green', role: 'subject', shape: video ? 'video' : 'image', imageId: video ? 'med-keyclip1' : 'med-keysubject',
    x: 50, y: 54, w: 65, h: 65, fit: 'contain', key: 'green', keyTol: 15, keySoft: 15, keySpill: 35,
    ...(video ? { trimIn: 0, trimOut: 1, repeat: true } : {}),
    matte: box(5, 5, 95, 95), matteMode: 'keep',
    keys: [{ t: 0, cropR: 100 }, { t: 1, cropR: 0 }, { t: 3, x: 55 }] },
  { id: 'label', name: 'Synthetic disclosure', role: 'text', shape: 'text', text: 'SYNTHETIC KEY TEST', x: 50, y: 10, size: 4, color: 'white', fixed: true },
]);

// At t=0: x 26..74%, y 50..74% survive. At t=1 the parent hole
// removes x 45.2..54.8%, y 50..54.8%. Independent child and parent masks.
export const nestedMaskProject = () => projectForLayers('Nested mask intersection', [
  { id: 'outer', name: 'Parent keep box', role: 'mask', shape: 'group', x: 50, y: 50, w: 80, h: 80,
    matte: box(20, 20, 80, 80), matteMode: 'keep' },
  { id: 'inner', name: 'Moving hole', role: 'mask', shape: 'group', parent: 'outer', x: 0, y: 0, w: 48, h: 48,
    matte: box(40, 40, 60, 60), matteMode: 'cut', keys: [{ t: 0, mx: 100 }, { t: 1, mx: 0 }] },
  { id: 'paint', name: 'Bottom half red', role: 'subject', shape: 'rect', parent: 'inner', x: 0, y: 0, w: 80, h: 80, color: 'red', radius: 0,
    matte: box(0, 50, 100, 100), matteMode: 'keep' },
]);

const dots = n => Array.from({ length: n }, (_, i) => ({ id: `dot-${i}`, shape: 'circle', x: 3 + (i % 45) * 2.1, y: 4 + Math.floor(i / 45) * 1.95, w: 1,
  color: i % 2 ? 'orange' : 'blue', keys: [{ t: 0, rotate: 0 }, { t: 3, rotate: 120 }] }));
export function capacityCases() {
  return [
    ...[128, 512, 1200, 2048].map(n => ({ id: `plain-${n}`, project: projectForLayers(`Plain ${n}`, dots(n)) })),
    { id: 'expanded-9984', project: projectForLayers('9984 expanded shapes', dots(416).map(l => ({ ...l, count: 24, stepX: 0.03, stepY: 0.02 }))) },
    { id: 'effects-128', project: projectForLayers('128 per-layer effects', dots(128).map(l => ({ ...l, glow: 1, blur: 0.1, shadow: 0.3 }))) },
    { id: 'group-effects-128', project: projectForLayers('One group effect, 128 children', [
      { id: 'fx', shape: 'group', x: 50, y: 50, glow: 1, blur: 0.1, shadow: 0.3 },
      ...dots(128).map(l => ({ ...l, parent: 'fx', x: l.x - 50, y: l.y - 50 })),
    ]) },
    { id: 'keyed-still', project: keyedSubjectProject() },
    { id: 'keyed-video', project: keyedSubjectProject(true) },
  ];
}

// Deliberately simple subject, plus a red corner marker the garbage matte removes.
// Rasterized by the verification runner; no external images or model required.
export const calibrationSvg = (dx = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" fill="#18be48"/><rect x="1" y="1" width="7" height="7" fill="#ef4444"/>
<g transform="translate(${dx} 0)"><path d="M82 96 H174 V178 H82Z M88 178 H110 V223 H88Z M146 178 H168 V223 H146Z" fill="#e87932"/>
<rect x="84" y="40" width="88" height="62" rx="12" fill="#f3ceb0"/>
<rect x="93" y="57" width="70" height="28" rx="6" fill="#1e293b"/>
<circle cx="110" cy="70" r="5" fill="white"/><circle cx="145" cy="70" r="5" fill="white"/>
<path d="M81 111 L53 145 M175 111 L200 138" stroke="#e87932" stroke-width="18" stroke-linecap="round"/>
<path d="M114 42 L104 22 M130 42 V17 M146 42 L156 22" stroke="#f3ceb0" stroke-width="3"/>
</g></svg>`;
