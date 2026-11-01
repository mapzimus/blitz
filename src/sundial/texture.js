// TS2 PS2 texture: 16-byte header (magic, flags, width, height), 256 x RGBA palette, width*height 8-bit indices.
// The palette is CLUT-swizzled: bits 3 and 4 of the palette index are swapped. Alpha 0x80 means opaque.
import { Bin } from './bin.js';

export function decodeTexture(bytes) {
  const b = Bin.of(bytes);
  const magic = b.u32(), flags = b.u32(), w = b.u32(), h = b.u32();
  if (!w || !h || w > 1024 || h > 1024 || 16 + 1024 + w * h > b.length) {
    throw new Error(`bad texture header ${magic},${flags},${w}x${h} in ${b.length} bytes`);
  }
  const src = b.bytes(1024);
  const pal = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) {
    const s = (i & 231) | ((i & 8) << 1) | ((i & 16) >> 1);
    pal[s * 4] = src[i * 4];
    pal[s * 4 + 1] = src[i * 4 + 1];
    pal[s * 4 + 2] = src[i * 4 + 2];
    pal[s * 4 + 3] = Math.min(255, src[i * 4 + 3] * 2);
  }
  const idx = b.bytes(w * h);
  const rgba = new Uint8Array(w * h * 4);
  let hasAlpha = false;
  for (let i = 0; i < w * h; i++) {
    const p = idx[i] * 4;
    rgba[i * 4] = pal[p];
    rgba[i * 4 + 1] = pal[p + 1];
    rgba[i * 4 + 2] = pal[p + 2];
    rgba[i * 4 + 3] = pal[p + 3];
    if (pal[p + 3] < 250) hasAlpha = true;
  }
  return { width: w, height: h, data: rgba, hasAlpha, flags };
}
