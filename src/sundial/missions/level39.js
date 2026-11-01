// Level 39 "Spacestation" (2401) — mission 10, the story finale. Sgt Cortez arms the station's self
// destruct, shoots down the incoming TimeSplitter ships from the fixed gun, then races down to the
// marine ship on the bottom deck before the countdown ends.
// Translated from SLUS_203.14 FUN_0039dd10 (init), FUN_003a0c18 (frame), FUN_0039de18 (consoles),
// FUN_003a0060/FUN_003a0020 (ships), FUN_003a07a8 (escape box), FUN_003a0f80 (airlock).
//
// Approximations where the api has no equivalent:
//  - Consoles are props, so no 'use' event fires: a console activates when the player stands at it
//    for ~1 s (or shoots it to pieces). The other consoles print the original "inoperative" lines.
//  - There are no shootable TimeSplitter ships: while the player mans the fixed gun (node 9003) one
//    ship is "shot down" every ~2 s until 20 are gone. The original spawns 7 waves of ship entities.
//  - The escape zone is an axis box on the bottom deck (y <= 8.5); here it is node 1274 (lower lift,
//    next to the marine ship) with a 7 m radius, plus a portal marker once everything else is done.
//  - The runtime keeps type-6 doors locked, so the ring doors and the two-door airlock are opened by
//    proximity from here. Spawner conditions 0x359900 (near watch node, only after the ships are down)
//    and 0x359510 (unknown; treated as "player within 10 m of the watch node") are handled here too.

const OBJ = { DESTRUCT: 0, SHIPS: 1, ESCAPE: 2, CRYSTAL: 3 };
const CONSOLE_IDS = [39000, 39001, 39002];        // the three self destruct consoles (upper deck)
const ALREADY_ACTIVE_IDS = [39003, 39004, 39005, 39006]; // say "Self Destruct is already active"
const CONSOLES_NEEDED = 3;
const SHIPS_NEEDED = 20;                          // DAT_01fb383c = 0x14
const COUNTDOWN = [600, 360, 300];                // FUN_0039dcc8: easy / normal / hard, seconds
const MARKS = [600, 300, 240, 180, 120, 60, 30, 20, 10, 5, 4, 3, 2, 1];
const GUN_NODE = 9003;                            // ssfixedgun animObject
const ESCAPE_NODE = 1274;                         // bottom deck, by the marine ship
const HUB_NODE = 1194;                            // middle deck hub
const RING_DOORS = [6, 7, 8, 9, 10, 11, 16];      // type-6 corridor doors (object ids)
const DOOR_UNLOCK_AFTER_CONSOLES = 4;
const DOORS_AFTER_SHIPS = [14, 15];
const AIRLOCK_INNER = 12, AIRLOCK_OUTER = 13;

