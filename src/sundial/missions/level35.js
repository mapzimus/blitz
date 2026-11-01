// Level 35 "Siberia" (Oblask Dam), story mission 1. Translated from the PS2 mission code: init FUN_00395140,
// per-frame FUN_00395170/FUN_003965e8, terminal FUN_00395960 and its timers, lockdown + alert hook FUN_003d2248,
// crystal/portal helpers FUN_003b1db0/FUN_003b1e70, gunship AI tail FUN_003c4a80 -> FUN_00398d20.
//
// Approximations (the api has no equivalent, so these lean on api.story where noted):
//  - Props cannot be "used": the computer terminal (dambigtelly) works by standing next to it while carrying the
//    system disk, and a steam valve (dampipewheel) counts as turned when it is shot.
//  - The runtime's lifts have no power state: while power is off (normal/hard) each lift's top is pinned to its base
//    through api.story.lifts, and "There is no power" reveals the Restore power objective (as FUN_00395e50 does).
//  - api.story.props is used to park the gunship over the dam and make it shootable, to make the terminal sturdier,
//    and to remove the containment laser doors when power is restored. api.story.doors flips the type-6 doors to auto.
//  - Nodes 1525 (dig-site entry) and 1086 (portal) are not in the node table: a position box and node 9152 stand in.
//  - Spawner groups gated by FUN_003599b0 / FUN_00359a18 (objective done AND player near the watch node) are opened by
//    the script, because the runtime does not know those condition functions.

const O = { DISH: 0, DIG: 1, BIO: 2, POWER: 3, TOP: 4, GUNSHIP: 5, FILES: 6, MUTANTS: 7, CRYSTAL: 8, ESCAPE: 9 };
const TERMINAL = [82.52, -8.43, 2.47];   // dambigtelly prop
const CHAMBER = [109, -12.8, 39];        // sanitation chamber between doors 14 and 15 (nodes 1445 / 1447)
const GUNSHIP_HOME = [47, 50, 40];       // above the middle of the dam, between the two towers (y 41)
// FUN_002441a0(0x2d) counts the Hybrid Mutant (classes[11], chr46). Those spawners carry the 3+ player flag, so the
// Feeder Zombie (classes[9], chr94) counts as a mutant too or the hard objective would have nothing to kill.
const MUTANTS = [9, 11];
const isMutant = s => MUTANTS.includes(s.classIdx);

const placed = (cond, diff) => !(cond & 0xc0000) && !!(cond & (0x80 << diff));
const flat = (p, x, y, z) => { const dx = p.x - x, dz = p.z - z; return Math.sqrt(dx * dx + dz * dz); };
// Table index -> runtime index (the runtime drops the records the difficulty leaves out).
function runtimeIndex(list, diff, ok) { const map = []; let k = 0; list.forEach((r, i) => { if (placed(r.cond, diff) && ok(r)) map[i] = k++; }); return map; }
const prop = (api, re) => ((api.story && api.story.props) || []).find(p => re.test(p.rec.path) && !p.dead);
const later = (api, sec, fn) => api.vars.timeline.push({ at: api.vars.t + sec, fn, done: false });

function door(api, tableIdx, what) {
  const i = api.vars.doors[tableIdx]; if (i === undefined) return;
  if (what === 'open') api.openDoor(i);
  else if (what === 'close') api.closeDoor(i);
  else if (what === 'auto') { const dr = api.story && api.story.doors && api.story.doors[i]; if (dr) { dr.locked = false; dr.auto = true; } else api.lockDoor(i, false); }
  else api.lockDoor(i, what === 'lock');
}
function setLifts(api, on) {
  for (const l of (api.story && api.story.lifts) || []) { if (l.top0 === undefined) l.top0 = l.top; l.top = on ? l.top0 : l.base; l.t = 0; l.dir = 0; }
}
function mainDoneExcept(api, skip) {
  return (api.data.objectives || []).every((o, i) => i === skip || o.cat[api.diff] !== 0 || api.isDone(i));
}

