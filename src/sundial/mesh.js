// Shared mesh structures used by both object models (ob/**/*.raw) and level maps (bg/**/*.raw).
// Layout follows public format notes (MIT) and was verified against the disc.

export const MAT_EMBEDDED = 0x10000000; // material ID is an offset to a texture inside this file
export const MESHINFO_SIZE = 144;

// 16-byte material records until an ID of 0xFFFFFFFF.
export function readMatInfos(b, off) {
  const mats = [];
  b.seek(off);
  for (let guard = 0; guard < 4096; guard++) {
    const id = b.u32();
    if (id === 0xffffffff) break;
    mats.push({ id, wrapX: b.u32(), wrapY: b.u32(), flags: b.u32() });
  }
  return mats;
}

function readOffsets(b) {
  return { offset: b.u32(), verts: b.u32(), uvs: b.u32(), colors: b.u32(), normals: b.u32(), ranges: 0 };
}

// 144-byte mesh info block: a skeleton node plus three vertex streams (main, overlay, transparent).
export function readMeshInfo(b, off) {
  b.seek(off);
  const mi = { isBone: b.u8r(), unk2: b.u8r(), parent: b.u8r(), child: b.u8r(), unk4: b.u8r(), unk5: b.u8r() };
  b.skip(14);
  const r0 = b.u32(), r1 = b.u32(), r2 = b.u32();
  b.skip(4);
  mi.streams = [readOffsets(b), readOffsets(b), readOffsets(b)];
  mi.streams[0].ranges = r0;
  mi.streams[1].ranges = r1;
  mi.streams[2].ranges = r2;
  return mi;
}

// One vertex stream -> { count, positions, uvs, colors, normals, index, groups:[{mat,start,count}] }
// Vertices come as triangle strips. Byte 12 ("same") flips when the strip winding flips,
// byte 13 ("flag") is non-zero on a vertex that starts a new strip.
export function readStream(b, s) {
  if (!s.ranges || !s.verts || s.uvs <= s.verts) return null;
  const n = Math.floor((s.uvs - s.verts) / 16);
  if (n === 0 || s.verts + n * 16 > b.length || s.uvs + n * 12 > b.length || s.ranges + 10 > b.length) return null;

  const pos = new Float32Array(n * 3), same = new Uint8Array(n), flag = new Uint8Array(n);
  b.seek(s.verts);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = b.f32(); pos[i * 3 + 1] = b.f32(); pos[i * 3 + 2] = b.f32();
    same[i] = b.u8r(); flag[i] = b.u8r(); b.u16();
  }
  const uv = new Float32Array(n * 2), uvw = new Float32Array(n);
  b.seek(s.uvs);
  for (let i = 0; i < n; i++) { uv[i * 2] = b.f32(); uv[i * 2 + 1] = b.f32(); uvw[i] = b.f32(); }

  let colors = null;
  if (s.colors && s.colors + n * 4 <= b.length) {
    colors = new Uint8Array(n * 4);
    b.seek(s.colors);
    for (let i = 0; i < n * 4; i++) colors[i] = b.u8r();
  }
  let normals = null;
  if (s.normals && s.normals + n * 16 <= b.length) {
    normals = new Float32Array(n * 3);
    b.seek(s.normals);
    for (let i = 0; i < n; i++) { normals[i * 3] = b.f32(); normals[i * 3 + 1] = b.f32(); normals[i * 3 + 2] = b.f32(); b.u32(); }
  }

  // Sub-mesh ranges, 10 bytes each: {u16 mat, u16 id, u16 start, u16 count, u16 next}; next == 0xFFFF ends the list.
  const ranges = [];
  b.seek(s.ranges);
  for (let guard = 0; guard < 4096 && b.pos + 10 <= b.length; guard++) {
    const mat = b.u16(), id = b.u16(), start = b.u16(), count = b.u16();
    const next = b.u16();
    if (next === 0xffff) break;
    ranges.push({ mat, id, start, count });
  }

  // Strips -> indexed triangles, one draw group per range.
  const idx = [], groups = [];
  for (const r of ranges) {
    const g = { mat: r.mat, start: idx.length, count: 0 };
    let faceDir = false;
    const end = Math.min(n, r.start + r.count);
    for (let i = r.start; i < end; i++) {
      if (flag[i] === 0) {
        if (i >= r.start + 2) {
          if ((faceDir && same[i] === 1) || (!faceDir && same[i] === 0)) idx.push(i - 2, i - 1, i);
          else idx.push(i - 1, i - 2, i);
        }
      } else {
        faceDir = true;
      }
      faceDir = !faceDir;
    }
    g.count = idx.length - g.start;
    if (g.count) groups.push(g);
  }
  const index = idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { count: n, positions: pos, uvs: uv, uvw, colors, normals, index, groups };
}

// [main, overlay, transparent]
export function readSubMesh(b, mi) {
  return mi.streams.map(s => readStream(b, s));
}
