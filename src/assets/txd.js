// RenderWare PS2 texture dictionary decoder (port of tools/txd.py). Returns RGBA pixel arrays.
function* chunks(d, dv, o, e) {
  while (o + 12 <= e) {
    const t = dv.getUint32(o, true), s = dv.getUint32(o + 4, true);
    yield [t, o + 12, s];
    o += 12 + s;
  }
}

function unswizzle8(src, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const block = (y & ~0xf) * w + (x & ~0xf) * 2;
    const swap = (((y + 2) >> 2) & 1) * 4;
    const py = (((y & ~3) >> 1) + (y & 1)) & 7;
    const col = py * w * 2 + ((x + swap) & 7) * 4;
    const bn = ((y >> 1) & 1) + ((x >> 2) & 2);
    out[y * w + x] = src[block + col + bn];
  }
  return out;
}


// PS2 GS memory layout tables (PCSX2 GSLocalMemory). 4-bit textures are uploaded as 16-bit (rrw x rrh)
// and read back as PSMT4; this computes that permutation once per texture size.
const BLOCK16 = [[0, 2, 8, 10], [1, 3, 9, 11], [4, 6, 12, 14], [5, 7, 13, 15], [16, 18, 24, 26], [17, 19, 25, 27], [20, 22, 28, 30], [21, 23, 29, 31]];
const COL16 = [[0, 2, 8, 10, 16, 18, 24, 26, 1, 3, 9, 11, 17, 19, 25, 27], [4, 6, 12, 14, 20, 22, 28, 30, 5, 7, 13, 15, 21, 23, 29, 31]];
const COL4 = [[0, 8, 32, 40, 64, 72, 96, 104, 2, 10, 34, 42, 66, 74, 98, 106, 4, 12, 36, 44, 68, 76, 100, 108, 6, 14, 38, 46, 70, 78, 102, 110], [16, 24, 48, 56, 80, 88, 112, 120, 18, 26, 50, 58, 82, 90, 114, 122, 20, 28, 52, 60, 84, 92, 116, 124, 22, 30, 54, 62, 86, 94, 118, 126], [65, 73, 97, 105, 1, 9, 33, 41, 67, 75, 99, 107, 3, 11, 35, 43, 69, 77, 101, 109, 5, 13, 37, 45, 71, 79, 103, 111, 7, 15, 39, 47], [81, 89, 113, 121, 17, 25, 49, 57, 83, 91, 115, 123, 19, 27, 51, 59, 85, 93, 117, 125, 21, 29, 53, 61, 87, 95, 119, 127, 23, 31, 55, 63], [192, 200, 224, 232, 128, 136, 160, 168, 194, 202, 226, 234, 130, 138, 162, 170, 196, 204, 228, 236, 132, 140, 164, 172, 198, 206, 230, 238, 134, 142, 166, 174], [208, 216, 240, 248, 144, 152, 176, 184, 210, 218, 242, 250, 146, 154, 178, 186, 212, 220, 244, 252, 148, 156, 180, 188, 214, 222, 246, 254, 150, 158, 182, 190], [129, 137, 161, 169, 193, 201, 225, 233, 131, 139, 163, 171, 195, 203, 227, 235, 133, 141, 165, 173, 197, 205, 229, 237, 135, 143, 167, 175, 199, 207, 231, 239], [145, 153, 177, 185, 209, 217, 241, 249, 147, 155, 179, 187, 211, 219, 243, 251, 149, 157, 181, 189, 213, 221, 245, 253, 151, 159, 183, 191, 215, 223, 247, 255], [256, 264, 288, 296, 320, 328, 352, 360, 258, 266, 290, 298, 322, 330, 354, 362, 260, 268, 292, 300, 324, 332, 356, 364, 262, 270, 294, 302, 326, 334, 358, 366], [272, 280, 304, 312, 336, 344, 368, 376, 274, 282, 306, 314, 338, 346, 370, 378, 276, 284, 308, 316, 340, 348, 372, 380, 278, 286, 310, 318, 342, 350, 374, 382], [321, 329, 353, 361, 257, 265, 289, 297, 323, 331, 355, 363, 259, 267, 291, 299, 325, 333, 357, 365, 261, 269, 293, 301, 327, 335, 359, 367, 263, 271, 295, 303], [337, 345, 369, 377, 273, 281, 305, 313, 339, 347, 371, 379, 275, 283, 307, 315, 341, 349, 373, 381, 277, 285, 309, 317, 343, 351, 375, 383, 279, 287, 311, 319], [448, 456, 480, 488, 384, 392, 416, 424, 450, 458, 482, 490, 386, 394, 418, 426, 452, 460, 484, 492, 388, 396, 420, 428, 454, 462, 486, 494, 390, 398, 422, 430], [464, 472, 496, 504, 400, 408, 432, 440, 466, 474, 498, 506, 402, 410, 434, 442, 468, 476, 500, 508, 404, 412, 436, 444, 470, 478, 502, 510, 406, 414, 438, 446], [385, 393, 417, 425, 449, 457, 481, 489, 387, 395, 419, 427, 451, 459, 483, 491, 389, 397, 421, 429, 453, 461, 485, 493, 391, 399, 423, 431, 455, 463, 487, 495], [401, 409, 433, 441, 465, 473, 497, 505, 403, 411, 435, 443, 467, 475, 499, 507, 405, 413, 437, 445, 469, 477, 501, 509, 407, 415, 439, 447, 471, 479, 503, 511]];
const LUT4 = new Map();
function addr16(x, y, ppr) { const page = ((y >> 6) * ppr) + (x >> 6), lx = x & 63, ly = y & 63; const block = BLOCK16[ly >> 3][lx >> 4]; const idx = COL16[ly & 1][lx & 15] + ((ly & 7) >> 1) * 32; return page * 8192 + block * 256 + idx * 2; }
function addr4(x, y, ppr) { const page = ((y >> 7) * ppr) + (x >> 7), lx = x & 127, ly = y & 127; const block = BLOCK16[ly >> 4][lx >> 5]; const idx = COL4[ly & 15][lx & 31]; return [page * 8192 + block * 256 + (idx >> 1), idx & 1]; }
function lut4(w, h, ww, wh) {
  const key = w + 'x' + h + 'x' + ww + 'x' + wh;
  if (LUT4.has(key)) return LUT4.get(key);
  const ppr = Math.max(1, ww >> 6), amap = new Int32Array(Math.ceil((ww * wh * 2) / 8192) * 8192 + 8192);
  for (let row = 0; row < wh; row++) for (let col = 0; col < ww; col++) amap[addr16(col, row, ppr)] = (row * ww + col) * 2;
  const pprR = Math.max(1, w >> 7), off = new Int32Array(w * h), nib = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [a, sub] = addr4(x, y, pprR); const i = y * w + x; off[i] = amap[a & ~1] + (a & 1); nib[i] = sub; }
  const r = { off, nib }; LUT4.set(key, r); return r;
}
function unswizzle4(src, w, h, ww, wh) {
  const { off, nib } = lut4(w, h, ww, wh), out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (src[off[i]] >> (nib[i] * 4)) & 0xf;
  return out;
}