// ---------- set pieces ----------
function burnCabinet(api) {                       // FUN_00395600 / FUN_00395e90
  const f = api.vars.files; f.done++; api.count(O.FILES, f.done);
  const left = f.total - f.done;
  if (left > 0) api.msg(`${left} ${api.text(left === 1 ? 1136 : 1135)}`, 2500); else api.complete(O.FILES);
}
function steam(api) {                             // FUN_00397ab8 -> FUN_00395f80: three valves vent the steam
  const v = api.vars; v.wheels = Math.min(3, v.wheels + 1);
  api.msg(`${api.text(1143)} ${[0, 33, 66, 100][3 - v.wheels]}%`, 2500);
}
function restorePower(api) {                      // FUN_00395960 with the disk, and its timers
  const v = api.vars; v.booting = true;
  api.say(1137, 1500); later(api, 1.5, () => api.say(1138, 1500)); later(api, 3, () => api.say(1139, 1500));
  later(api, 3.5, () => {                         // FUN_003957e8: containment barriers drop, cell routes open
    api.anim(108);
    const S = api.story;
    for (const p of (S && S.props) || []) if (/damlaserdoor/.test(p.rec.path) && !p.dead) { p.dead = true; p.group.visible = false; S.world.solid = S.world.solid.filter(m => m.parent !== p.group); }
  });
  later(api, 4.5, () => api.say(1140, 2500)); later(api, 7, () => api.say(1141, 1500));
  later(api, 10, () => { v.power = true; api.complete(O.POWER); setLifts(api, true); api.sfx('switch'); }); // FUN_003958f0
}
function destroyContainer(api) {                  // FUN_00395460 third hit
  const v = api.vars;
  if (!api.isDone(O.DIG)) api.complete(O.DIG);
  if (!api.isActive(O.BIO)) api.reveal(O.BIO);
  api.complete(O.BIO); v.bioAt = v.t;
  door(api, 15, 'open');                          // FUN_003d2248: objective 2 done -> object 15 activates
  if (api.diff > 0 && !v.alerted) {               // FUN_003965e8: the facility goes on alert (normal/hard)
    v.alerted = true;
    for (const [s, id] of [[5, 1144], [8, 1145], [10.5, 1146], [12, 1147]]) later(api, s, () => api.say(id, 3000));
    v.lastWave = v.t;                             // from now on the mutants come hunting in waves (see mutantWave)
  }
}
// Every 20 s after the container is gone the four nearest unopened mutant spawners release, so "Don't allow any
// mutants to survive" can be finished without touring every watch node (the original relies on FUN_003599b0 proximity).
function mutantWave(api, p) {
  const v = api.vars; if (!v.alerted || v.t - v.lastWave < 20) return;
  v.lastWave = v.t;
  const cands = [];
  (api.data.spawners || []).forEach((s, i) => { const k = v.spawners[i]; const n = api.node(s.node); if (k !== undefined && !v.opened[k] && isMutant(s) && n) cands.push({ k, d: Math.hypot(n.pos.x - p.x, n.pos.y - p.y, n.pos.z - p.z) }); });
  cands.sort((a, b) => a.d - b.d).slice(0, 4).forEach(c => { v.opened[c.k] = true; api.openSpawner(c.k); });
}
function showMutants(api) {                       // hard: shown at node 1269 once the container is gone
  const v = api.vars; v.mutShown = true;
  api.reveal(O.MUTANTS, v.mutants.total); api.count(O.MUTANTS, v.mutants.killed);
  if (v.mutants.killed >= v.mutants.total) api.complete(O.MUTANTS);
}
function engageGunship(api) {                     // FUN_003c4a80 engages; FUN_00395dc8 fires 3 s later
  const v = api.vars; v.engaged = true;
  const ap = prop(api, /apache/);
  if (ap) { ap.rec = { ...ap.rec, fn: '0x3c4a80' }; ap.hp = 420; ap.group.visible = true; v.gunship = ap; v.gunAng = 0; }
  else later(api, 45, () => gunshipDown(api));   // no model to shoot: the gunship is driven off after a while
  later(api, 3, () => { api.reveal(O.GUNSHIP); api.sfx('objective'); });
}
function gunshipFly(api, dt) {
  const v = api.vars, g = v.gunship; if (!g || g.dead) return;
  v.gunAng += dt * 0.3;
  const a = v.gunAng, [cx, cy, cz] = GUNSHIP_HOME;
  g.group.position.set(cx + Math.cos(a) * 30, cy + Math.sin(a * 2) * 2, cz + Math.sin(a) * 9);
  g.group.rotation.y = -a;
}
function gunshipDown(api) { api.vars.gunship = null; api.complete(O.GUNSHIP); } // FUN_00398d20
function gateSpawners(api) {                      // FUN_003599b0: BIO done; FUN_00359a18: POWER done (DIG on easy)
  const v = api.vars;
  (api.data.spawners || []).forEach((s, i) => {
    const k = v.spawners[i]; if (k === undefined || v.opened[k]) return;
    let ok = false;
    if (s.condFn === '0x3599b0') ok = api.isDone(O.BIO) && api.playerAt(s.watch, 10);
    else if (s.condFn === '0x359a18') ok = (api.diff === 0 ? api.isDone(O.DIG) : api.isDone(O.POWER)) && api.playerAt(s.watch, 10);
    if (ok) { v.opened[k] = true; api.openSpawner(k); }
  });
}
function lockdown(api, p) {                       // FUN_003d2248: sanitation chamber scanner
  const v = api.vars;
  if (!v.sanit && api.playerAt(1450, 4)) v.sanit = true;
  if (!v.sanit || flat(p, ...CHAMBER) > 7 || Math.abs(p.y - CHAMBER[1]) > 3) return;
  const foreign = api.enemies().some(b => b.group && b.group.position.distanceTo(p) < 12);
  if (foreign && !v.locked) { v.locked = true; api.say(227, 3000); api.anim(109); for (const d of [14, 15]) { door(api, d, 'close'); door(api, d, 'lock'); } }
  else if (!foreign && v.locked) { v.locked = false; api.say(226, 3000); for (const d of [14, 15]) { door(api, d, 'unlock'); door(api, d, 'open'); } }
}

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars, d = api.data, diff = api.diff;
    v.t = 0; v.timeline = []; v.opened = {}; v.wheels = 0; v.power = diff === 0; v.engaged = false;
    v.doors = runtimeIndex(d.objects || [], diff, o => o.path);
    v.spawners = runtimeIndex(d.spawners || [], diff, s => s.char && s.char.model);
    v.files = { total: (d.props || []).filter(p => /damfilecabinet/.test(p.path) && placed(p.cond, diff)).length, done: 0 };
    v.mutants = { total: (d.spawners || []).filter((s, i) => v.spawners[i] !== undefined && isMutant(s)).length, killed: 0 };
    // FUN_00395170 shows these at once (TOP is absent on easy); POWER, BIO, GUNSHIP, MUTANTS and ESCAPE appear later.
    api.reveal(O.DISH); api.reveal(O.FILES, v.files.total); api.reveal(O.DIG); api.reveal(O.CRYSTAL); api.reveal(O.TOP);
    door(api, 6, 'close'); door(api, 7, 'close');   // FUN_00395030: both gates start shut
    if (diff === 0) door(api, 17, 'lock');          // FUN_003d2248: easy locks damdoor11 at node 1384
    door(api, 11, 'auto'); door(api, 20, 'auto');   // TODO(uncertain): type-6 doors on the route with no visible opener
    // The fixed guns on the dam are player-operated in the original; stop the runtime treating them as hostile turrets.
    api.cameras().forEach((c, i) => { if (c && /fixedgun/.test(c.rec.path)) api.killCamera(i); });
    const ap = prop(api, /apache/); if (ap) ap.group.visible = false;   // flies in when the player reaches the top
    const tv = prop(api, /dambigtelly/); if (tv) tv.hp = 200;           // the terminal: destroying it fails Restore power
    setLifts(api, v.power);
  },

  update(dt, api) {
    const v = api.vars, p = api.playerPos(); if (!p) return;
    v.t += dt;
    for (const e of v.timeline) if (!e.done && v.t >= e.at) { e.done = true; e.fn(); }
    if (v.timeline.length > 32) v.timeline = v.timeline.filter(e => !e.done);
    // Investigate the digging site: the pit under the turbine hall (FUN_003965e8 checks node 0x5f5 = 1525, not in the table).
    if (!api.isDone(O.DIG) && p.y < -15.5 && p.x > 96 && p.x < 114 && p.z > -20 && p.z < 2) {
      api.complete(O.DIG);
      api.reveal(O.BIO); // TODO(uncertain): the C shows BIO here on easy; on normal/hard it comes from an undecompiled timer
    }
    // Access the top of the dam: either tower top (nodes 0x436 / 0x447).
    if (!api.isDone(O.TOP) && (api.playerAt(1078, 6) || api.playerAt(1095, 6))) api.complete(O.TOP);
    if (!v.engaged && p.y > 40) engageGunship(api);
    // A dead lift before power is restored (normal/hard): "There is no power", and Restore power appears.
    if (!v.power) for (const n of [1071, 1097]) if (api.playerAt(n, 2.6) && (!v.liftMsg || v.t - v.liftMsg > 4)) { v.liftMsg = v.t; api.say(2297, 2500); api.reveal(O.POWER); }
    // The terminal (FUN_00395960): easy says it is inoperative, otherwise it wants the system disk.
    if (!v.power && !v.booting && flat(p, ...TERMINAL) < 2.4 && Math.abs(p.y - TERMINAL[1]) < 2.5 && (!v.termMsg || v.t - v.termMsg > 4)) {
      v.termMsg = v.t;
      if (api.diff === 0) api.say(1148, 2500); else if (!v.disk) api.say(1142, 2500); else restorePower(api);
    }
    if (!v.located && api.playerAt(1182, 4)) { v.located = true; api.say(1303, 3000); }   // FUN_00398da0: "Time Crystal located"
    if (api.diff > 0 && api.isDone(O.BIO) && !v.mutShown && (api.playerAt(1269, 5) || v.t - v.bioAt > 30)) showMutants(api);
    gateSpawners(api); mutantWave(api, p);
    lockdown(api, p);
    gunshipFly(api, dt);
    // FUN_003b1e70: once every other main objective is done the portal opens (easy node 0x55c, otherwise 0x43e).
    if (!v.portal && mainDoneExcept(api, O.ESCAPE)) {
      v.portal = true; api.reveal(O.ESCAPE);
      const n = api.diff === 0 ? 1372 : (api.node(1086) ? 1086 : 9152); // TODO(uncertain): 1086 missing -> fixed-gun node on the dam
      api.portal(api.node(n) ? n : 1372);
    }
  },

  on(event, pl, api) {
    const v = api.vars;
    if (event === 'destroyed') {
      const path = pl.path || '';
      if (/damradardish1/.test(path)) api.complete(O.DISH);                     // FUN_003965e8: dish health <= 0
      else if (/damfilecabinet/.test(path)) burnCabinet(api);
      else if (/damcage/.test(path)) destroyContainer(api);                      // id 35001: the bio-hazard container
      else if (/dampipewheel/.test(path)) steam(api);
      else if (/dambigtelly/.test(path)) { if (!api.isDone(O.POWER)) api.fail(O.POWER); } // FUN_00395ce8
      else if (/apache/.test(path)) gunshipDown(api);
    } else if (event === 'pickup') {
      const m = pl.model || '';
      if (/damdisk/.test(m)) v.disk = true;
      else if (/timecrystal/.test(m)) api.complete(O.CRYSTAL);                   // FUN_003b1db0(8)
    } else if (event === 'killed') {
      if (MUTANTS.includes(pl.classIdx)) {
        v.mutants.killed++; api.count(O.MUTANTS, v.mutants.killed);
        if (v.mutShown && v.mutants.killed >= v.mutants.total) api.complete(O.MUTANTS);
      }
    } else if (event === 'trigger') {
      if (pl.fn === '0x3953b8' && pl.kind === 4 && !v.engaged) engageGunship(api); // TODO(uncertain): callback not decompiled; dam-top volume
    } else if (event === 'portal') {
      api.win();
    }
  },
};
