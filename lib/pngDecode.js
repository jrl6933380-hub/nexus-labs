// Minimal PNG decoder for screenshots and uploads: 8-bit, non-interlaced, greyscale / RGB / palette / alpha variants. Returns RGBA bytes.
// It exists so selection maps and upload checks can read pixels on the server without a native image library.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  const b = Buffer.from(buf);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG file');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, plte = null, trns = null; const idat = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos), name = b.toString('latin1', pos + 4, pos + 8), data = b.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'PLTE') plte = data; else if (name === 'tRNS') trns = data; else if (name === 'IDAT') idat.push(data); else if (name === 'IEND') break;
    pos += 12 + len;
  }
  if (!w || !h) throw new Error('PNG has no image header');
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported (use 8-bit)`);
  if (interlace) throw new Error('interlaced PNG is not supported');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error(`PNG colour type ${type} is not supported`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(w * h * ch);
  if (raw.length < (stride + 1) * h) throw new Error('PNG data is truncated');
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, up = y ? px[row - stride + x] : 0, ul = y && x >= ch ? px[row - stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      else if (f !== 0) throw new Error(`PNG filter ${f} is not valid`);
      px[row + x] = v & 255;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, bl, a = 255;
    if (type === 6) { r = px[i * 4]; g = px[i * 4 + 1]; bl = px[i * 4 + 2]; a = px[i * 4 + 3]; }
    else if (type === 2) { r = px[i * 3]; g = px[i * 3 + 1]; bl = px[i * 3 + 2]; }
    else if (type === 0) { r = g = bl = px[i]; }
    else if (type === 4) { r = g = bl = px[i * 2]; a = px[i * 2 + 1]; }
    else { const k = px[i]; r = plte[k * 3]; g = plte[k * 3 + 1]; bl = plte[k * 3 + 2]; a = trns && k < trns.length ? trns[k] : 255; }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = bl; out[i * 4 + 3] = a;
  }
  return { width: w, height: h, rgba: out };
}
