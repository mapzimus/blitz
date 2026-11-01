import { readFileSync } from 'node:fs';
import { Pak } from 'file:///D:/REPOS/blitz/src/sundial/pak.js';
import { parseModel } from 'file:///D:/REPOS/blitz/src/sundial/model.js';
import { parseAnim } from 'file:///D:/REPOS/blitz/src/sundial/anim.js';
import { makeBind, assignParts, HUMAN } from 'file:///D:/REPOS/blitz/src/sundial/skeleton.js';
const load = p => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const D = 'C:/Users/mhowe/Downloads/ts2_disc/PAK/';
const fe = new Pak(load(D + 'FE_ANIM.PAK')), an = new Pak(load(D + 'ANIM.PAK')), chr = new Pak(load(D + 'CHR.PAK'));
const bindAnim = parseAnim(fe.get('anim/data/ts2/human_19_bindpose.raw'));
const bind = makeBind(bindAnim);
console.log('bind joints', bind.joints.map((j, i) => HUMAN.names[i] + ':' + j.toArray().map(v => v.toFixed(2)).join(',')).join('  '));
for (const name of ['chr01', 'chr15', 'chr128', 'chr32']) {
  const m = parseModel(chr.get(`ob/chrs/${name}.raw`));
  const map = assignParts(m, bind);
  const byBone = {}; map.forEach((b, p) => { if (m.parts[p].some(s => s && s.count)) (byBone[HUMAN.names[b]] ||= []).push(p); });
  console.log(name, JSON.stringify(byBone));
}
const run = parseAnim(an.get('anim/data/ts2/run_m0.raw'));
console.log('run', run.total, 'frames', run.keys.length, 'keys', run.bones.map(b => b.kind).join(','));
