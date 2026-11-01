// Story missions: the level's own placement tables (props, doors, pickups, enemy spawners, cameras,
// switches, lifts, objectives) drive a mission, and a per-level script (missions/levelNN.js) adds the
// scripted events on top. The tables come from the private story data file for the level.
import * as THREE from 'three';
import { parseModel } from './model.js';
import { modelToGroup, hideFlash } from './build.js';

const DEG = Math.PI / 180;
export const DIFF = { easy: 0, normal: 1, hard: 2 };
const CAT = ['main', 'secondary', 'bonus'];
// Condition flags on every placement record: bit 7/8/9 = present on easy/normal/hard (story), 0x1000 = fire at once,
// 0x40000 = two players only, 0x80000 = three or more players.
export function placed(cond, diff) {
  if (cond & 0xc0000) return false;
  return !!(cond & (0x80 << diff));
}
const fmtDeg = r => [r[0] * DEG, r[1] * DEG, r[2] * DEG];

export class Story {
  constructor({ data, diff, scene, pak, texSrc, gun, gunTex, world, bots, text, hooks }) {
    this.data = data; this.diff = diff; this.scene = scene; this.pak = pak; this.texSrc = texSrc; this.gun = gun; this.gunTex = gunTex;
    this.world = world; this.bots = bots; this.text = text; this.hooks = hooks;
    this.models = new Map();
    this.group = new THREE.Group(); scene.add(this.group);
    this.doors = []; this.props = []; this.pickups = []; this.spawners = []; this.cameras = []; this.switches = []; this.lifts = []; this.triggers = [];
    this.timers = []; this.vars = {}; this.events = [];
    this.anims = new Set(); this.alarm = false; this.over = null; this.time = 0;
    this.nodes = new Map(Object.entries(data.nodes || {}).map(([k, v]) => [parseInt(k), { pos: new THREE.Vector3(...v.pos), yaw: v.yaw, room: v.link, type: v.type }]));
    this.objectives = (data.objectives || []).map((o, i) => ({ i, text: o.text, cat: o.cat[diff], counted: !!o.counted, state: o.cat[diff] < 0 ? 'absent' : 'hidden', count: 0, need: 0 }));
    this.build();
  }

