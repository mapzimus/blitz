// Arena bots: characters from the arena's own pack walking the nav graph, carrying real weapons,
// animated with the game's own clips through the 19-bone humanoid rig.
import * as THREE from 'three';
import { parseModel } from './model.js';
import { modelToGroup, hideFlash } from './build.js';
import { Rig, RWRIST, HEAD, gunGrip } from './skeleton.js';
import { WEAPONS, BOT_WEAPONS } from './weapons.js';

const DEATH = ['chestshot1_m0', 'chestshot2_m0', 'heartshot_m0', 'shothead_m0', 'shothead2_m0', 'fall_m0', 'stomachhit_m0'];
const HIT = ['hit_1_m0', 'hit_2_m0', 'hit_3_m0', 'hit_4_m0', 'hit_5_m0', 'Hit_react1_m0', 'Hit_react2_m0'];
const pick = a => a[Math.floor(Math.random() * a.length)];

export class Bots {
  constructor({ pak, gun, texSrc, gunTex, pad, scene, solid, anims, bind, onShoot, onBotKilled, names }) {
    this.scene = scene; this.solid = solid; this.onShoot = onShoot; this.onBotKilled = onBotKilled;
    this.anims = anims; this.bind = bind; this.gun = gun; this.gunTex = gunTex; this.names = names || []; this.pak = pak;
    this.ray = new THREE.Raycaster();
    this.list = [];
    this.nodes = new Map();
    for (const n of pad.nodes) if (Number.isFinite(n.pos[0])) this.nodes.set(n.id, { id: n.id, pos: new THREE.Vector3(...n.pos), next: [] });
    for (const l of pad.links) {
      const a = this.nodes.get(l.from), b = this.nodes.get(l.to);
      if (a && b) { a.next.push(b); b.next.push(a); }
    }
    this.nodeList = [...this.nodes.values()].filter(n => n.next.length);
    this.nodeList.forEach((n, i) => (n.idx = i));
    this.models = pak.list('ob/chrs/').filter(p => /chr\d+\.raw$/.test(p)).map(p => {
      try { return { name: p.slice(8, -4), model: parseModel(pak.get(p)) }; } catch (e) { return null; }
    }).filter(m => m && m.model.parts.length);
    this.texSrc = texSrc;
    this.gunCache = new Map();
  }

  clip(name) { return this.anims && this.anims.get(name); }
  heldGun(key) {
    const p = `ob/guns/${key}_cl.raw`;
    if (!this.gun || !this.gun.has(p)) return null;
    if (!this.gunCache.has(key)) { const m = parseModel(this.gun.get(p)); const g = modelToGroup(m, this.gunTex, { lit: true }); g.scale.setScalar(m.scale || 1); hideFlash(g); this.gunCache.set(key, g); }
    return this.gunCache.get(key).clone();
  }

