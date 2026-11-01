// RenderWare 3.1 .dff decoder for NFL Blitz 2002 (PS2). Handles standard indexed geometry and the
// PS2 native VIF-packet geometry, frames (bones), atomics, materials and the Skin plugin.
const dec = new TextDecoder('latin1');

function* chunks(dv, o, e) {
  while (o + 12 <= e) {
    const t = dv.getUint32(o, true), s = dv.getUint32(o + 4, true);
    yield [t, o + 12, s];
    o += 12 + s;
  }
}
const ELEM = { 0x0: 4, 0x1: 2, 0x2: 1, 0x4: 8, 0x5: 4, 0x6: 2, 0x8: 12, 0x9: 6, 0xA: 3, 0xC: 16, 0xD: 8, 0xE: 4, 0xF: 2 };

function parseVif(d, dv, o, e) {
  const batches = []; let cur = [];
  let p = o;
  while (p + 16 <= e) {
    const w0 = dv.getUint32(p, true); const qwc = w0 & 0xffff, tid = (w0 >>> 28) & 7;
    if (!(tid === 0 || tid === 1 || tid === 6 || tid === 7) || qwc === 0) break;
    let r = p + 16; const re = Math.min(e, r + qwc * 16);
    while (r + 4 <= re) {
      const code = dv.getUint32(r, true); const cmd = (code >>> 24) & 0x7f, num = (code >>> 16) & 0xff, imm = code & 0xffff;
      if ((cmd & 0x60) === 0x60) {
        const vn = cmd & 0xf, n = num || 256, nbytes = n * (ELEM[vn] || 0);
        cur.push({ vn, usn: (imm >> 14) & 1, n, off: r + 4 });
        r += 4 + ((nbytes + 3) & ~3);
      } else {
        if (cmd === 0x14 || cmd === 0x15 || cmd === 0x17) { if (cur.length) { batches.push(cur); cur = []; } }
        if (cmd === 0x20) r += 4; else if (cmd === 0x30 || cmd === 0x31) r += 16;
        r += 4;
      }
    }
    if (cur.length) { batches.push(cur); cur = []; }
    p = re;
    if (tid === 0 || tid === 6 || tid === 7) break;
  }
  return batches;
}