function untwiddleClut(pal) {
  const p = new Uint8Array(pal);
  for (let g = 0; g < 256; g += 32) {
    const a = (g + 8) * 4, b = (g + 16) * 4;
    const tmp = p.slice(a, a + 32); p.set(p.slice(b, b + 32), a); p.set(tmp, b);
  }
  return p;
}

function gifTrxreg(d, dv, o, len) {
  if (len < 0x50) return null;
  const nloop = dv.getUint32(o, true) & 0x7fff;
  const regs = dv.getUint32(o + 8, true) & 0xf;
  if (nloop !== 3 || regs !== 0xe) return null;
  let rrw = null, rrh = null;
  for (let i = 0; i < 3; i++) {
    const data = dv.getUint32(o + 16 + i * 16, true), hi = dv.getUint32(o + 20 + i * 16, true), addr = dv.getUint32(o + 24 + i * 16, true);
    if (addr === 0x52) { rrw = data & 0xfff; rrh = hi & 0xfff; }
  }
  return { rrw, rrh, hdr: 0x50 };
}

function decodeNative(d, dv, o, e) {
  const it = chunks(d, dv, o, e);
  let c = it.next().value; // platform struct
  if (dv.getUint32(c[1], true) !== 0x00325350) throw new Error('not PS2');
  c = it.next().value; const name = new TextDecoder('latin1').decode(d.subarray(c[1], c[1] + c[2])).split('\0')[0];
  it.next(); // mask
  c = it.next().value; // raster struct
  const sub = [...chunks(d, dv, c[1], c[1] + c[2])];
  const io = sub[0][1], po = sub[1][1];
  const w = dv.getUint32(io, true), h = dv.getUint32(io + 4, true), depth = dv.getUint32(io + 8, true);
  const texelSize = dv.getUint32(io + 48, true), palSize = dv.getUint32(io + 52, true);
  let pixO = po, pixLen = texelSize, palO = po + texelSize, palLen = palSize;
  const g = gifTrxreg(d, dv, pixO, pixLen); let rrw = null, rrh = null;
  if (g) { rrw = g.rrw; rrh = g.rrh; pixO += g.hdr; pixLen -= g.hdr; }
  const pg = gifTrxreg(d, dv, palO, palLen); if (pg) { palO += pg.hdr; palLen -= pg.hdr; }
  const pix = d.subarray(pixO, pixO + pixLen), pal = d.subarray(palO, palO + palLen);
  const out = new Uint8ClampedArray(w * h * 4);
  const n = w * h;
  const a2 = a => (a >= 128 ? 255 : a * 2);
  if (depth === 8) {
    const swz = rrw !== null && rrw * 2 === w && rrh * 2 === h;
    const idx = swz ? unswizzle8(pix, w, h) : pix;
    const clut = pal.length >= 1024 ? untwiddleClut(pal.subarray(0, 1024)) : pal;
    for (let i = 0; i < n; i++) { const k = idx[i] * 4; out[i * 4] = clut[k]; out[i * 4 + 1] = clut[k + 1]; out[i * 4 + 2] = clut[k + 2]; out[i * 4 + 3] = a2(clut[k + 3]); }
  } else if (depth === 4) {
    const swz = rrw !== null && rrw * 2 === w && rrh * 2 === h;
    let idx;
    if (swz) idx = unswizzle4(pix, w, h, rrw, rrh);
    else { idx = new Uint8Array(n); for (let i = 0; i < n; i++) idx[i] = (i & 1) ? (pix[i >> 1] >> 4) : (pix[i >> 1] & 0xf); }
    for (let i = 0; i < n; i++) { const k = idx[i] * 4; out[i * 4] = pal[k]; out[i * 4 + 1] = pal[k + 1]; out[i * 4 + 2] = pal[k + 2]; out[i * 4 + 3] = a2(pal[k + 3]); }
  } else if (depth === 32) {
    for (let i = 0; i < n; i++) { out[i * 4] = pix[i * 4]; out[i * 4 + 1] = pix[i * 4 + 1]; out[i * 4 + 2] = pix[i * 4 + 2]; out[i * 4 + 3] = a2(pix[i * 4 + 3]); }
  } else if (depth === 16) {
    for (let i = 0; i < n; i++) { const v = pix[i * 2] | (pix[i * 2 + 1] << 8); out[i * 4] = (v & 31) << 3; out[i * 4 + 1] = ((v >> 5) & 31) << 3; out[i * 4 + 2] = ((v >> 10) & 31) << 3; out[i * 4 + 3] = v & 0x8000 ? 255 : 0; }
  } else throw new Error('depth ' + depth);
  return { name, width: w, height: h, depth, data: out };
}

export function decodeTxd(bytes) {
  const d = bytes, dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out = [];
  for (const [t, o, s] of chunks(d, dv, 0, d.length)) {
    if (t !== 0x16) continue;
    for (const [t2, o2, s2] of chunks(d, dv, o, o + s)) {
      if (t2 !== 0x15) continue;
      try { out.push(decodeNative(d, dv, o2, o2 + s2)); } catch (err) { console.warn('txd', err.message); }
    }
  }
  return out;
}

export function toImageData(tex) { return new ImageData(tex.data, tex.width, tex.height); }