  spawn(count) {
    if (!this.models.length || !this.nodeList.length) return;
    for (let i = 0; i < count; i++) {
      const { name, model } = this.models[i % this.models.length];
      const g = modelToGroup(model, this.texSrc, { lit: true });
      g.scale.setScalar(model.scale || 1);
      g.userData.bot = true;
      const b = { id: i, name: this.names[i] || name, group: g, hp: 100, node: null, target: null, cool: 1 + Math.random(), dead: 0, speed: 2.6 + Math.random() * 0.8, hitFlash: 0, react: 0, rig: null, state: '', kills: 0, deaths: 0, weapon: null, gunObj: null };
      if (this.bind) {
        b.rig = new Rig(g, model, this.bind);
        // Hats are separate models in character space; they ride the head bone.
        const hatPath = `ob/chrs/${name}_hat.raw`;
        if (this.pak.has(hatPath)) {
          try { const hm = parseModel(this.pak.get(hatPath)); const hat = modelToGroup(hm, this.texSrc, { lit: true }); b.rig.attach(hat, HEAD, this.bind.inv[HEAD].clone()); } catch (e) { /* no hat */ }
        }
      }
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

  arm(b, key) {
    if (b.gunObj && b.rig) b.rig.detach(b.gunObj);
    b.weapon = key; b.gunObj = null;
    const g = this.heldGun(key);
    if (g && b.rig) { b.gunObj = g; b.rig.attach(g, RWRIST, gunGrip()); }
  }

  respawn(b) {
    if (b.out) { b.group.visible = false; b.dead = 999; return; }
    b.node = this.nodeList[Math.floor(Math.random() * this.nodeList.length)];
    b.target = b.node.next[Math.floor(Math.random() * b.node.next.length)];
    b.group.position.copy(b.node.pos);
    b.group.rotation.set(0, Math.random() * 6.28, 0);
    b.group.visible = true;
    b.hp = 100; b.dead = 0; b.cool = 1.5; b.react = 0; b.state = '';
    b.group.traverse(o => { if (o.isMesh) o.material.forEach(mt => mt.color.setScalar(1)); });
    this.arm(b, pick(BOT_WEAPONS));
    this.setAnim(b, 'standpose_m0');
  }

  // Damage a bot. Returns true when it died.
  hit(b, dmg, by) {
    if (b.dead) return false;
    b.hp -= dmg; b.hitFlash = 0.15;
    if (b.hp <= 0) {
      b.dead = 0.001; b.deaths++;
      this.onBotKilled(b, by);
      this.setAnim(b, pick(DEATH), { loop: false });
      return true;
    }
    if (dmg >= 15) { b.react = 0.45; this.setAnim(b, pick(HIT), { loop: false }); }
    return false;
  }

  canSee(from, to) {
    const dir = to.clone().sub(from); const d = dir.length(); dir.normalize();
    this.ray.set(from, dir); this.ray.far = d;
    return this.ray.intersectObjects(this.solid, false).length === 0;
  }

  muzzle(b) { return b.rig ? b.rig.bonePosition(RWRIST) : b.group.position.clone().setY(b.group.position.y + 1.4); }

  nearestNode(pos) {
    let best = null, bd = Infinity;
    for (const n of this.nodeList) { const d = n.pos.distanceToSquared(pos); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  // Breadth-first route from node a to node b; returns the next node to walk to, or null.
  nextToward(a, b) {
    if (a === b) return null;
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length) {
      const n = q.shift();
      for (const m of n.next) if (!prev.has(m)) { prev.set(m, n); if (m === b) { let c = m; while (prev.get(c) !== a) c = prev.get(c); return c; } q.push(m); }
    }
    return null;
  }

  // Nearest living enemy a bot can see: the player or another bot. Returns { who, pos, dist } or null.
  pickTarget(b, eye, player) {
    let best = null;
    if (!player.dead) {
      const pe = player.pos.clone(); pe.y += player.eye;
      const d = eye.distanceTo(pe);
      if (d < 35 && this.canSee(eye, pe)) best = { who: 'player', pos: pe, dist: d, moving: player.vel.lengthSq() > 1 };
    }
    for (const o of this.list) {
      if (o === b || o.dead) continue;
      const op = o.group.position.clone(); op.y += 1.3;
      const d = eye.distanceTo(op);
      if (d < 25 && (!best || d < best.dist * 0.8) && this.canSee(eye, op)) best = { who: o, pos: op, dist: d, moving: o.state === 'run_m0' };
    }
    return best;
  }

  update(dt, player) {
    const eye = new THREE.Vector3();
    const skill = this.skill || 1; // 0.6 easy .. 1.4 hard
    for (const b of this.list) {
      const g = b.group;
      if (b.rig) b.rig.update(dt);
      if (b.dead) {
        if (b.out) { if (b.dead < 999) { b.dead += dt; if (b.dead > 3) g.position.y -= dt * 0.8; if (b.dead > 4.5) this.respawn(b); } continue; }
        b.dead += dt;
        if (!b.rig) g.rotation.x = Math.min(Math.PI / 2, b.dead * 4);
        if (b.dead > 3) g.position.y -= dt * 0.8;
        if (b.dead > 4.5) this.respawn(b);
        continue;
      }
      if (b.hitFlash > 0) { b.hitFlash -= dt; const k = b.hitFlash > 0 ? 3 : 1; g.traverse(o => { if (o.isMesh && o.userData.part !== undefined) o.material.forEach(mt => mt.color.setScalar(k)); }); }
      if (b.react > 0) { b.react -= dt; continue; }

      eye.copy(g.position); eye.y += 1.6;
      const tgt = this.pickTarget(b, eye, player);
      const w = WEAPONS[b.weapon] || WEAPONS.uzi;
      if (tgt) {
        const toT = tgt.pos.clone().sub(eye); const dist = tgt.dist;
        b.lastSeen = 0; b.hunt = this.nearestNode(tgt.pos);
        g.rotation.y = Math.atan2(toT.x, toT.z);
        b.cool -= dt;
        if (b.cool <= 0) {
          // Bots fire in bursts at a fraction of the weapon's rate.
          b.cool = (w.auto ? 60 / w.rpm * 2.5 : 60 / w.rpm * 1.6 + 0.3) / skill;
          const acc = Math.max(0.1, 0.55 - dist / 70) * (tgt.moving ? 0.65 : 1) * skill;
          this.onShoot(b, w, this.muzzle(b), tgt.pos, Math.random() < acc, tgt.who);
        }
        const keep = w.kind === 'rocket' || w.kind === 'grenade' ? 10 : w.kind === 'beam' ? 3 : 7;
        if (dist > keep) this.walk(b, dt, true); else this.setAnim(b, 'fire_pose_m0');
      } else {
        b.cool = Math.max(b.cool, 0.4);
        b.lastSeen = (b.lastSeen || 0) + dt;
        // Hunt the last known position for a while, else head for the mode's goal, else roam.
        if (b.hunt && b.lastSeen < 8) this.walk(b, dt, true);
        else if (b.goal) { b.hunt = b.goal; this.walk(b, dt, true); }
        else { b.hunt = null; this.walk(b, dt); }
      }
    }
  }

  walk(b, dt, hunting = false) {
    const g = b.group;
    const to = b.target.pos.clone().sub(g.position);
    const d = to.length();
    if (d < 0.3) {
      b.node = b.target;
      let next = null;
      if (hunting && b.hunt) next = this.nextToward(b.node, b.hunt);
      if (!next) { const opts = b.node.next.filter(n => n !== b.node); next = opts[Math.floor(Math.random() * opts.length)] || b.node.next[0]; }
      b.target = next;
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
  // Splash damage from an explosion.
  splash(pos, radius, dmg, by) {
    for (const b of this.list) {
      if (b.dead) continue;
      const c = b.group.position.clone(); c.y += 0.9;
      const d = c.distanceTo(pos);
      if (d < radius) this.hit(b, Math.round(dmg * (1 - d / radius * 0.7)), by);
    }
  }
}
