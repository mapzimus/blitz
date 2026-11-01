// Object model (ob/**/*.raw). Header: u32 matInfoOffset, u32 meshInfoOffset.
// Mesh info blocks sit immediately BEFORE meshInfoOffset; meshInfoOffset itself holds the count and scale.
import { Bin } from './bin.js';
import { readMatInfos, readMeshInfo, readSubMesh, MESHINFO_SIZE, MAT_EMBEDDED } from './mesh.js';
import { decodeTexture } from './texture.js';

export function parseModel(bytes) {
  const b = Bin.of(bytes);
  const matOff = b.u32(), infoOff = b.u32();
  const materials = readMatInfos(b, matOff);
  const count = b.u32at(infoOff);
  const scale = b.f32at(infoOff + 40);
  const infos = [], parts = [];
  for (let i = 0; i < count; i++) {
    const mi = readMeshInfo(b, infoOff - count * MESHINFO_SIZE + i * MESHINFO_SIZE);
    infos.push(mi);
    parts.push(readSubMesh(b, mi));
  }
  const embedded = new Map();
  for (const m of materials) {
    if (m.flags & MAT_EMBEDDED) {
      try {
        embedded.set(m.id, decodeTexture(new Uint8Array(bytes.buffer, bytes.byteOffset + m.id, bytes.byteLength - m.id)));
      } catch (e) { /* leave missing */ }
    }
  }
  return { materials, infos, parts, scale, embedded };
}
