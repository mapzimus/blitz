// Node check of the browser decoders against the extracted disc files.
// Usage: node tools/jstest.mjs "<bassets folder>"
import fs from 'node:fs'; import path from 'node:path';
import { readDff, geoBounds } from '../src/assets/dff.js';
import { Bank } from '../src/assets/ban.js';
const dir = process.argv[2];
const load = f => new Uint8Array(fs.readFileSync(path.join(dir, f)));
for (const f of ['ball.dff', 'fl_nnmaf.dff', 'S1_L1.DFF', 'uniform.dff', 'skin.dff', 'helmet.dff', 'equipment.dff', 'skeleton_hierarchy.dff']) {
  const m = readDff(load(f));
  const tris = m.geometries.reduce((a, g) => a + g.parts.reduce((b, p) => b + p.index.length / 3, 0), 0);
  const skinned = m.atomics.filter(a => a.skin).length;
  console.log(`${f}: geoms=${m.geometries.length} frames=${m.frames.length} atomics=${m.atomics.length} skinned=${skinned} tris=${tris} mats=${[...new Set(m.geometries.flatMap(g => g.materials.map(x => x.texture)))].slice(0, 6)}`);
  if (f === 'uniform.dff') { const a = m.atomics[35]; const g = m.geometries[a.geometry]; console.log('  atomic35 bounds', geoBounds(g), 'skin bones', a.skin.numBones, 'block1', a.skin.bones[1].index, [...a.skin.bones[1].inverseBind].map(v => +v.toFixed(2)).slice(12, 15)); }
  if (f === 'skeleton_hierarchy.dff') console.log('  frame1 hanim', m.frames[1].hanim, 'table', m.frames[1].hanimTable.slice(0, 5).map(t => t.id), 'frame ids', m.frames.map(x => x.hanim).join(','));
}
const b = new Bank(load('genbank.ban'));
const names = b.names();
console.log('clips', names.length, names.slice(0, 30).join(' '));
const c = b.clip('walk_b_01'); console.log('walk_b_01 keys', c.keys, 'root', c.root, 'bones', [...c.rot.keys()].join(','), 'pos0', [...c.pos.slice(0, 3)].map(v => v.toFixed(2)), 'q(1) first', [...c.rot.get(1).slice(0, 4)].map(v => v.toFixed(3)));
console.log('families with run/ready/celeb/dive/spin/stiff/pass/catch/fall/jump:', names.filter(n => /run|ready|celeb|dive|spin|stiff|pass|catch|fall|jump|hurdle|lateral|stand|snap|cen_/.test(n)).join(' '));
