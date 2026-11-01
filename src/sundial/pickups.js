// Floating pickups on nav nodes: weapons, ammo, health, armour. Walk over one to take it.
import * as THREE from 'three';
import { parseModel } from './model.js';
import { modelToGroup } from './build.js';
import { WEAPONS, SFX } from './weapons.js';

export class Pickups {
  constructor({ scene, pak, gun, texSrc, gunTex, nodes, sfx, roster }) {
    this.scene = scene; this.sfx = sfx; this.list = [];
    this.gunTex = gunTex; this.gun = gun;
    const load = (p, src, tex) => { try { return parseModel(src.get(p)); } catch (e) { return null; } };
    this.protos = {
      health: pak.list('ob/health1/')[0] && { m: load(pak.list('ob/health1/')[0], pak), tex: texSrc },
      armour: pak.list('ob/armour/')[0] && { m: load(pak.list('ob/armour/')[0], pak), tex: texSrc },
      ammo: pak.list('ob/cartridge').map(p => ({ m: load(p, pak), tex: texSrc })).filter(x => x.m),
    };
    this.roster = roster;
    this.nodes = nodes;
    this.rng = Math.random;
  }
  place(count) {
    const nodes = this.nodes.slice();
    for (let i = nodes.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [nodes[i], nodes[j]] = [nodes[j], nodes[i]]; }
    const kinds = [];
    const nW = Math.ceil(count * 0.45), nA = Math.ceil(count * 0.3), nH = Math.ceil(count * 0.15), nR = Math.max(1, Math.floor(count * 0.1));
    for (let i = 0; i < nW; i++) kinds.push({ kind: 'weapon', key: this.roster[i % this.roster.length] });
    for (let i = 0; i < nA; i++) kinds.push({ kind: 'ammo' });
    for (let i = 0; i < nH; i++) kinds.push({ kind: 'health' });
    for (let i = 0; i < nR; i++) kinds.push({ kind: 'armour' });
    kinds.forEach((k, i) => { if (nodes[i]) this.add(k, nodes[i].pos); });
  }
  add(k, pos) {
    let proto = null;
    if (k.kind === 'weapon') {
      const p = `ob/guns/${k.key}_cl.raw`;
      if (this.gun.has(p)) proto = { m: parseModel(this.gun.get(p)), tex: this.gunTex };
    } else if (k.kind === 'ammo') proto = this.protos.ammo[Math.floor(this.rng() * this.protos.ammo.length)];
    else proto = this.protos[k.kind];
    if (!proto || !proto.m) return;
    const g = modelToGroup(proto.m, proto.tex, { lit: true });
    g.scale.setScalar((proto.m.scale || 1) * (k.kind === 'weapon' ? 1.1 : 1));
    g.position.set(pos.x, pos.y + 0.5, pos.z);
    this.scene.add(g);
    this.list.push({ ...k, group: g, base: pos.y + 0.5, taken: 0, spin: this.rng() * 6 });
  }
  update(dt, player, onTake) {
    const t = performance.now() / 1000;
    for (const p of this.list) {
      if (p.taken > 0) { p.taken -= dt; if (p.taken <= 0) p.group.visible = true; continue; }
      p.group.rotation.y = t * 1.6 + p.spin;
      p.group.position.y = p.base + Math.sin(t * 2 + p.spin) * 0.08;
      const d = p.group.position.distanceTo(player.pos.clone().setY(p.group.position.y));
      if (d < 0.9 && Math.abs(player.pos.y - p.base) < 1.5) {
        if (onTake(p)) { p.taken = p.kind === 'weapon' ? 25 : 18; p.group.visible = false; }
      }
    }
  }
}
