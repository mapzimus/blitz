// Arena bots: characters from the arena's own pack walking the nav graph, carrying real weapons,
// animated with the game's own clips through the 19-bone humanoid rig.
import * as THREE from 'three';
import { parseModel } from './model.js';
import { modelToGroup, hideFlash } from './build.js';
import { Rig, RWRIST, HEAD, gunGrip } from './skeleton.js';
import { WEAPONS, BOT_WEAPONS } from './weapons.js';
import { CHARACTER_TEXT } from './names.js';

const DEATH = ['chestshot1_m0', 'chestshot2_m0', 'heartshot_m0', 'shothead_m0', 'shothead2_m0', 'fall_m0', 'stomachhit_m0'];
const HIT = ['hit_1_m0', 'hit_2_m0', 'hit_3_m0', 'hit_4_m0', 'hit_5_m0', 'Hit_react1_m0', 'Hit_react2_m0'];
const pick = a => a[Math.floor(Math.random() * a.length)];

export class Bots {
  constructor({ pak, gun, texSrc, gunTex, pad, scene, solid, anims, bind, onShoot, onBotKilled, names, text }) {
    this.scene = scene; this.solid = solid; this.onShoot = onShoot; this.onBotKilled = onBotKilled; this.text = text;
    this.anims = anims; this.bind = bind; this.gun = gun; this.gunTex = gunTex; this.names = names || []; this.pak = pak;
    this.ray = new THREE.Raycaster();
    this.list = [];
    this.nodes = new Map();
    for (const n of pad.nodes) if (Number.isFinite(n.pos[0])) this.nodes.set(n.id, { id: n.id, pos: new THREE.Vector3(...n.pos), next: [], room: n.link });
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
      const b = { id: i, name: (this.text && this.text.get(CHARACTER_TEXT[name])) || this.names[i] || `Contender ${i + 1}`, group: g, hp: 100, node: null, target: null, cool: 1 + Math.random(), dead: 0, speed: 2.6 + Math.random() * 0.8, hitFlash: 0, react: 0, rig: null, state: '', kills: 0, deaths: 0, weapon: null, gunObj: null };
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

  // Story enemies: a named character placed at a spot, with an optional patrol route (list of nav nodes).
  // They do not respawn, and only start hunting once they notice the player.
  spawnAt({ model, lod, pos, yaw = 0, name, weapon, hp = 80, route = null, skill }) {
    const path = model && this.pak.has(model) ? model : lod && this.pak.has(lod) ? lod : null;
    if (!path) return null;
    let m = this.modelCache && this.modelCache.get(path);
    if (!m) { try { m = parseModel(this.pak.get(path)); } catch (e) { return null; } (this.modelCache = this.modelCache || new Map()).set(path, m); }
    if (!m.parts.length) return null;
    const g = modelToGroup(m, this.texSrc, { lit: true });
    g.scale.setScalar(m.scale || 1);
    g.userData.bot = true;
    const stem = path.replace(/^.*\//, '').replace(/\.raw$/, '');
    const b = { id: this.list.length, name: name || (this.text && this.text.get(CHARACTER_TEXT[stem])) || 'Guard', group: g, hp, maxHp: hp, node: null, target: null, cool: 1 + Math.random(), dead: 0, speed: 2.4 + Math.random() * 0.6, hitFlash: 0, react: 0, rig: null, state: '', kills: 0, deaths: 0, weapon: null, gunObj: null, story: true, alert: false, route, routeIdx: 0, wait: 0, home: pos.clone(), homeYaw: yaw, lives: 1, skill: skill || 1 };
    if (this.bind) {
      b.rig = new Rig(g, m, this.bind);
      const hatPath = `ob/chrs/${stem}_hat.raw`;
      if (this.pak.has(hatPath)) { try { const hm = parseModel(this.pak.get(hatPath)); const hat = modelToGroup(hm, this.texSrc, { lit: true }); b.rig.attach(hat, HEAD, this.bind.inv[HEAD].clone()); } catch (e) { /* no hat */ } }
    }
    g.position.copy(pos); g.rotation.set(0, yaw, 0);
    this.scene.add(g);
    this.list.push(b);
    b.node = this.nearestNode(pos); b.target = b.node;
    // Guards the tables leave without a route still walk a short beat around their post, so a level
    // never looks frozen; they pause longer at each end than routed patrols do.
    if ((!route || route.length < 2) && b.node) {
      const beat = [b.node]; let cur = b.node;
      for (let i = 0; i < 3; i++) {
        const opts = cur.next.filter(n => !beat.includes(n) && n.pos.distanceTo(b.home) < 12 && Math.abs(n.pos.y - b.home.y) < 1.5);
        if (!opts.length) break;
        cur = pick(opts); beat.push(cur);
      }
      if (beat.length > 1) { b.route = beat.concat(beat.slice(1, -1).reverse()); b.beat = true; }
    }
    this.arm(b, weapon && WEAPONS[weapon] ? weapon : pick(BOT_WEAPONS));
    this.setAnim(b, 'standpose_m0');
    return b;
  }
  remove(b) { this.scene.remove(b.group); this.list = this.list.filter(x => x !== b); }
  // Wake a guard up: it and anyone close by start hunting toward where the trouble is (the player by default).
  alertBot(b, radius = 12, at = null) {
    if (!b.story || b.alert) return;
    const where = at || (this.player && this.player.pos);
    const wake = o => { o.alert = true; o.lastSeen = 0; if (where) o.hunt = this.nearestNode(where); };
    wake(b);
    for (const o of this.list) if (o.story && !o.alert && !o.dead && o.group.position.distanceTo(b.group.position) < radius) wake(o);
  }
  // A gunshot at `pos`: guards within earshot come running. Silenced weapons carry only a few metres.
  hearShot(pos, radius) {
    for (const b of this.list) if (b.story && !b.dead && !b.alert && b.group.position.distanceTo(pos) < radius) this.alertBot(b, 8, pos);
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
    if (b.story) this.alertBot(b, 10);
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
      if (d < (b.story ? 45 : 35) && this.canSee(eye, pe)) best = { who: 'player', pos: pe, dist: d, moving: player.vel.lengthSq() > 1 };
    }
    for (const o of this.list) {
      if (o === b || o.dead || (b.story && o.story)) continue;
      const op = o.group.position.clone(); op.y += 1.3;
      const d = eye.distanceTo(op);
      if (d < 25 && (!best || d < best.dist * 0.8) && this.canSee(eye, op)) best = { who: o, pos: op, dist: d, moving: o.state === 'run_m0' };
    }
    return best;
  }

  update(dt, player) {
    this.player = player;
    const eye = new THREE.Vector3();
    const skill = this.skill || 1; // 0.6 easy .. 1.4 hard
    for (const b of this.list) {
      const g = b.group;
      if (b.rig) b.rig.update(dt);
      if (b.dead) {
        if (b.story) { b.dead += dt; if (b.dead > 12) { b.dead += 0; g.position.y -= dt * 0.5; } if (b.dead > 15) { this.remove(b); } continue; }
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
      if (b.story && !b.alert) {
        // On guard: notice the player in front within 18 m, or anywhere within 4 m, then raise the others nearby.
        if (!player.dead) {
          const pe = player.pos.clone(); pe.y += player.eye;
          const to = pe.clone().sub(eye); const d = to.length(); to.normalize();
          const facing = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
          const infront = facing.dot(to) > 0.45;
          if ((d < 4 || (d < 18 * (this.skill || 1) && infront)) && this.canSee(eye, pe)) { b.notice = (b.notice || 0) + dt * (d < 6 ? 3 : 1); if (b.notice > 0.5) this.alertBot(b); }
          else b.notice = Math.max(0, (b.notice || 0) - dt);
        }
        if (!b.alert) { this.patrol(b, dt); continue; }
      }
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
        // An alerted guard that lost sight of the player keeps closing in: every few seconds it
        // re-reads where the player is (the base knows an intruder is about), instead of wandering.
        if (b.story && b.alert && !player.dead && (!b.hunt || b.lastSeen > 5)) { b.hunt = this.nearestNode(player.pos); b.lastSeen = 0.01; }
        // Hunt the last known position for a while, else head for the mode's goal, else go shopping, else roam.
        if (b.hunt && b.lastSeen < 8) this.walk(b, dt, true);
        else if (b.goal) { b.hunt = b.goal; this.walk(b, dt, true); }
        else if (this.seekPickup(b, dt)) { /* walking to an item */ }
        else { b.hunt = null; this.walk(b, dt); }
      }
    }
  }

  // Guard duty: walk the patrol route if there is one, else stand at the post and look around.
  patrol(b, dt) {
    const g = b.group;
    if (b.route && b.route.length > 1) {
      if (b.wait > 0) { b.wait -= dt; this.setAnim(b, 'standpose_m0'); return; }
      const tp = b.route[b.routeIdx % b.route.length].pos;
      const to = tp.clone().sub(g.position); to.y = 0;
      const d = to.length();
      if (d < 0.4) { b.routeIdx++; b.wait = b.beat ? 2 + Math.random() * 4 : 0.8 + Math.random() * 2; return; }
      to.normalize();
      g.position.addScaledVector(to, Math.min(d, b.speed * 0.55 * dt));
      const yaw = Math.atan2(to.x, to.z);
      let dy = yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * Math.min(1, dt * 6);
      this.setAnim(b, 'walk_m0', { speed: 0.9 });
      if (b.state !== 'walk_m0') this.setAnim(b, 'run_m0', { speed: 0.5 });
      return;
    }
    b.wait -= dt;
    if (b.wait <= 0) { b.wait = 2 + Math.random() * 4; b.lookTo = b.homeYaw + (Math.random() - 0.5) * 1.6; }
    if (b.lookTo !== undefined) { let dy = b.lookTo - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.rotation.y += dy * Math.min(1, dt * 2); }
    this.setAnim(b, 'standpose_m0');
  }

  // Wander toward a worthwhile pickup nearby: a different gun, or health when hurt. Returns true while doing so.
  seekPickup(b, dt) {
    if (!this.pickups) return false;
    if (!b.seek || b.seek.taken > 0 || !b.seek.group.visible) {
      b.seek = null;
      if (Math.random() > dt * 0.5) return false; // look around now and then, not every frame
      let best = null, bd = 14;
      for (const p of this.pickups.list) {
        if (p.taken > 0) continue;
        const want = (p.kind === 'weapon' && p.key !== b.weapon) || (p.kind === 'health' && b.hp < 70) || (p.kind === 'armour' && !b.armoured);
        if (!want) continue;
        const d = p.group.position.distanceTo(b.group.position);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return false;
      b.seek = best;
    }
    const g = b.group, tp = b.seek.group.position;
    const flat = tp.clone(); flat.y = g.position.y;
    const d = flat.distanceTo(g.position);
    if (d < 3.5) {
      // close: walk straight at it
      const to = flat.sub(g.position).normalize();
      g.position.addScaledVector(to, Math.min(d, b.speed * dt));
      g.rotation.y = Math.atan2(to.x, to.z);
      this.setAnim(b, 'run_m0', { speed: b.speed / 3.2 });
      if (d < 0.2) b.seek = null;
      return true;
    }
    b.hunt = this.nearestNode(tp);
    this.walk(b, dt, true);
    return true;
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
  // True when the mesh that was hit belongs to the head or neck bone.
  isHead(b, mesh) { return !!(b.rig && mesh && mesh.userData.part !== undefined && [3, 4].includes(b.rig.partBone[mesh.userData.part])); }
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
