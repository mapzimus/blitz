// Level geometry (bg/levelNN/levelNN.raw).
// Header: u32 matInfoOffset, u32 sectionIndexOffset, u32 dataStart, u32 doorsOffset.
import { Bin } from './bin.js';
import { readMatInfos, readMeshInfo, readSubMesh, MESHINFO_SIZE } from './mesh.js';

const SECTION_SIZE = 176;

export function parseMap(bytes) {
  const b = Bin.of(bytes);
  const matOff = b.u32(), indexOff = b.u32(), dataStart = b.u32(), doorsOff = b.u32();
  const materials = readMatInfos(b, matOff);
  const n = Math.floor((dataStart - indexOff) / SECTION_SIZE);
  const sectionInfos = [];
  for (let i = 0; i < n; i++) {
    const p = indexOff + i * SECTION_SIZE;
    sectionInfos.push({ data: b.u32at(p), links: b.u32at(p + 4), stuff: b.u32at(p + 8) });
  }
  const sections = [];
  sectionInfos.forEach((si, i) => {
    if (!si.data || si.data < MESHINFO_SIZE) return;
    const mi = readMeshInfo(b, si.data - MESHINFO_SIZE);
    sections.push({ id: i, info: mi, streams: readSubMesh(b, mi) });
  });

  // Vis portals: 48-byte header then 72-byte entries (id, unk, 16 pad bytes, 4 x vec3).
  const portals = [];
  if (n >= 3) {
    const po = sectionInfos[n - 2].data, pl = sectionInfos[2].links - po;
    if (po && pl > 48 && po + pl <= b.length) {
      for (let p = po + 48; p + 72 <= po + pl; p += 72) {
        const pts = [];
        for (let k = 0; k < 4; k++) {
          pts.push([b.f32at(p + 24 + k * 12), b.f32at(p + 28 + k * 12), b.f32at(p + 32 + k * 12)]);
        }
        portals.push({ id: b.u32at(p), pts });
      }
    }
  }

  // Doors: u32 count then 44-byte records.
  const doors = [];
  if (doorsOff && doorsOff + 4 <= b.length) {
    const c = b.u32at(doorsOff);
    for (let i = 0; i < Math.min(c, 512); i++) {
      const p = doorsOff + 4 + i * 44;
      if (p + 44 > b.length) break;
      doors.push({
        id1: b.u32at(p), id2: b.u32at(p + 4),
        pos: [b.f32at(p + 8), b.f32at(p + 12), b.f32at(p + 16)],
        size: [b.f32at(p + 20), b.f32at(p + 24), b.f32at(p + 28)],
        angle: b.f32at(p + 36),
      });
    }
  }
  return { materials, sections, portals, doors };
}