// Same placement rule as story.js so we can map table ids to runtime indices.
function placed(cond, diff) { if (cond & 0xc0000) return false; return !!(cond & (0x80 << diff)); }
function doorIdx(api, id) {
  const live = (api.data.objects || []).filter(o => placed(o.cond, api.diff) && o.path);
  return live.findIndex(o => o.id === id);
}
function liveSpawners(api) {
  return (api.data.spawners || []).filter(s => placed(s.cond, api.diff) && s.char && s.char.model);
}
function dist2d(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
function fmt(sec) { const s = Math.max(0, Math.ceil(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function activateConsole(api, id) {
  const v = api.vars;
  if (v.used.has(id)) return;
  v.used.add(id);
  const left = CONSOLES_NEEDED - v.used.size;
  api.count(OBJ.DESTRUCT, v.used.size);
  api.sfx('switch');
  if (left > 0) { api.msg(`${left} ${api.text(left === 1 ? 1243 : 1242)}`.toUpperCase(), 3000); return; }
  // Third console: objective done, door 4 unlocks, the countdown starts (FUN_0039de18 tail).
  api.complete(OBJ.DESTRUCT);
  const d4 = doorIdx(api, DOOR_UNLOCK_AFTER_CONSOLES);
  if (d4 >= 0) api.lockDoor(d4, false);
  v.timer = COUNTDOWN[api.diff] || COUNTDOWN[1];
  v.nextMark = MARKS.filter(m => m < v.timer);
  api.after(1, () => api.msg(`${api.text(1280)}  ·  ${fmt(v.timer)}`.toUpperCase(), 4000)); // "Self Destruct Sequence in Progress"
}

function shipsDone(api) {
  api.complete(OBJ.SHIPS);
  // FUN_003a0060 -> 1 s later FUN_003a0020: unlock doors 14 and 15 and open the way into the hub.
  api.after(1, () => {
    for (const id of DOORS_AFTER_SHIPS) { const i = doorIdx(api, id); if (i >= 0) { api.lockDoor(i, false); api.openDoor(i); } }
    api.msg('DOCKING BAY SECURED - THE CENTRAL HUB IS OPEN', 3500);
  });
}

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars;
    v.used = new Set(); v.dwell = {}; v.hint = {}; v.timer = null; v.nextMark = [];
    v.ships = 0; v.shipCool = 0; v.suit = false; v.airlock = 'idle'; v.doorCool = {}; v.opened = new Set();
    v.portal = false; v.consoles = []; v.t = 0;
    for (const p of api.data.props || []) {
      if (!placed(p.cond, api.diff) || !/ssconsole\.raw$/.test(p.path || '')) continue;
      v.consoles.push({ id: p.id, pos: { x: p.pos[0], y: p.pos[1], z: p.pos[2] } });
    }
    // FUN_0039dd10: reveal 3, 0, 1 then hide 1 and reveal 2 -> crystals, self destruct and escape are
    // shown from the start; the ships objective appears when the player reaches the docking bay.
    api.reveal(OBJ.CRYSTAL);
    api.reveal(OBJ.DESTRUCT, CONSOLES_NEEDED);
    api.reveal(OBJ.ESCAPE);
    for (const id of [DOOR_UNLOCK_AFTER_CONSOLES, ...DOORS_AFTER_SHIPS]) { const i = doorIdx(api, id); if (i >= 0) api.lockDoor(i, true); }
  },

  update(dt, api) {
    const v = api.vars;
    const p = api.playerPos();
    if (!p) return;
    v.t += dt;

    // --- self destruct consoles (stand at one for ~1 s) ---
    for (const c of v.consoles) {
      const near = dist2d(p, c.pos) < 1.7 && Math.abs(p.y - c.pos.y) < 2.5;
      const key = c.id + ':' + c.pos.x.toFixed(1) + ':' + c.pos.z.toFixed(1);
      if (!near) { v.dwell[key] = 0; continue; }
      v.dwell[key] = (v.dwell[key] || 0) + dt;
      if (v.dwell[key] < 0.9) continue;
      if (CONSOLE_IDS.includes(c.id)) { if (!v.used.has(c.id)) activateConsole(api, c.id); }
      else if (!v.hint[key] || v.t - v.hint[key] > 6) {
        v.hint[key] = v.t;
        api.say(ALREADY_ACTIVE_IDS.includes(c.id) ? 1245 : 1244, 2500); // "already active" / "inoperative"
      }
    }

    // --- countdown (runs once objective 0 is done) ---
    if (v.timer !== null && !api.isDone(OBJ.ESCAPE)) {
      v.timer -= dt;
      while (v.nextMark.length && v.timer <= v.nextMark[0]) {
        const m = v.nextMark.shift();
        api.msg(`${api.text(1281)} ${fmt(m)}`.toUpperCase(), m <= 10 ? 900 : 3000); // "Self Destruct in..."
        if (m <= 10) api.sfx('switch');
      }
      if (v.timer <= 0) { v.timer = null; api.fail(OBJ.ESCAPE); api.lose('THE SPACESTATION SELF DESTRUCTED WITH YOU ON BOARD'); return; }
    }

    // --- ships objective: appears at the docking bay (node 1158 in the C, between 1157 and 1159) ---
    if (!api.isActive(OBJ.SHIPS) && !api.isDone(OBJ.SHIPS)) {
      const a = api.node(1157), b = api.node(1159);
      const mid = a && b ? { x: (a.pos.x + b.pos.x) / 2, y: a.pos.y, z: (a.pos.z + b.pos.z) / 2 } : null;
      if ((mid && dist2d(p, mid) < 5 && Math.abs(p.y - mid.y) < 3) || api.playerAt(GUN_NODE, 8)) {
        api.reveal(OBJ.SHIPS, SHIPS_NEEDED);
        api.after(3.5, () => api.msg('MAN THE FIXED GUN IN THE DOCKING BAY', 3500));
      }
    }
    if (api.isActive(OBJ.SHIPS) && !api.isDone(OBJ.SHIPS) && api.playerAt(GUN_NODE, 4.5)) {
      v.shipCool -= dt;
      if (v.shipCool <= 0) {
        v.ships++; v.shipCool = 1.6 + Math.random() * 1.2;
        api.count(OBJ.SHIPS, v.ships);
        api.sfx('switch');
        if (v.ships % 5 === 0 && v.ships < SHIPS_NEEDED) api.msg(`${SHIPS_NEEDED - v.ships} SHIPS LEFT`, 1500);
        if (v.ships >= SHIPS_NEEDED) shipsDone(api);
      }
    }

    // --- ring doors (type 6, kept locked by the runtime) open on approach ---
    const objs = (api.data.objects || []).filter(o => placed(o.cond, api.diff) && o.path);
    objs.forEach((o, i) => {
      if (!RING_DOORS.includes(o.id)) return;
      v.doorCool[o.id] = (v.doorCool[o.id] || 0) - dt;
      if (v.doorCool[o.id] > 0) return;
      const dpos = { x: o.pos[0], y: o.pos[1], z: o.pos[2] };
      if (dist2d(p, dpos) < 3 && Math.abs(p.y - dpos.y) < 3) { api.openDoor(i); v.doorCool[o.id] = 3; }
    });

    // --- airlock (FUN_003a0f80): inner door on approach, outer door after a 5 s cycle ---
    const inner = objs.find(o => o.id === AIRLOCK_INNER), outer = objs.find(o => o.id === AIRLOCK_OUTER);
    if (inner && outer) {
      const ip = { x: inner.pos[0], y: inner.pos[1], z: inner.pos[2] }, op = { x: outer.pos[0], y: outer.pos[1], z: outer.pos[2] };
      const onDeck = Math.abs(p.y - ip.y) < 3;
      v.doorCool.inner = (v.doorCool.inner || 0) - dt;
      if (onDeck && dist2d(p, ip) < 2.8 && v.doorCool.inner <= 0) { api.openDoor(objs.indexOf(inner)); v.doorCool.inner = 3; }
      if (onDeck && dist2d(p, op) < 2.8 && dist2d(p, ip) > 3.5) {
        if (v.airlock === 'idle') {
          v.airlock = 'cycling';
          api.msg(v.suit ? 'AIRLOCK CYCLING' : `AIRLOCK CYCLING - NO ${api.text(1654).toUpperCase()}!`, 3000);
          api.after(5, () => { v.airlock = 'open'; api.openDoor(objs.indexOf(outer)); api.sfx('door'); });
        } else if (v.airlock === 'open') {
          v.doorCool.outer = (v.doorCool.outer || 0) - dt;
          if (v.doorCool.outer <= 0) { api.openDoor(objs.indexOf(outer)); v.doorCool.outer = 3; }
        }
      } else if (v.airlock === 'open' && dist2d(p, op) > 6) v.airlock = 'idle';
      // Outside the hull without the environment suit: the C applies a suffocation effect (FUN_002a8a58).
      if (!v.suit && onDeck && p.z > op.z + 1.5 && dist2d(p, op) > 2) {
        v.doorCool.suit = (v.doorCool.suit || 0) - dt;
        if (v.doorCool.suit <= 0) { v.doorCool.suit = 5; api.msg(`YOU NEED THE ${api.text(1654).toUpperCase()} TO SURVIVE OUT HERE`, 3000); }
      }
    }

    // --- spawner conditions the runtime leaves to the script ---
    liveSpawners(api).forEach((s, i) => {
      if (v.opened.has(i)) return;
      const nd = api.node(s.watch); if (!nd) return;
      const near = r => dist2d(p, nd.pos) < r && Math.abs(p.y - nd.pos.y) < 4;
      if (s.condFn === '0x359900' && api.isDone(OBJ.SHIPS) && near(5)) { api.openSpawner(i); v.opened.add(i); }
      // TODO(uncertain): 0x359510 is not in the decompile; the start-area and hub spawners use it.
      else if (s.condFn === '0x359510' && near(10)) { api.openSpawner(i); v.opened.add(i); }
    });

    // --- escape: bottom deck by the marine ship (FUN_003a07a8 box, y <= 8.5), crystal in hand ---
    const allButEscape = api.isDone(OBJ.DESTRUCT) && api.isDone(OBJ.SHIPS) && api.isDone(OBJ.CRYSTAL);
    if (allButEscape && !v.portal) { v.portal = true; api.portal(ESCAPE_NODE); }
    const esc = api.node(ESCAPE_NODE);
    if (esc && api.isDone(OBJ.CRYSTAL) && !api.isDone(OBJ.ESCAPE) && p.y < 8.5 && dist2d(p, esc.pos) < 7) {
      api.complete(OBJ.ESCAPE);
      if (allButEscape) api.after(1.5, () => api.win());
      else api.msg('THE SHIP IS READY - FINISH THE REMAINING OBJECTIVES', 3500);
    }
    if (api.isDone(OBJ.ESCAPE) && allButEscape && !v.winning) { v.winning = true; api.after(1.5, () => api.win()); }
  },

  on(event, payload, api) {
    const v = api.vars;
    if (event === 'pickup') {
      const m = payload.model || '';
      if (/timecrystal/i.test(m)) { api.complete(OBJ.CRYSTAL); api.msg(`${api.text(1651)} RECOVERED`.toUpperCase(), 2500); } // FUN_003a2098
      else if (/ssenvsuit/i.test(m)) { v.suit = true; api.msg(`${api.text(1654)} EQUIPPED`.toUpperCase(), 2500); }
    } else if (event === 'destroyed') {
      // Shooting a self destruct console counts as activating it (keeps the mission completable).
      const id = payload.prop && payload.prop.rec ? payload.prop.rec.id : -1;
      if (CONSOLE_IDS.includes(id)) activateConsole(api, id);
    } else if (event === 'portal') {
      api.complete(OBJ.ESCAPE);
      api.win();
    }
  },
};
