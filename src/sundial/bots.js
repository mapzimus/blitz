// Arena bots: characters from the arena's own pack walking the nav graph and shooting on sight.
import * as THREE from 'three';
import { parseModel } from './model.js';
import { modelToGroup } from './build.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Bots {
  constructor({ pak, texSrc, pad, scene, solid, onPlayerHit, onBotKilled }) {
    this.scene = scene; this.solid = solid; this.onPlayerHit = onPlayerHit; this.onBotKilled = onBotKilled;
    this.ray = new THREE.Raycaster();
    this.list = [];
    this.nodes = new Map();
    for (const n of pad.nodes) if (Number.isFinite(n.pos[0])) this.nodes.set(n.id, { id: n.id, pos: new THREE.Vector3(...n.pos), next: [] });
    for (const l of pad.links) {
      const a = this.nodes.get(l.from), b = this.nodes.get(l.to);
      if (a && b) { a.next.push(b); b.next.push(a); }
    }
    this.nodeList = [...this.nodes.values()].filter(n => n.next.length);
    // Characters shipped with this arena (skip low-detail and hat variants).
    this.models = pak.list('ob/chrs/').filter(p => /chr\d+\.raw$/.test(p)).map(p => {
      try { return parseModel(pak.get(p)); } catch (e) { return null; }
    }).filter(m => m && m.parts.length);
    this.texSrc = texSrc;
  }

  spawn(count) {
    if (!this.models.length || !this.nodeList.length) return;
    for (let i = 0; i < count; i++) {
      const m = this.models[i % this.models.length];
      const g = modelToGroup(m, this.texSrc, { lit: true });
      g.scale.setScalar(m.scale || 1);
      g.userData.bot = true;
      const b = { group: g, hp: 100, node: null, target: null, cool: 1 + Math.random(), dead: 0, speed: 2.6 + Math.random() * 0.8, hitFlash: 0 };
      this.scene.add(g);
      this.list.push(b);
      this.respawn(b);
    }
  }

  respawn(b) {
    b.node = this.nodeList[Math.floor(Math.random() * this.nodeList.length)];
    b.target = b.node.next[Math.floor(Math.random() * b.node.next.length)];
    b.group.position.copy(b.node.pos);
    b.group.rotation.set(0, Math.random() * 6.28, 0);
    b.group.visible = true;
    b.hp = 100; b.dead = 0; b.cool = 1.5;
    b.group.traverse(o => { if (o.isMesh) o.material.forEach(mt => mt.color.setScalar(1)); });
  }

  // Damage from the player. Returns true when the shot killed the bot.
  hit(b, dmg) {
    if (b.dead) return false;
    b.hp -= dmg; b.hitFlash = 0.15;
    if (b.hp <= 0) { b.dead = 0.001; this.onBotKilled(b); return true; }
    return false;
  }

  canSee(from, to) {
    const dir = to.clone().sub(from); const d = dir.length(); dir.normalize();
    this.ray.set(from, dir); this.ray.far = d;
    return this.ray.intersectObjects(this.solid, false).length === 0;
  }

  update(dt, player) {
    const eye = new THREE.Vector3(), pe = player.pos.clone(); pe.y += player.eye;
    for (const b of this.list) {
      const g = b.group;
      if (b.dead) {
        b.dead += dt;
        // Fall over, sink, come back.
        g.rotation.x = Math.min(Math.PI / 2, b.dead * 4);
        if (b.dead > 2.5) g.position.y -= dt * 0.8;
        if (b.dead > 4) this.respawn(b);
        continue;
      }
      if (b.hitFlash > 0) { b.hitFlash -= dt; const k = b.hitFlash > 0 ? 3 : 1; g.traverse(o => { if (o.isMesh) o.material.forEach(mt => mt.color.setScalar(k)); }); }

      eye.copy(g.position); eye.y += 1.6;
      const toPlayer = pe.clone().sub(eye); const dist = toPlayer.length();
      const sees = dist < 30 && this.canSee(eye, pe);
      if (sees) {
        g.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        b.cool -= dt;
        if (b.cool <= 0) {
          b.cool = 0.7 + Math.random() * 0.6;
          // Accuracy falls off with range; player moving is harder to hit.
          const p = Math.max(0.15, 0.6 - dist / 60) * (player.vel.lengthSq() > 1 ? 0.6 : 1);
          this.onPlayerHit(b, Math.random() < p ? 9 : 0);
        }
        if (dist > 8) this.walk(b, dt); // close in
      } else {
        b.cool = Math.max(b.cool, 0.4);
        this.walk(b, dt);
      }
    }
  }

  walk(b, dt) {
    const g = b.group;
    const to = b.target.pos.clone().sub(g.position);
    const d = to.length();
    if (d < 0.3) {
      b.node = b.target;
      const opts = b.node.next.filter(n => n !== b.node);
      b.target = opts[Math.floor(Math.random() * opts.length)] || b.node.next[0];
      return;
    }
    to.normalize();
    g.position.addScaledVector(to, Math.min(d, b.speed * dt));
    const yaw = Math.atan2(to.x, to.z);
    let dy = yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * Math.min(1, dt * 8);
  }

  get groups() { return this.list.filter(b => !b.dead).map(b => b.group); }
  find(obj) { let o = obj; while (o && !o.userData.bot) o = o.parent; return this.list.find(b => b.group === o); }
}
