// Export every decodable asset in usable form: animations + skeleton + rosters + playbooks as JSON.
// Usage: node tools/export_all.mjs "<bassets folder>" "<out folder>"
import fs from 'node:fs'; import path from 'node:path';
import { readDff } from '../src/assets/dff.js';
import { Bank } from '../src/assets/ban.js';
import { parseRoster, parsePlaybook } from '../src/assets/tables.js';
const [src, out] = process.argv.slice(2);
const load = f => new Uint8Array(fs.readFileSync(path.join(src, f)));
fs.mkdirSync(path.join(out, 'anim'), { recursive: true }); fs.mkdirSync(path.join(out, 'data'), { recursive: true });
// skeleton
const sk = readDff(load('skeleton_hierarchy.dff'));
fs.writeFileSync(path.join(out, 'data', 'skeleton.json'), JSON.stringify({ units: 'inches, z up', frames: sk.frames.map((f, i) => ({ index: i, parent: f.parent, hanimId: f.hanim, rot3x3: f.rot, pos: f.pos })), hanimTable: sk.frames[1].hanimTable }, null, 1));
// animation banks
for (const f of fs.readdirSync(src).filter(n => n.toLowerCase().endsWith('.ban'))) {
  const b = new Bank(load(f)); const clips = [];
  for (let i = 0; i < b.entries.length; i++) {
    const c = b.decode(i);
    clips.push({ name: c.name, frames: c.frames, keys: c.keys, fps: 30, rootBone: c.root, rootPos: c.pos ? Array.from(c.pos) : null, rot: Object.fromEntries([...c.rot].map(([bone, arr]) => [bone, Array.from(arr)])) });
  }
  fs.writeFileSync(path.join(out, 'anim', f.replace(/\.ban$/i, '.json')), JSON.stringify({ bank: f, note: 'rot = per HAnim bone id, flat xyzw quaternions per key; rootPos = hips xyz inches per key', clips }));
  console.log(f, clips.length, 'clips');
}
// rosters and playbooks
fs.writeFileSync(path.join(out, 'data', 'roster.json'), JSON.stringify(parseRoster(load('roster.rst')), null, 1));
const books = {};
for (const f of fs.readdirSync(src).filter(n => /^[a-z]{2}\.rsc$/.test(n))) { const pb = parsePlaybook(load(f)); books[f.slice(0, 2)] = { groups: pb.groups.map(g => ({ name: g.name, kind: g.kind, plays: g.plays.map(p => p.name) })), plays: [...pb.plays.values()].map(p => ({ id: p.id, name: p.name, offset: p.off })) }; }
fs.writeFileSync(path.join(out, 'data', 'playbooks.json'), JSON.stringify(books, null, 1));
console.log('data done');