  // ---------- helpers ----------
  node(id) { return this.nodes.get(id) || null; }
  model(path, src = this.pak, tex = this.texSrc) {
    if (!path) return null;
    const key = (src === this.gun ? 'gun:' : '') + path;
    if (this.models.has(key)) return this.models.get(key);
    let m = null;
    try { if (src.has(path)) m = parseModel(src.get(path)); } catch (e) { m = null; }
    this.models.set(key, m);
    return m;
  }
  place(path, pos, rot, opts = {}) {
    const m = this.model(path, opts.src, opts.tex);
    if (!m || !m.parts.length) return null;
    const g = modelToGroup(m, opts.tex || this.texSrc, { lit: true });
    g.scale.setScalar(m.scale || 1);
    if (opts.src === this.gun) hideFlash(g);
    g.position.copy(pos);
    if (rot) { g.rotation.order = 'YXZ'; g.rotation.set(rot[0], rot[1], rot[2]); }
    this.group.add(g);
    g.updateMatrixWorld(true);
    return g;
  }
  bounds(g) { const b = new THREE.Box3(); g.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); b.union(bb); } }); return b; }
  str(id) { return this.text ? this.text.get(id, '') : ''; }
  emit(name, payload) { this.events.push({ name, ...payload }); if (this.script && this.script.on) { try { this.script.on(name, payload || {}, this.api); } catch (e) { console.error('mission script', name, e); } } }
  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  msg(t, ms) { if (this.hooks.msg) this.hooks.msg(t, ms); }

  // ---------- build from the tables ----------
  build() {
    const d = this.data, diff = this.diff;
    // Static props. Those with an engine callback are destructibles or animated; they still render.
    for (const list of [d.props, d.props2]) for (const p of list || []) {
      if (!placed(p.cond, diff) || !p.path) continue;
      const g = this.place(p.path, new THREE.Vector3(...p.pos), fmtDeg(p.rot));
      if (!g) continue;
      const prop = { rec: p, group: g, hp: 60, dead: false, id: p.id2 >= 0 ? p.id2 : p.id };
      g.userData.prop = prop;
      this.props.push(prop);
      if (!/tree|plant|fence|grass|bush|leaf|light|lamp|wire|pipe|cable|beam|rope|chain|dial|wheel|poster|sign|tannoy|monitor|telly|mirror/i.test(p.path)) this.world.solid.push(...g.children);
    }
    // Doors and other node-anchored objects.
    for (const o of d.objects || []) {
      if (!placed(o.cond, diff) || !o.path) continue;
      const nd = this.node(o.node);
      const pos = nd && (o.pos[0] === 0 && o.pos[1] === 0 && o.pos[2] === 0) ? nd.pos.clone() : new THREE.Vector3(...o.pos);
      const yaw = (o.pos[0] === 0 && o.pos[1] === 0 && o.pos[2] === 0 && nd ? nd.yaw : o.yaw) || 0;
      const g = this.place(o.path, pos, [0, yaw * DEG, 0]);
      if (!g) continue;
      const box = this.bounds(g);
      const door = { rec: o, group: g, pos, yaw, base: pos.y, height: box.max.y - box.min.y, open: 0, want: 0, locked: !!(o.w9 & 0x20) || o.type === 6, auto: o.type !== 6, idx: this.doors.length, range: Math.max(2.5, o.f6 * 1.4) };
      g.userData.door = door;
      this.doors.push(door);
      this.world.solid.push(...g.children);
    }
    // Pickups at nav nodes.
    for (const p of d.pickups || []) {
      if (!placed(p.cond, diff)) continue;
      const nd = this.node(p.node); if (!nd) continue;
      let g = null;
      if (p.kind === 'weapon' || p.kind === 'ammo') {
        const key = p.weapon && p.weapon.replace(/\.raw$/, '');
        const path = p.kind === 'ammo' ? null : `ob/guns/${key}_cl.raw`;
        if (path && this.gun && this.gun.has(path)) g = this.place(path, nd.pos.clone().setY(nd.pos.y + 0.5), null, { src: this.gun, tex: this.gunTex });
        else if (p.model && this.pak.has(p.model)) g = this.place(p.model, nd.pos.clone().setY(nd.pos.y + 0.5));
        if (!g) { const am = this.pak.list('ob/cartridge')[0]; if (am) g = this.place(am, nd.pos.clone().setY(nd.pos.y + 0.5)); }
      } else if (p.model) g = this.place(p.model, nd.pos.clone().setY(nd.pos.y + 0.5));
      if (!g) continue;
      g.scale.multiplyScalar(p.kind === 'weapon' ? 1.1 : 1);
      this.pickups.push({ rec: p, group: g, base: nd.pos.y + 0.5, spin: Math.random() * 6, taken: false, kind: p.kind, weapon: p.weapon && p.weapon.replace(/\.raw$/, ''), model: p.model });
    }
    // Enemy spawners: start closed; the condition function decides when they open.
    for (const s of d.spawners || []) {
      if (!placed(s.cond, diff) || !s.char || !s.char.model) continue;
      this.spawners.push({ rec: s, idx: this.spawners.length, spawned: 0, alive: [], cool: 0, open: !s.condFn, done: false });
    }
    // Cameras and turrets.
    for (const a of d.animObjects || []) {
      if (!placed(a.cond, diff) || !a.path) continue;
      const nd = this.node(a.node);
      const pos = nd ? nd.pos.clone() : new THREE.Vector3(...a.pos);
      const g = this.place(a.path, pos, [0, (nd ? nd.yaw : 0) * DEG, 0]);
      if (!g) continue;
      const kind = /cctv|cam/i.test(a.path) ? 'camera' : /gun/i.test(a.path) ? 'turret' : 'anim';
      const cam = { rec: a, group: g, pos, kind, yaw0: (nd ? nd.yaw : 0) * DEG, t: Math.random() * 6, on: true, hp: 40, dead: false, name: this.str(a.text), seen: 0, cool: 0 };
      g.userData.camera = cam;
      this.cameras.push(cam);
      if (kind !== 'anim') this.world.solid.push(...g.children);
    }
    // Switches, buttons, consoles.
    for (const n of d.interact || []) {
      if (!placed(n.cond, diff) || !n.path) continue;
      const g = this.place(n.path, new THREE.Vector3(...n.pos), [0, n.yaw * DEG, 0]);
      if (!g) continue;
      const sw = { rec: n, group: g, pos: new THREE.Vector3(...n.pos), used: false, id: n.id, fn: n.fn, cool: 0 };
      g.userData.switch = sw;
      this.switches.push(sw);
    }
    // Lifts: a platform that rides between its node and the matching upper node when stood on.
    for (const l of d.lifts || []) {
      const nd = this.node(l.node); if (!nd || !l.path) continue;
      const g = this.place(l.path, nd.pos.clone(), null);
      if (!g) continue;
      this.lifts.push({ rec: l, group: g, base: nd.pos.y, top: nd.pos.y + (l.words[8] ? Math.abs(l.words[8]) * 0 : 0) + 4.5, t: 0, dir: 0 });
      this.world.solid.push(...g.children);
    }
    // Trigger volumes.
    for (const t of d.triggers || []) {
      if (!placed(t.cond, diff)) continue;
      this.triggers.push({ rec: t, pos: new THREE.Vector3(...t.pos), r: t.radius, inside: false, fired: 0 });
    }
    // Start point.
    const starts = (d.starts || []).filter(s => placed(s.cond, diff) && this.node(s.node));
    const st = starts[0] || (d.starts || []).find(s => this.node(s.node));
    const sn = st && this.node(st.node);
    this.start = sn ? { pos: sn.pos.clone(), yaw: sn.yaw * DEG } : null;
  }

  // ---------- objectives ----------
  obj(i) { return this.objectives[i]; }
  reveal(i, need) { const o = this.obj(i); if (!o || o.state === 'absent') return; if (need !== undefined) o.need = need; if (o.state === 'hidden' || o.state === 'failed') { o.state = 'active'; this.msg(`OBJECTIVE: ${this.str(o.text).replace(/\n/g, ' ').toUpperCase()}`, 3500); this.hooks.hud && this.hooks.hud(); } }
  hide(i) { const o = this.obj(i); if (o && o.state === 'active') { o.state = 'hidden'; this.hooks.hud && this.hooks.hud(); } }
  complete(i) { const o = this.obj(i); if (!o || o.state === 'absent' || o.state === 'done') return; o.state = 'done'; this.msg(`${this.str(o.text).replace(/\n/g, ' ').toUpperCase()}  ·  DONE`, 3000); if (this.hooks.sfx) this.hooks.sfx('objective'); this.hooks.hud && this.hooks.hud(); this.checkWin(); }
  fail(i) { const o = this.obj(i); if (!o || o.state === 'absent' || o.state === 'done') return; o.state = 'failed'; this.hooks.hud && this.hooks.hud(); if (o.cat === 0) this.end(false, this.str(1322) || 'OBJECTIVES FAILED - RETRY MISSION'); }
  count(i, n) { const o = this.obj(i); if (!o) return; o.count = n; this.hooks.hud && this.hooks.hud(); }
  isDone(i) { const o = this.obj(i); return !!o && o.state === 'done'; }
  isActive(i) { const o = this.obj(i); return !!o && o.state === 'active'; }
  allMainDone() { return this.objectives.filter(o => o.cat === 0 && o.state !== 'absent').every(o => o.state === 'done'); }
  checkWin() { if (!this.over && this.allMainDone() && !(this.script && this.script.manualEnd)) this.end(true); }
  end(win, why) { if (this.over) return; this.over = { win, why }; this.hooks.end && this.hooks.end(win, why); }

  // ---------- script API ----------
  get api() {
    if (this._api) return this._api;
    const S = this;
    this._api = {
      story: S, data: S.data, diff: S.diff, vars: S.vars, text: id => S.str(id),
      reveal: (i, need) => S.reveal(i, need), hide: i => S.hide(i), complete: i => S.complete(i), fail: i => S.fail(i), count: (i, n) => S.count(i, n), isDone: i => S.isDone(i), isActive: i => S.isActive(i),
      msg: (t, ms) => S.msg(t, ms), say: (id, ms = 3500) => S.msg(S.str(id).replace(/\n/g, ' '), ms), after: (s, fn) => S.after(s, fn), sfx: n => S.hooks.sfx && S.hooks.sfx(n),
      openDoor: i => S.setDoor(i, true), closeDoor: i => S.setDoor(i, false), lockDoor: (i, v = true) => { const dr = S.doors[i]; if (dr) dr.locked = v; },
      openSpawner: i => { const s = S.spawners[i]; if (s) s.open = true; }, closeSpawner: i => { const s = S.spawners[i]; if (s) s.open = false; },
      spawn: (classIdx, nodeId, opts) => S.spawnEnemy(classIdx, nodeId, opts), enemies: () => S.bots.list.filter(b => b.story && !b.dead),
      alarm: (on = true) => { S.alarm = on; S.anims.add(101); S.emit('alarm', { on }); }, anim: id => { S.anims.add(id); S.emit('anim', { id }); },
      killCamera: i => { const c = S.cameras[i]; if (c) { c.on = false; } }, cameras: () => S.cameras,
      playerAt: (nodeId, r = 3) => { const nd = S.node(nodeId); return !!nd && S.hooks.player().pos.distanceTo(nd.pos) < r; },
      playerPos: () => S.hooks.player().pos, node: id => S.node(id), give: key => S.hooks.give && S.hooks.give(key), take: key => S.hooks.take && S.hooks.take(key),
      win: () => S.end(true), lose: why => S.end(false, why), end: () => { S.script = S.script || {}; S.script.manualEnd = true; },
      portal: nodeId => S.placePortal(nodeId),
    };
    return this._api;
  }
  useScript(mod) { this.script = mod || null; if (mod && mod.manualEnd) { /* keep */ } try { mod && mod.setup && mod.setup(this.api); } catch (e) { console.error('mission setup', e); } if (!mod || !mod.setup) this.defaultSetup(); }
  defaultSetup() {
    // Without a script: show every objective of the difficulty, complete the crystal one on pickup and win on "escape".
    this.objectives.forEach(o => { if (o.state === 'hidden') this.reveal(o.i); });
  }
  placePortal(nodeId) {
    const nd = this.node(nodeId); if (!nd) return;
    const path = this.pak.list('ob/spawnfx/')[0];
    const g = path ? this.place(path, nd.pos.clone().setY(nd.pos.y + 0.1), null) : null;
    this.portal = { pos: nd.pos.clone(), group: g };
    this.msg('ESCAPE THROUGH THE TIME PORTAL', 3000);
  }

  // ---------- doors ----------
  setDoor(i, open) { const dr = this.doors[i]; if (!dr) return; dr.want = open ? 1 : 0; if (open) dr.locked = false; dr.hold = open ? 4 : 0; this.emit(open ? 'doorOpen' : 'doorClose', { door: i }); }
  doorNear(idx) { const dr = this.doors[idx]; return dr ? dr.pos : null; }

  // ---------- enemies ----------
  spawnEnemy(classIdx, nodeId, opts = {}) {
    const cls = (this.data.classes || [])[classIdx];
    const nd = this.node(nodeId);
    if (!cls || !nd || !this.bots) return null;
    const b = this.bots.spawnAt({ model: cls.model, lod: cls.lod, pos: nd.pos, yaw: nd.yaw * DEG, name: this.str(cls.text - 1) || this.str(cls.text), weapon: opts.weapon, hp: opts.hp || 60 + (cls.stats ? cls.stats[1] * 4 : 0), route: opts.route, skill: opts.skill });
    if (b) { b.story = true; b.classIdx = classIdx; b.spawner = opts.spawner; }
    return b;
  }
  route(idx) {
    const diffs = this.data.difficulty || [];
    const r = diffs[idx] && diffs[idx][this.diff];
    if (!r || !r.words) return null;
    const ids = [];
    for (const w of r.words) { if (w >= 1000 && w < 10000) ids.push(w); else if (w === 0xffffffff) break; }
    return ids.map(id => this.node(id)).filter(Boolean);
  }
  spawnerOpen(s, player) {
    const r = s.rec;
    const w = r.watch;
    switch (r.condFn) {
      case null: case undefined: return true;
      case '0x359430': { const nd = this.node(w); return !!nd && player.pos.distanceTo(nd.pos) < 5; }
      case '0x3597e0': { const near = this.bots.nearestNode(player.pos); return !!near && near.room === w; }
      case '0x359748': return this.anims.has(w);
      case '0x359670': { const d = this.doors[w]; return !!d && (d.open > 0.5 || d.triggered); }
      default: return this.alarm || s.openByScript || false;
    }
  }
  tickSpawners(dt, player) {
    for (const s of this.spawners) {
      if (s.done) continue;
      s.alive = s.alive.filter(b => !b.dead);
      if (!s.open) { if (this.spawnerOpen(s, player)) s.open = true; else continue; }
      s.cool -= dt;
      if (s.cool > 0) continue;
      const r = s.rec;
      if (s.spawned >= r.total || s.alive.length >= r.alive) { if (s.spawned >= r.total) s.done = true; continue; }
      if ((r.flags & 0x20) && this.bots.canSee(player.pos.clone().setY(player.pos.y + 1.5), this.node(r.node).pos.clone().setY(this.node(r.node).pos.y + 1.2))) { s.cool = 1; continue; }
      const route = r.route >= 0 ? this.route(r.route) : null;
      const b = this.spawnEnemy(r.classIdx, r.node, { route, spawner: s, weapon: this.classWeapon(r) });
      if (!b) { s.done = true; continue; }
      s.spawned++; s.alive.push(b); s.cool = Math.max(0.5, r.delay || 0);
      this.emit('spawn', { spawner: s.idx, bot: b });
    }
  }
  classWeapon(r) {
    // Soldiers get the level's rifles; special classes keep their defaults. The weapon set is in table order.
    const set = this.data.weaponSet || [];
    const guns = set.map(w => (w.model || '').split('/').pop().replace('_cl.raw', '')).filter(k => /ak47|tommygun|uzi|shotgun|plasma|scifi|luger|magnum|minigun|flamethrower|laser|sniper|pistol/.test(k) && !/mapboy|fireext/.test(k));
    if (!guns.length) return undefined;
    const pick = guns.filter(k => !/sniper|silenced/.test(k));
    const pool = pick.length ? pick : guns;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------- per frame ----------
  update(dt, player) {
    if (this.over) return;
    this.time += dt;
    for (const t of this.timers) { t.t -= dt; if (t.t <= 0) { t.done = true; try { t.fn(this.api); } catch (e) { console.error('timer', e); } } }
    if (this.timers.some(t => t.done)) this.timers = this.timers.filter(t => !t.done);
    // doors
    for (const dr of this.doors) {
      const near = !player.dead && player.pos.distanceTo(dr.pos) < dr.range;
      if (dr.auto && !dr.locked && near) { dr.want = 1; dr.hold = 1.2; }
      else if (dr.hold > 0) { dr.hold -= dt; if (dr.hold <= 0) dr.want = 0; }
      else dr.want = 0;
      if (dr.open !== dr.want) {
        const was = dr.open;
        dr.open += Math.sign(dr.want - dr.open) * dt / 0.7;
        dr.open = Math.max(0, Math.min(1, dr.open));
        dr.group.position.y = dr.base + dr.height * 0.95 * dr.open;
        if (was === 0 && dr.open > 0) { this.hooks.sfx && this.hooks.sfx('door'); this.emit('doorOpen', { door: dr.idx }); }
      }
    }
    // pickups
    const t = this.time;
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.group.rotation.y = t * 1.6 + p.spin; p.group.position.y = p.base + Math.sin(t * 2 + p.spin) * 0.08;
      if (!player.dead && player.pos.distanceTo(p.group.position.clone().setY(player.pos.y)) < 0.9 && Math.abs(player.pos.y - p.base) < 1.6) {
        if (this.hooks.pickup(p)) { p.taken = true; p.group.visible = false; this.emit('pickup', { pickup: p, kind: p.kind, weapon: p.weapon, model: p.model, node: p.rec.node }); }
      }
    }
    // switches: walk up and press E (or touch button)
    for (const sw of this.switches) {
      sw.cool -= dt;
      if (sw.cool > 0 || player.dead) continue;
      if (player.pos.distanceTo(sw.pos.clone().setY(player.pos.y)) < 1.7 && Math.abs(player.pos.y - sw.pos.y) < 2.2) {
        if (this.hooks.useHeld()) { sw.cool = 1.5; sw.used = true; this.useSwitch(sw); }
        else if (!sw.hint || this.time - sw.hint > 3) { sw.hint = this.time; this.msg('PRESS E TO USE', 1200); }
      }
    }
    // cameras and turrets
    for (const c of this.cameras) {
      if (c.dead) continue;
      c.t += dt;
      if (c.kind === 'camera' && c.on) {
        c.group.rotation.y = c.yaw0 + Math.sin(c.t * 0.6) * 0.8;
        c.cool -= dt;
        if (!player.dead && c.cool <= 0) {
          const eye = c.pos.clone(); eye.y += 0.2;
          const pe = player.pos.clone(); pe.y += 1.2;
          const to = pe.clone().sub(eye); const dist = to.length();
          if (dist < 16) {
            const facing = new THREE.Vector3(-Math.sin(c.group.rotation.y), 0, -Math.cos(c.group.rotation.y));
            const flat = to.clone().setY(0).normalize();
            if (facing.dot(flat) > 0.6 && this.bots.canSee(eye, pe)) { c.seen += dt; if (c.seen > 0.6) { c.seen = 0; c.cool = 6; this.emit('seen', { camera: c, name: c.name }); } }
            else c.seen = Math.max(0, c.seen - dt);
          }
        }
      } else if (c.kind === 'turret' && c.on) {
        c.cool -= dt;
        if (!player.dead && c.cool <= 0) {
          const eye = c.pos.clone(); eye.y += 0.6;
          const pe = player.pos.clone(); pe.y += 1.0;
          if (eye.distanceTo(pe) < 22 && this.bots.canSee(eye, pe)) {
            c.group.rotation.y = Math.atan2(pe.x - eye.x, pe.z - eye.z) + Math.PI;
            c.cool = 0.35; this.hooks.turretFire && this.hooks.turretFire(c, eye, pe);
          }
        }
      }
    }
    // triggers
    for (const tr of this.triggers) {
      const inside = !player.dead && player.pos.distanceTo(tr.pos) < Math.min(tr.r, 12);
      if (inside && !tr.inside) { tr.fired++; this.emit('trigger', { id: tr.rec.id, kind: tr.rec.kind, fn: tr.rec.fn, index: this.triggers.indexOf(tr) }); }
      tr.inside = inside;
    }
    // lifts
    for (const l of this.lifts) {
      const on = !player.dead && Math.abs(player.pos.x - l.group.position.x) < 1.6 && Math.abs(player.pos.z - l.group.position.z) < 1.6 && player.pos.y >= l.group.position.y - 0.3 && player.pos.y < l.group.position.y + 1.2;
      if (on && l.dir === 0) l.dir = l.t < 0.5 ? 1 : -1;
      if (l.dir) { l.t = Math.max(0, Math.min(1, l.t + l.dir * dt / 3)); const y = l.base + (l.top - l.base) * l.t; const dy = y - l.group.position.y; l.group.position.y = y; if (on) player.pos.y += dy; if (l.t === 0 || l.t === 1) l.dir = 0; }
    }
    // portal
    if (this.portal && !player.dead && player.pos.distanceTo(this.portal.pos) < 1.6) { this.portal = null; this.emit('portal', {}); if (!this.over) this.end(true); }
    this.tickSpawners(dt, player);
    if (this.script && this.script.update) { try { this.script.update(dt, this.api); } catch (e) { console.error('mission update', e); } }
  }

  // Engine default behaviours for switches, by the behaviour function the table names.
  useSwitch(sw) {
    const n = sw.rec;
    this.hooks.sfx && this.hooks.sfx('switch');
    if (n.fn === '0x2a59f8') { this.setDoor(n.w11, true); const d = this.doors[n.w11]; if (d) { d.auto = true; d.locked = false; d.hold = 999; } }
    else if (n.fn === '0x2a5870') { this.alarm = !this.alarm; this.anims.add(n.w11); this.emit('alarm', { on: this.alarm }); this.msg(this.alarm ? 'ALARM ACTIVATED' : 'ALARM DEACTIVATED', 2000); }
    else if (n.fn === '0x2a5db8' || n.fn === '0x2a5aa8') {
      const ids = (n.data || []).filter(x => x < 4000);
      for (const id of ids) { const c = this.cameras.find(c => c.rec.id === id); if (c) c.on = !c.on; const d = this.doors.find(d => d.rec.id === id); if (d && this.doors.indexOf(d) === id) this.setDoor(id, true); }
      ids.filter(id => id < 100).forEach(id => { const d = this.doors[id]; if (d) { d.locked = false; d.auto = true; } });
      this.msg('SYSTEM TOGGLED', 1500);
    }
    this.emit('use', { id: n.id, fn: n.fn, index: this.switches.indexOf(sw) });
  }

  // Damage to world objects from the player's shots. Returns true when something scripted took it.
  damage(obj, dmg, point) {
    let o = obj; while (o && !o.userData.prop && !o.userData.camera && !o.userData.door) o = o.parent;
    if (!o) return false;
    if (o.userData.camera) {
      const c = o.userData.camera; c.hp -= dmg;
      if (c.hp <= 0 && !c.dead) { c.dead = true; c.on = false; c.group.visible = false; this.world.solid = this.world.solid.filter(m => m.parent !== c.group); this.emit('cameraDestroyed', { camera: c, name: c.name, index: this.cameras.indexOf(c) }); this.msg(`${(c.name || 'CAMERA').toUpperCase()} DESTROYED`, 2000); }
      return true;
    }
    if (o.userData.prop) {
      const p = o.userData.prop;
      if (!p.rec.fn && !/crate|box|barrel|drum|bottle|tin|can|cabinet|monitor|telly|glass|window|lamp|light|melon|plant|dish|radar|computer|control|console|generator|sample|container|bio|canister|tank|fuel|explo/i.test(p.rec.path)) return false;
      p.hp -= dmg;
      if (p.hp <= 0 && !p.dead) { p.dead = true; p.group.visible = false; this.world.solid = this.world.solid.filter(m => m.parent !== p.group); this.hooks.explode && this.hooks.explode(p.group.position, /drum|barrel|fuel|tank|canister|explo/i.test(p.rec.path)); this.emit('destroyed', { prop: p, id: p.id, path: p.rec.path, index: this.props.indexOf(p) }); }
      return true;
    }
    return false;
  }
  botKilled(b, by) { if (b.story) this.emit('killed', { bot: b, classIdx: b.classIdx, spawner: b.spawner ? b.spawner.idx : -1, by }); }
  playerDied() { this.end(false, 'YOU WERE KILLED'); }

  dispose() { this.scene.remove(this.group); this.over = { win: false }; }
}
