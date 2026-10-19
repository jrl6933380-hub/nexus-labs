// Data-only 3D renderer. No dependencies, fetches, eval, external assets or clock.
// Embedded into the sandbox player by build-ad-player.mjs. All animation is seekable.
export const WORLD3D_SURFACES = {
  plastic: [0.32, 0, 0], metal: [0.24, 0.9, 0], chrome: [0.08, 1, 0],
  ceramic: [0.18, 0, 0], rubber: [0.9, 0, 0], stone: [0.85, 0, 1], wood: [0.55, 0, 2],
};
export function worldSample(keys, field, base, t) {
  let v = base, at = 0;
  for (const k of keys || []) {
    if (k[field] === undefined) continue;
    if (t >= k.t) { v = k[field]; at = k.t; continue; }
    let u = Math.max(0, Math.min(1, (t - at) / Math.max(1e-6, k.t - at)));
    if (k.ease === 'smooth') u = u * u * (3 - 2 * u);
    else if (k.ease === 'snappy') u = u === 1 ? 1 : 1 - Math.pow(2, -10 * u);
    else if (k.ease === 'bounce') { const a = u - 1; u = 1 + 2.70158 * a * a * a + 1.70158 * a * a; }
    return v + (k[field] - v) * u;
  }
  return v;
}
const w3id = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function worldMultiply(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
  return r;
}
function w3compose(x, y, z, rx, ry, rz, sx, sy, sz) {
  const r = Math.PI / 180, X = rx * r, Y = ry * r, Z = rz * r;
  const cx = Math.cos(X), ax = Math.sin(X), cy = Math.cos(Y), ay = Math.sin(Y), cz = Math.cos(Z), az = Math.sin(Z);
  const T = w3id(); T[12] = x; T[13] = y; T[14] = z;
  const A = [1, 0, 0, 0, 0, cx, ax, 0, 0, -ax, cx, 0, 0, 0, 0, 1];
  const B = [cy, 0, -ay, 0, 0, 1, 0, 0, ay, 0, cy, 0, 0, 0, 0, 1];
  const C = [cz, az, 0, 0, -az, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const S = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
  return worldMultiply(T, worldMultiply(C, worldMultiply(B, worldMultiply(A, S))));
}
export function worldTransforms(objects, t) {
  const map = new Map();
  return objects.map(o => {
    const f = (p, d) => worldSample(o.keys, p, o[p] ?? d, t);
    const local = w3compose(f('x', 0), f('y', 0), f('z', 0), f('rx', 0), f('ry', 0), f('rz', 0), f('sx', 1), f('sy', 1), f('sz', 1));
    const parent = o.parent ? map.get(o.parent) : null;
    const world = parent ? worldMultiply(parent.world, local) : local;
    const mesh = worldMultiply(world, w3compose(0, 0, 0, 0, 0, 0, o.w ?? 1, o.h ?? 1, o.d ?? 1));
    const state = { object: o, world, mesh, opacity: Math.max(0, Math.min(1, f('opacity', 1))) * (parent?.opacity ?? 1) };
    map.set(o.id, state); return state;
  });
}
const w3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const w3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const w3unit = a => { const n = Math.hypot(...a) || 1; return a.map(x => x / n); };
function w3look(eye, at) {
  const z = w3unit(eye.map((v, i) => v - at[i]));
  const x = w3unit(w3cross(Math.abs(z[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0], z)), y = w3cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -w3dot(x, eye), -w3dot(y, eye), -w3dot(z, eye), 1];
}
function w3perspective(fov, aspect) {
  const f = 1 / Math.tan(fov * Math.PI / 360), near = 0.05, far = 180;
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
}
function w3normal(m) {
  const a = m.slice(0, 3), b = m.slice(4, 7), c = m.slice(8, 11), A = w3cross(b, c), B = w3cross(c, a), C = w3cross(a, b);
  const d = w3dot(a, A) || 1; return [...A, ...B, ...C].map(v => v / d);
}
export function worldGeometry(shape, thickness = 0.2, arc = 360, options = {}) {
  const p = [], n = [], ix = [];
  const vertex = (P, N) => { p.push(...P); n.push(...N); };
  const quad = (a, b, c, d, N) => { const i = p.length / 3; for (const v of [a, b, c, d]) vertex(v, N); ix.push(i, i + 1, i + 2, i, i + 2, i + 3); };
  if (shape === 'plane') quad([-.5, 0, -.5], [-.5, 0, .5], [.5, 0, .5], [.5, 0, -.5], [0, 1, 0]);
  else if (shape === 'rounded_box' && options.radius !== 0) {
    // Build in metres, then undo dimensions. The normal matrix restores the
    // physical normal, keeping a circular bevel on thin, non-cubic objects.
    const dims = [options.w ?? 1, options.h ?? 1, options.d ?? 1];
    const radius = options.radius ?? Math.min(...dims) * .15;
    const coords = size => {
      const h = size / 2, out = [];
      for (let i = 0; i <= 4; i++) out.push(-h + radius * i / 4);
      for (let i = 0; i <= 4; i++) out.push(h - radius + radius * i / 4);
      return out;
    };
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const a = (axis + 1) % 3, b = (axis + 2) % 3, A = coords(dims[a]), B = coords(dims[b]), start = p.length / 3;
      for (const v of B) for (const u of A) {
        const P = [0, 0, 0]; P[axis] = sign * dims[axis] / 2; P[a] = u; P[b] = v;
        const C = P.map((x, i) => Math.max(-dims[i] / 2 + radius, Math.min(dims[i] / 2 - radius, x)));
        const N = w3unit(P.map((x, i) => x - C[i]));
        vertex(C.map((x, i) => (x + N[i] * radius) / dims[i]), w3unit(N.map((x, i) => x * dims[i])));
      }
      for (let j = 0; j < B.length - 1; j++) for (let i = 0; i < A.length - 1; i++) {
        const k = start + j * A.length + i, q = k + A.length;
        if (sign > 0) ix.push(k, k + 1, q, k + 1, q + 1, q);
        else ix.push(k, q, k + 1, k + 1, q, q + 1);
      }
    }
  } else if (shape === 'lathe') {
    // Monotone cubic radius interpolation: no shoulder overshoot or negative
    // radii. Fixed tessellation bounds the allocation for every legal profile.
    const profile = options.profile, seg = 40, smooth = options.profileCurve !== 'linear';
    const slopes = profile.slice(1).map((q, i) => (q.r - profile[i].r) / (q.y - profile[i].y));
    const tangents = profile.map((q, i) => {
      if (!i) return slopes[0]; if (i === profile.length - 1) return slopes.at(-1);
      const a = slopes[i - 1], b = slopes[i];
      if (a * b <= 0) return 0;
      const h0 = q.y - profile[i - 1].y, h1 = profile[i + 1].y - q.y;
      return 3 * (h0 + h1) / ((2 * h1 + h0) / a + (h1 + 2 * h0) / b);
    });
    let rows = 0;
    for (let j = 0; j < profile.length - 1; j++) {
      const a = profile[j], b = profile[j + 1], h = b.y - a.y, steps = smooth ? 8 : 1;
      for (let k = 0; k <= steps; k++) {
        if (j && !k && smooth) continue;
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        const r = smooth ? (2*t3-3*t2+1)*a.r + (t3-2*t2+t)*h*tangents[j] + (-2*t3+3*t2)*b.r + (t3-t2)*h*tangents[j+1] : a.r + (b.r-a.r)*t;
        const slope = smooth ? ((6*t2-6*t)*a.r + (3*t2-4*t+1)*h*tangents[j] + (-6*t2+6*t)*b.r + (3*t2-2*t)*h*tangents[j+1])/h : slopes[j];
        for (let i = 0; i <= seg; i++) {
          const u = i / seg * Math.PI * 2, c = Math.cos(u), s = Math.sin(u);
          vertex([r*c, a.y+h*t, r*s], w3unit([c, -slope, s]));
        }
        rows++;
      }
    }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < seg; i++) { const a = j*(seg+1)+i, b = a+seg+1; ix.push(a,b,a+1,a+1,b,b+1); }
    if (options.capped !== false) for (const sign of [-1, 1]) {
      const q = sign < 0 ? profile[0] : profile.at(-1), start = p.length / 3;
      vertex([0, q.y, 0], [0, sign, 0]);
      for (let i = 0; i <= seg; i++) { const u = i / seg * Math.PI * 2; vertex([q.r*Math.cos(u),q.y,q.r*Math.sin(u)],[0,sign,0]); }
      for (let i = 0; i < seg; i++) ix.push(start, start+i+(sign < 0 ? 1 : 2), start+i+(sign < 0 ? 2 : 1));
    }
  } else if (shape === 'box' || shape === 'rounded_box') {
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const N = [0, 0, 0]; N[axis] = sign;
      const a = (axis + 1) % 3, b = (axis + 2) % 3;
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const P = [0, 0, 0]; P[axis] = sign * .5; P[a] = u * .5; P[b] = v * .5; return P; });
      quad(...pts, N);
    }
  } else if (shape === 'sphere' || shape === 'torus') {
    const rows = 20, cols = 32;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const u = i / cols * Math.PI * 2 * (shape === 'torus' ? arc / 360 : 1), v = j / rows * (shape === 'sphere' ? Math.PI : Math.PI * 2);
      if (shape === 'sphere') { const N = [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)]; vertex(N.map(x => x * .5), N); }
      else { const r = thickness * .5, R = .5 - r; vertex([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)], [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)]); }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + cols + 1; ix.push(a, b, a + 1, a + 1, b, b + 1); }
  } else {
    const seg = 40, top = shape === 'cone' ? 0 : .5;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), N = w3unit([c, .5 - top, s]);
      vertex([c * .5, -.5, s * .5], N); vertex([c * top, .5, s * top], N);
    }
    for (let i = 0; i < seg; i++) { const a = i * 2; ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    for (const sign of [-1, 1]) {
      const start = p.length / 3, r = sign > 0 ? top : .5; vertex([0, sign * .5, 0], [0, sign, 0]);
      for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; vertex([r * Math.cos(a), sign * .5, r * Math.sin(a)], [0, sign, 0]); }
      for (let i = 0; i < seg; i++) ix.push(start, start + i + 1, start + i + 2);
    }
  }
  return { positions: p, normals: n, indices: ix };
}
export function createWorld3D(host, params, options = {}) {
  const { width = 800, height = 450, colors = {}, images = {}, onError = () => {} } = options;
  const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2;
  canvas.dataset.world3d = '1'; canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; host.appendChild(canvas);
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) { onError('3D renderer unavailable: this device could not create a WebGL context.'); return Object.assign(() => {}, { dispose() {} }); }
  let disposed = false;
  const resources = [], cancelLoads = [];
  const keep = (type, value) => { resources.push([type, value]); return value; };
  const lose = e => { e.preventDefault(); if (!disposed) onError('3D WebGL context was lost; the frame cannot be exported.'); };
  canvas.addEventListener('webglcontextlost', lose);
  const shader = (type, src) => { const s = keep('Shader', gl.createShader(type)); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
  const program = (v, f) => { const p = keep('Program', gl.createProgram()); gl.attachShader(p, shader(gl.VERTEX_SHADER, v)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, f)); gl.bindAttribLocation(p, 0, 'aP'); gl.bindAttribLocation(p, 1, 'aN'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p)); return p; };
  const vert = `attribute vec3 aP,aN;uniform mat4 uM,uVP,uLightVP;uniform mat3 uN;varying vec3 vP,vN,vLocal,vLocalN;varying vec4 vShadow;void main(){vec4 w=uM*vec4(aP,1.);vP=w.xyz;vLocal=aP;vLocalN=aN;vN=normalize(uN*aN);vShadow=uLightVP*w;gl_Position=uVP*w;}`;
  const frag = `precision highp float;
uniform vec3 uBase,uEye;uniform vec4 uLight[4];uniform vec3 uPower[4];uniform int uCount,uShadowIndex;uniform sampler2D uShadow;
uniform float uRough,uMetal,uEmission,uAlpha,uAmbient,uExposure,uTexture;
uniform sampler2D uColorMap,uRoughMap;uniform vec4 uMap;uniform vec2 uHasMap;uniform int uProjection;
varying vec3 vP,vN,vLocal,vLocalN;varying vec4 vShadow;
vec2 uv(){vec2 p=vLocal.xy+.5;if(uProjection==0){vec3 n=abs(vLocalN);p=n.y>n.x&&n.y>n.z?vLocal.xz+.5:(n.x>n.z?vLocal.zy+.5:p);}else if(uProjection==1||uProjection==2){p=vec2(atan(vLocal.z,vLocal.x)/6.283185+.5,vLocal.y+.5);if(uProjection==2)p.y=asin(clamp(normalize(vLocal).y,-1.,1.))/3.141593+.5;}return fract(p*uMap.x+uMap.yz);}
float shadow(){vec3 p=vShadow.xyz/vShadow.w*.5+.5;if(p.x<0.||p.y<0.||p.x>1.||p.y>1.||p.z<0.||p.z>1.)return 1.;float s=0.;for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){vec4 c=texture2D(uShadow,p.xy+vec2(float(x),float(y))/512.);float z=dot(c,vec4(1.,1./256.,1./65536.,1./16777216.));s+=p.z-.0025<=z?1.:.2;}return s/9.;}
void main(){vec3 N=normalize(vN),V=normalize(uEye-vP);vec2 p=uv();float NV=max(dot(N,V),.001),r=clamp(uRough,.05,1.);vec3 base=pow(uBase,vec3(2.2));
if(uHasMap.x>.5)base*=pow(texture2D(uColorMap,p).rgb,vec3(2.2));if(uHasMap.y>.5)r=clamp(uRough*texture2D(uRoughMap,p).r,.05,1.);
if(uTexture>1.5){float grain=sin(vLocal.x*90.+sin(vLocal.z*7.)*5.)*.5+.5;base*=.65+.35*grain;}
else if(uTexture>.5){float grain=fract(sin(dot(floor(vLocal*180.),vec3(12.9,78.2,33.1)))*43758.5);base*=.78+.22*grain;}
vec3 F0=mix(vec3(.04),base,uMetal);vec3 rgb=base*(1.-uMetal)*uAmbient*(.5+.5*max(N.y,0.));
vec3 R=reflect(-V,N);rgb+=mix(vec3(.025,.035,.05),vec3(.25,.3,.4),R.y*.5+.5)*mix(F0,vec3(1.),pow(1.-NV,5.))*(.3+.7*(1.-r))*uAmbient;
for(int i=0;i<4;i++){if(i>=uCount)break;vec3 delta=uLight[i].xyz-vP;vec3 L=uLight[i].w>.5?normalize(delta):normalize(uLight[i].xyz);float att=uLight[i].w>.5?1./(1.+.08*dot(delta,delta)):1.;vec3 H=normalize(V+L);float NL=max(dot(N,L),.001),NH=max(dot(N,H),0.),VH=max(dot(V,H),0.);float a=r*r,a2=a*a,d=NH*NH*(a2-1.)+1.;float D=a2/(3.141593*d*d+.00001);float k=(r+1.)*(r+1.)/8.;float G=NV/(NV*(1.-k)+k)*NL/(NL*(1.-k)+k);vec3 F=F0+(1.-F0)*pow(1.-VH,5.);vec3 spec=D*G*F/(4.*NV*NL+.0001);vec3 diff=(1.-F)*(1.-uMetal)*base/3.141593;float sh=i==uShadowIndex?shadow():1.;rgb+=(diff+spec)*uPower[i]*NL*att*sh;}
rgb+=base*uEmission;rgb*=uExposure;rgb=rgb/(1.+rgb);gl_FragColor=vec4(pow(max(rgb,vec3(0.)),vec3(1./2.2)),uAlpha);}`;
  const depthV = `attribute vec3 aP;uniform mat4 uM,uVP;void main(){gl_Position=uVP*uM*vec4(aP,1.);}`;
  const depthF = `precision highp float;void main(){vec4 v=fract(gl_FragCoord.z*vec4(1.,256.,65536.,16777216.));v-=v.yzww*vec4(1./256.,1./256.,1./256.,0.);gl_FragColor=v;}`;
  let main, depth;
  const dispose = () => { if (disposed) return; disposed = true; cancelLoads.forEach(f => f()); canvas.removeEventListener('webglcontextlost', lose); for (const [type, value] of resources) gl['delete' + type](value); gl.getExtension('WEBGL_lose_context')?.loseContext(); };
  try { main = program(vert, frag); depth = program(depthV, depthF); }
  catch (e) { onError('3D shader initialization failed: ' + e.message); dispose(); return Object.assign(() => {}, { dispose }); }
  const U = (p, name) => gl.getUniformLocation(p, name);
  const mainU = Object.fromEntries(['uM', 'uVP', 'uN', 'uLightVP', 'uBase', 'uEye', 'uLight', 'uPower', 'uCount', 'uShadowIndex', 'uShadow', 'uRough', 'uMetal', 'uEmission', 'uAlpha', 'uAmbient', 'uExposure', 'uTexture','uColorMap','uRoughMap','uHasMap','uMap','uProjection'].map(n => [n, U(main, n)]));
  const mapCache = new Map();
  const makeMap = () => {
    const tex = keep('Texture', gl.createTexture()); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return tex;
  };
  const emptyMap = makeMap();
  const ids = [...new Set(params.objects.flatMap(o => [o.colorMap,o.roughnessMap]).filter(Boolean))];
  const ready = Promise.all(ids.map(id => new Promise(resolve => {
    const src = images[id]?.src;
    const fail = why => onError('3D surface map "'+id+'": '+why);
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src || '')) { fail('missing or invalid library image.');resolve();return; }
    const img = new Image(); let done = false;
    const finish = () => {if(done)return;done=true;clearTimeout(timer);img.onload=img.onerror=null;resolve();};
    const timer = setTimeout(() => {if(!disposed)fail('image decode timed out.');finish();img.src='';},8000);
    cancelLoads.push(() => {finish();img.src='';});
    img.onerror = () => {if(!disposed)fail('image decode failed.');finish();};
    img.onload = () => {
      if (!disposed) try {
        if (img.width*img.height>16777216) throw Error('decoded image exceeds 16 megapixels.');
        const scale=Math.min(1,1024/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);const tex=makeMap();gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);mapCache.set(id,tex);
      } catch(e) {fail(e.message);}finish();
    };
    img.src=src;
  })));
  const depthU = { uM: U(depth, 'uM'), uVP: U(depth, 'uVP') };
  const meshCache = new Map();
  const buffer = (target, data) => { const b = keep('Buffer', gl.createBuffer()); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
  const mesh = o => {
    const key = JSON.stringify([o.shape, o.thickness, o.arc, o.radius, o.w, o.h, o.d, o.profile, o.profileCurve, o.capped]); if (meshCache.has(key)) return meshCache.get(key);
    const g = worldGeometry(o.shape, o.thickness, o.arc, o), value = {
      p: buffer(gl.ARRAY_BUFFER, new Float32Array(g.positions)), n: buffer(gl.ARRAY_BUFFER, new Float32Array(g.normals)),
      i: buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.indices)), count: g.indices.length,
    }; meshCache.set(key, value); return value;
  };
  const color = value => { const s = colors[value] || ({ white: '#ffffff', black: '#111111' }[value]) || value || colors.accent || '#38bdf8'; return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255); };
  const lights = params.lights || [{ type: 'directional', x: 3, y: 6, z: 4, color: '#ffffff', intensity: 3 }, { type: 'directional', x: -4, y: 3, z: -2, color: '#b5d6ff', intensity: 1.5 }];
  const si = lights.findIndex(l => l.type === 'directional');
  const keyLight = lights[si] || { x: 3, y: 6, z: 4 }, le = w3unit([keyLight.x, keyLight.y, keyLight.z]).map(v => v * 24);
  const span = params.shadowSpan || 8, near = .1, far = 80;
  const ortho = [2 / span, 0, 0, 0, 0, 2 / span, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  const lightVP = worldMultiply(ortho, w3look(le, [0, 0.7, 0]));
  const fb = keep('Framebuffer', gl.createFramebuffer()), texture = keep('Texture', gl.createTexture()), rb = keep('Renderbuffer', gl.createRenderbuffer());
  gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 512, 512);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { onError('3D shadow framebuffer is incomplete.'); dispose(); return Object.assign(() => {}, { dispose }); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const drawMesh = (p, row, shadow) => {
    const g = mesh(row.object), a = gl.getAttribLocation(p, 'aP');
    gl.bindBuffer(gl.ARRAY_BUFFER, g.p); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
    const n = gl.getAttribLocation(p, 'aN');
    if (n >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, g.n); gl.enableVertexAttribArray(n); gl.vertexAttribPointer(n, 3, gl.FLOAT, false, 0, 0); }
    else gl.disableVertexAttribArray(1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.i);
    gl.uniformMatrix4fv((shadow ? depthU : mainU).uM, false, new Float32Array(row.mesh));
    if (!shadow) {
      const o = row.object, mat = WORLD3D_SURFACES[o.material || 'plastic'];
      gl.uniform2f(mainU.uHasMap,o.colorMap?1:0,o.roughnessMap?1:0);
      gl.uniform4f(mainU.uMap,o.mapScale??1,o.mapOffsetX??0,o.mapOffsetY??0,0);
      gl.uniform1i(mainU.uProjection,Math.max(0,['box','cylindrical','spherical','planar'].indexOf(o.mapProjection)));
      for(const [unit,field,name] of [[1,'colorMap','uColorMap'],[2,'roughnessMap','uRoughMap']]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,mapCache.get(o[field])||emptyMap);gl.uniform1i(mainU[name],unit);}
      gl.uniformMatrix3fv(mainU.uN, false, new Float32Array(w3normal(row.mesh)));
      gl.uniform3fv(mainU.uBase, color(o.color));
      for (const [name, value] of [['uRough', o.roughness ?? mat[0]], ['uMetal', o.metalness ?? mat[1]], ['uTexture', mat[2]], ['uEmission', o.emission || 0], ['uAlpha', row.opacity]]) gl.uniform1f(mainU[name], value);
    }
    gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
  };
  let lastMs = 0;
  const update = ms => {
    lastMs = ms;
    if (disposed) return;
    const t = ms / 1000, rows = worldTransforms(params.objects, t).filter(r => r.object.shape !== 'group' && r.opacity > 0);
    const cp = params.cameraPath, C = (p, d) => worldSample(cp, p, d, t);
    const eye = [C('x', 3), C('y', 2), C('z', 5)], at = [C('lookX', 0), C('lookY', .7), C('lookZ', 0)];
    const vp = worldMultiply(w3perspective(C('fov', 38), width / height), w3look(eye, at));
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, 512, 512); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(depth); gl.uniformMatrix4fv(depthU.uVP, false, new Float32Array(lightVP));
    if (si >= 0) for (const row of rows) if (row.object.castShadow !== false && row.opacity > .5 && row.object.shape !== 'plane') drawMesh(depth, row, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(main); gl.uniformMatrix4fv(mainU.uVP, false, new Float32Array(vp)); gl.uniformMatrix4fv(mainU.uLightVP, false, new Float32Array(lightVP));
    gl.uniform3fv(mainU.uEye, eye); gl.uniform1i(mainU.uCount, lights.length); gl.uniform1i(mainU.uShadowIndex, si);
    const ld = [], power = [];
    for (let i = 0; i < 4; i++) { const l = lights[i] || { x: 0, y: 1, z: 0, intensity: 0 }; ld.push(l.x, l.y, l.z, l.type === 'point' ? 1 : 0); power.push(...color(l.color || '#ffffff').map(v => v * (l.intensity ?? 1))); }
    gl.uniform4fv(mainU.uLight, ld); gl.uniform3fv(mainU.uPower, power); gl.uniform1f(mainU.uAmbient, params.ambient ?? .35); gl.uniform1f(mainU.uExposure, params.exposure ?? 1.1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(mainU.uShadow, 0);
    const opaque = rows.filter(r => r.opacity >= .999), transparent = rows.filter(r => r.opacity < .999).sort((a, b) => {
      const dist = r => Math.hypot(r.world[12] - eye[0], r.world[13] - eye[1], r.world[14] - eye[2]); return dist(b) - dist(a);
    });
    for (const row of opaque) drawMesh(main, row, false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    for (const row of transparent) drawMesh(main, row, false);
    gl.depthMask(true); gl.finish();
    const error = gl.getError(); if (error !== gl.NO_ERROR) onError('3D WebGL render error ' + error + '.');
  };
  canvas._w3sync = () => ready.then(() => update(lastMs));
  ready.then(() => update(lastMs));
  return Object.assign(update, { dispose });
}