function readGeometry(d, dv, go, ge) {
  const it = chunks(dv, go, ge);
  const [, so, ss] = it.next().value;
  const flags = dv.getUint32(so, true), ntri = dv.getUint32(so + 4, true), nvert = dv.getUint32(so + 8, true);
  const mats = []; let splitsMat = [], native = null, bflags = 1;
  for (const [t, o, s] of chunks(dv, go, ge)) {
    if (t === 0x8) {
      for (const [t2, o2, s2] of chunks(dv, o, o + s)) if (t2 === 0x7) {
        let tex = null;
        const color = [d[o2 + 16], d[o2 + 17], d[o2 + 18], d[o2 + 19]];
        for (const [t3, o3, s3] of chunks(dv, o2, o2 + s2)) if (t3 === 0x6) {
          for (const [t4, o4, s4] of chunks(dv, o3, o3 + s3)) if (t4 === 2 && tex === null) tex = dec.decode(d.subarray(o4, o4 + s4)).split('\0')[0];
        }
        mats.push({ texture: tex, color });
      }
    } else if (t === 0x3) {
      for (const [t2, o2, s2] of chunks(dv, o, o + s)) {
        if (t2 === 0x50E) { bflags = dv.getUint32(o2, true); const nm = dv.getUint32(o2 + 4, true); splitsMat = []; for (let k = 0; k < nm; k++) splitsMat.push(dv.getUint32(o2 + 12 + 8 * k + 4, true)); }
        if (t2 === 0x510) for (const [t3, o3, s3] of chunks(dv, o2, o2 + s2)) if (t3 === 1) native = [o3, Math.min(o3 + s3, o2 + s2)];
      }
    }
  }
  const geo = { flags, ntri, nvert, materials: mats, strip: !!(bflags & 1), parts: [] };
  if (!native && nvert) {
    let q = so + 16 + (ss >= 28 ? 12 : 0);
    let cols = null;
    if (flags & 0x8) { cols = d.subarray(q, q + 4 * nvert); q += 4 * nvert; }
    const ntex = ((flags >>> 16) & 0xff) || ((flags & 0x4) ? 1 : 0);
    let uvs = null;
    for (let k = 0; k < ntex; k++) { const u = new Float32Array(nvert * 2); for (let i = 0; i < nvert * 2; i++) u[i] = dv.getFloat32(q + 4 * i, true); if (k === 0) uvs = u; q += 8 * nvert; }
    const tris = new Uint16Array(ntri * 4); for (let i = 0; i < ntri * 4; i++) tris[i] = dv.getUint16(q + 2 * i, true); q += 8 * ntri;
    q += 16;
    const hasv = dv.getUint32(q, true), hasn = dv.getUint32(q + 4, true); q += 8;
    let pos = null, nrm = null;
    if (hasv) { pos = new Float32Array(nvert * 3); for (let i = 0; i < nvert * 3; i++) pos[i] = dv.getFloat32(q + 4 * i, true); q += 12 * nvert; }
    if (hasn) { nrm = new Float32Array(nvert * 3); for (let i = 0; i < nvert * 3; i++) nrm[i] = dv.getFloat32(q + 4 * i, true); }
    // group triangles by material; (v2, v1, mat, v3)
    const bymat = new Map();
    for (let i = 0; i < ntri; i++) { const m = tris[i * 4 + 2]; if (!bymat.has(m)) bymat.set(m, []); bymat.get(m).push(tris[i * 4 + 1], tris[i * 4], tris[i * 4 + 3]); }
    for (const [m, idx] of bymat) geo.parts.push({ material: m, pos, uv: uvs, nrm, col: cols, index: new Uint16Array(idx), shared: true });
  }
  if (native) {
    let p = native[0] + 4, si = 0;
    while (p + 8 <= native[1]) {
      const size = dv.getUint32(p, true); p += 8;
      if (!size || p + size > native[1] + 16) break;
      const batches = parseVif(d, dv, p, p + size);
      const posA = [], uvA = [], colA = [], nrmA = [], idxA = [];
      let base = 0;
      for (const b of batches) {
        let pos = null, uv = null, col = null, nrm = null;
        for (const u of b) {
          if (u.vn === 0x8 && !pos) pos = u; else if (u.vn === 0x4 && !uv) uv = u; else if (u.vn === 0xE && !col) col = u; else if (u.vn === 0xA && !nrm) nrm = u;
        }
        if (!pos) continue;
        const n = pos.n;
        for (let i = 0; i < n; i++) {
          posA.push(dv.getFloat32(pos.off + 12 * i, true), dv.getFloat32(pos.off + 12 * i + 4, true), dv.getFloat32(pos.off + 12 * i + 8, true));
          if (uv) uvA.push(dv.getFloat32(uv.off + 8 * i, true), dv.getFloat32(uv.off + 8 * i + 4, true)); else uvA.push(0, 0);
          if (col) colA.push(d[col.off + 4 * i], d[col.off + 4 * i + 1], d[col.off + 4 * i + 2], d[col.off + 4 * i + 3]); else colA.push(128, 128, 128, 128);
          if (nrm) nrmA.push(dv.getInt8(nrm.off + 3 * i) / 127, dv.getInt8(nrm.off + 3 * i + 1) / 127, dv.getInt8(nrm.off + 3 * i + 2) / 127); else nrmA.push(0, 0, 0);
        }
        if (geo.strip) { for (let i = 2; i < n; i++) { if (i & 1) idxA.push(base + i - 1, base + i - 2, base + i); else idxA.push(base + i - 2, base + i - 1, base + i); } }
        else { for (let i = 0; i + 2 < n; i += 3) idxA.push(base + i, base + i + 1, base + i + 2); }
        base += n;
      }
      geo.parts.push({ material: splitsMat[si] ?? 0, pos: new Float32Array(posA), uv: new Float32Array(uvA), col: new Uint8Array(colA), nrm: new Float32Array(nrmA), index: new Uint32Array(idxA), shared: false });
      p += size; si++;
    }
  }
  return geo;
}

