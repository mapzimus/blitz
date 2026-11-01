// Arena bots: characters from the arena's own pack walking the nav graph and shooting on sight,
// animated with the game's own clips through the 19-bone humanoid rig.
import * as THREE from 'three';
import { parseModel } from './model.js';
import { modelToGroup } from './build.js';
import { Rig } from './skeleton.js';

const DEATH = ['chestshot1_m0', 'chestshot2_m0', 'heartshot_m0', 'shothead_m0', 'shothead2_m0', 'fall_m0', 'stomachhit_m0'];
const HIT = ['hit_1_m0', 'hit_2_m0', 'hit_3_m0', 'hit_4_m0', 'hit_5_m0', 'Hit_react1_m0', 'Hit_react2_m0'];
const pick = a => a[Math.floor(Math.random() * a.length)];

export class Bots {
  constructor({ pak, texSrc, pad, scene, solid, anims, bind, onPlayerHit, onBotKilled }) {
    this.scene = scene; this.solid = solid; this.onPlayerHit = onPlayerHit; this.onBotKilled = onBotKilled;
    this.anims = anims; this.bind = bind;
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

  clip(name) { return this.anims && this.anims.get(name); }

  spawn(count) {
    if (!this.models.length || !this.nodeList.length) return;
    for (let i = 0; i < count; i++) {
      const m = this.models[i % this.models.length];
      const g = modelToGroup(m, this.texSrc, { lit: true });
      g.scale.setScalar(m.scale || 1);
      g.userData.bot = true;
      const b = { group: g, hp: 100, node: null, target: null, cool: 1 + Math.random(), dead: 0, speed: 2.6 + Math.random() * 0.8, hitFlash: 0, react: 0, rig: null, state: '' };
      if (this.bind) { b.rig = new Rig(g, m, this.bind); }
      this.scene.add(g);
      this.list.push(b);
      this.respawn(b);
    }
  }

  setAnim(b, name, opts) {
    if (!b.rig) return;
    const c = this.clip(name);
    if (!c) return;
    if (b.state !== name) { b.state = name; b.rig.play(c, { restart: true, ...opts }); }
    else b.rig.play(c, opts);
  }

  respawn(b) {
    b.node = this.nodeList[Math.floor(Math.random() * this.nodeList.length)];
    b.target = b.node.next[Math.floor(Math.random() * b.node.next.length)];
    b.group.position.copy(b.node.pos);
    b.group.rotation.set(0, Math.random() * 6.28, 0);
    b.group.visible = true;
    b.hp = 100; b.dead = 0; b.cool = 1.5; b.react = 0; b.state = '';
    b.group.traverse(o => { if (o.isMesh) o.material.forEach(mt => mt.color.setScalar(1)); });
    this.setAnim(b, 'standpose_m0');
  }

  // Damage from the player. Returns true when the shot killed the bot.
  hit(b, dmg) {
    if (b.dead) return false;
    b.hp -= dmg; b.hitFlash = 0.15;
    if (b.hp <= 0) {
      b.dead = 0.001; this.onBotKilled(b);
      this.setAnim(b, pick(DEATH), { loop: false });
      return true;
    }
    b.react = 0.5;
    this.setAnim(b, pick(HIT), { loop: false });
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
      if (b.rig) b.rig.update(dt);
      if (b.dead) {
        b.dead += dt;
        if (!b.rig) g.rotation.x = Math.min(Math.PI / 2, b.dead * 4);
        if (b.dead > 3) g.position.y -= dt * 0.8;
        if (b.dead > 4.5) this.respawn(b);
        continue;
      }
      if (b.hitFlash > 0) { b.hitFlash -= dt; const k = b.hitFlash > 0 ? 3 : 1; g.traverse(o => { if (o.isMesh) o.material.forEach(mt => mt.color.setScalar(k)); }); }
      if (b.react > 0) { b.react -= dt; continue; } // flinching: stands still

      eye.copy(g.position); eye.y += 1.6;
      const toPlayer = pe.clone().sub(eye); const dist = toPlayer.length();
      const sees = dist < 30 && this.canSee(eye, pe);
      if (sees) {
        g.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        b.cool -= dt;
        if (b.cool <= 0) {
          b.cool = 0.7 + Math.random() * 0.6;
          const p = Math.max(0.15, 0.6 - dist / 60) * (player.vel.lengthSq() > 1 ? 0.6 : 1);
          this.onPlayerHit(b, Math.random() < p ? 9 : 0);
        }
        if (dist > 8) this.walk(b, dt); else this.setAnim(b, 'fire_pose_m0');
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
    this.setAnim(b, 'run_m0', { speed: b.speed / 3.2 });
  }

  get groups() { return this.list.filter(b => !b.dead).map(b => b.group); }
  find(obj) { let o = obj; while (o && !o.userData.bot) o = o.parent; return this.list.find(b => b.group === o); }
}
