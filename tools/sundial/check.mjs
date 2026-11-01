// Node smoke test for the sundial parsers against a staged disc copy.
//   node tools/sundial/check.mjs <path to PAK dir> [level number]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pak, texPath } from '../../src/sundial/pak.js';
import { decodeTexture } from '../../src/sundial/texture.js';
import { parseModel } from '../../src/sundial/model.js';
import { parseMap } from '../../src/sundial/map.js';
import { parsePad } from '../../src/sundial/pad.js';

const pakDir = process.argv[2];
const lvl = process.argv[3] || '10';
const load = p => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const level = new Pak(load(join(pakDir, 'ARCADE', `L_${lvl}_AR.PAK`)), `L_${lvl}_AR`);
console.log('level pak entries:', level.entries.size);

const map = parseMap(level.get(`bg/level${lvl}/level${lvl}.raw`));
let verts = 0, tris = 0, groups = 0, missingTex = 0, withColors = 0;
for (const s of map.sections) for (const st of s.streams) if (st) { verts += st.count; tris += st.index.length / 3; groups += st.groups.length; if (st.colors) withColors++; }
console.log(`map: ${map.materials.length} materials, ${map.sections.length} sections, ${verts} verts, ${tris} tris, ${groups} groups, ${withColors} streams with vertex colors`);
console.log(`map: ${map.portals.length} portals, ${map.doors.length} doors`);
for (const m of map.materials) if (!level.has(texPath(m.id))) missingTex++;
console.log(`map textures missing from pak: ${missingTex}/${map.materials.length}`);
let bad = 0, decoded = 0;
for (const m of map.materials) {
  const t = level.tryGet(texPath(m.id)); if (!t) continue;
  try { decodeTexture(t); decoded++; } catch (e) { bad++; }
}
console.log(`map textures decoded ok: ${decoded}, failed: ${bad}`);

const pad = parsePad(level.get(`pad/data/level${lvl}.raw`));
console.log(`pad: ${pad.nodes.length} nodes, ${pad.links.length} links, ${pad.extra.length} extra`);
const types = {};
for (const x of pad.extra) types[x.type] = (types[x.type] || 0) + 1;
console.log('pad extra node types:', types);

let ok = 0, fail = 0, firstErr = null;
for (const p of level.list('ob/')) {
  try { const m = parseModel(level.get(p)); if (!m.parts.length) throw new Error('no parts'); ok++; }
  catch (e) { fail++; if (!firstErr) firstErr = `${p}: ${e.message}`; }
}
console.log(`level models parsed: ${ok} ok, ${fail} failed`, firstErr ? `(first: ${firstErr})` : '');

const gun = new Pak(load(join(pakDir, 'GUN.PAK')), 'GUN');
const g = parseModel(gun.get('ob/guns/laser_ph.raw'));
let gv = 0; for (const part of g.parts) for (const st of part) if (st) gv += st.count;
console.log(`gun laser_ph: ${g.parts.length} parts, ${gv} verts, ${g.materials.length} mats, embedded tex ${g.embedded.size}, scale ${g.scale}`);
const chr = new Pak(load(join(pakDir, 'CHR.PAK')), 'CHR');
const c = parseModel(chr.get('ob/chrs/chr01.raw'));
let cv = 0; for (const part of c.parts) for (const st of part) if (st) cv += st.count;
console.log(`chr01: ${c.parts.length} parts, ${cv} verts, ${c.materials.length} mats, bones ${c.infos.filter(i => i.isBone).length}, scale ${c.scale}`);