function readSkin(d, dv, o, e, nvert) {
  const nb = dv.getUint32(o, true);
  const base = o + 4;
  const indices = d.subarray(base, base + 4 * nvert);
  const weights = new Float32Array(nvert * 4); for (let i = 0; i < nvert * 4; i++) weights[i] = dv.getFloat32(base + 4 * nvert + 4 * i, true);
  const mo = base + 20 * nvert + 4;                     // 4-byte header, then 76-byte blocks
  const bones = [];
  for (let b = 0; b < nb; b++) {
    const bo = mo + 76 * b;
    const m = new Float32Array(16); for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(bo + 12 + 4 * i, true);
    m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;           // RW leaves garbage in the 4th column
    bones.push({ id: dv.getUint32(bo, true), index: dv.getUint32(bo + 4, true), flags: dv.getUint32(bo + 8, true), inverseBind: m });
  }
  return { numBones: nb, indices, weights, bones };
}

export function readDff(bytes) {
  const d = bytes, dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const geometries = [], frames = [], atomics = [];
  const walk = (o, e) => {
    for (const [t, so, s] of chunks(dv, o, e)) {
      if (t === 0xF) geometries.push(readGeometry(d, dv, so, so + s));
      else if (t === 0xE) {
        const [, fo] = chunks(dv, so, so + s).next().value;
        const n = dv.getUint32(fo, true);
        for (let i = 0; i < n; i++) {
          const b = fo + 4 + i * 56; const m = []; for (let k = 0; k < 12; k++) m.push(dv.getFloat32(b + 4 * k, true));
          frames.push({ rot: m.slice(0, 9), pos: m.slice(9, 12), parent: dv.getInt32(b + 48, true), hanim: null });
        }
        // HAnim node ids live in each frame's extension (0x11E), in frame order
        let fi = 0;
        for (const [t2, o2, s2] of chunks(dv, so, so + s)) if (t2 === 0x3) {
          for (const [t3, o3, s3] of chunks(dv, o2, o2 + s2)) if (t3 === 0x11E) {
            const id = dv.getInt32(o3 + 4, true); if (frames[fi]) frames[fi].hanim = id;
            if (s3 > 12) { const nn = dv.getUint32(o3 + 8, true); const table = []; for (let k = 0; k < nn; k++) table.push({ id: dv.getUint32(o3 + 20 + 12 * k, true), index: dv.getUint32(o3 + 24 + 12 * k, true), flags: dv.getUint32(o3 + 28 + 12 * k, true) }); frames[fi].hanimTable = table; }
          }
          fi++;
        }
      } else if (t === 0x14) {
        const [, ao] = chunks(dv, so, so + s).next().value;
        const a = { frame: dv.getUint32(ao, true), geometry: dv.getUint32(ao + 4, true), skin: null };
        for (const [t2, o2, s2] of chunks(dv, so, so + s)) if (t2 === 0x3) for (const [t3, o3, s3] of chunks(dv, o2, o2 + s2)) if (t3 === 0x116) a.skin = [o3, o3 + s3];
        atomics.push(a);
      } else if (t === 0x10 || t === 0x1A || t === 0x3) walk(so, so + s);
    }
  };
  walk(0, d.length);
  for (const a of atomics) if (a.skin) { const g = geometries[a.geometry]; a.skin = readSkin(d, dv, a.skin[0], a.skin[1], g.nvert); }
  return { geometries, frames, atomics };
}

// Bounding box of a geometry (any part layout).
export function geoBounds(g) {
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const p of g.parts) { const a = p.pos; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { if (a[i + k] < min[k]) min[k] = a[i + k]; if (a[i + k] > max[k]) max[k] = a[i + k]; } }
  return { min, max };
}
