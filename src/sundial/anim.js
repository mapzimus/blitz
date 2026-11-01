// Animation files (anim/data/ts2/*.raw, magic "ANR10").
//   0x30 u32 unk, u32 totalFrames, u32 numKeys, u32 numBones
//   0x58 u32 keyFrame[numKeys]            frame index of each key
//   then numBones tracks of 32 bytes: u32 unk, u32 flags, f32 numFrames, u32 numKeys, 16 pad
//   then per bone, by flag: 8 = root: numKeys x (vec3 pos, quat)   2 = child: vec3 pos, numKeys x quat
//                           0 = bind pose: (vec3 pos, quat) once; a bind file has 8 extra bytes first
// Quaternions are 4 x u16, each mapped to [-1, 1].
import { Bin } from './bin.js';

const Q = 2 / 65535;

export function parseAnim(bytes) {
  const b = Bin.of(bytes);
  if (b.str(4) !== 'ANR1') throw new Error('not an ANR1 animation');
  b.seek(0x30);
  b.u32();
  const total = b.u32(), numKeys = b.u32(), numBones = b.u32();
  b.seek(0x58);
  const keys = new Uint32Array(numKeys);
  for (let i = 0; i < numKeys; i++) keys[i] = b.u32();
  const flags = [];
  for (let i = 0; i < numBones; i++) { b.u32(); flags.push(b.u32()); b.f32(); b.u32(); b.skip(16); }
  const isBind = flags.every(f => f === 0);
  // Some files carry 8 extra bytes before the frame data; detect by what the tracks say must follow.
  const expected = flags.reduce((s, f) => s + (f === 8 ? numKeys * 20 : f === 2 ? 12 + numKeys * 8 : f === 0 ? 20 : 0), 0);
  if (b.length - b.pos === expected + 8) b.skip(8);
  const quat = () => [b.u16() * Q - 1, b.u16() * Q - 1, b.u16() * Q - 1, b.u16() * Q - 1];
  const bones = [];
  for (let i = 0; i < numBones; i++) {
    const f = flags[i];
    if (f === 8) {
      const pos = [], rot = [];
      for (let k = 0; k < numKeys; k++) { pos.push([b.f32(), b.f32(), b.f32()]); rot.push(quat()); }
      bones.push({ kind: 'root', pos, rot });
    } else if (f === 2) {
      const pos = [b.f32(), b.f32(), b.f32()];
      const rot = [];
      for (let k = 0; k < numKeys; k++) rot.push(quat());
      bones.push({ kind: 'child', pos, rot });
    } else if (f === 0) {
      bones.push({ kind: 'bind', pos: [b.f32(), b.f32(), b.f32()], rot: quat() });
    } else {
      bones.push({ kind: 'unknown', flags: f });
    }
  }
  return { total, keys, bones, isBind, duration: Math.max(1, total) / 60 };
}
