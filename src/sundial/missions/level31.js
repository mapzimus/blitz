// Level 31 "Atom Smasher" (Khallos Island, 1972) - Harry Tipper. Story mission 7.
// Translated from SLUS_203.14 FUN_00383a78 (init), FUN_00385a48 (per frame), FUN_0038bbc8 (entity hooks),
// FUN_00386ea8 (defuse), FUN_00387428 (bomb timer), FUN_0038b558 (reactor), FUN_0038b808 (kill counts).
//
// Approximations where the api has no equivalent (all noted inline):
//  - "Using" a prop (bomb, reactor handle) has no event: standing next to it for a moment counts as using it.
//  - The crystal Khallos drops cannot be placed as a pickup: walking over the spot where he died collects it.
//  - Fires blocking the two big doors cannot burn or be sprayed: the fire alarm (sprinklers) unlocks them,
//    or lingering at the door with the extinguisher nearby counts as putting the fire out.
//  - The laser table / fuse box puzzle that opens the start-room door becomes "destroy the fuse box".
//  - Spawners whose condition function the runtime does not know (0x3d4ea0 Khallos, 0x359e68/0x359588
//    splitters) are retired through api.story so the alarm cannot open them; the script spawns them itself.
//  - No self-destruct timer exists in the decompile; the brief asks for one, so a short one runs after the portal opens.

const BOMB_TIME = [180, 150, 120];        // FUN_0038b9e8: 10800 / 9000 / 7200 frames at 60 Hz
const BOMB_BONUS = [150, 120, 90];        // FUN_0038ba18: time added per defused bomb
const ESCAPE_TIME = [120, 90, 60];        // TODO(uncertain): not in the C, see header
const BOMB_IDS = [31005, 31006, 31007, 31008, 31009];
const CRANE_BOMB = 31009;                 // the bomb on the trolley under the crane
const FUSE_BOX = 31018;
const DOOR_START = 12, DOOR_FIRE_A = 7, DOOR_FIRE_B = 9, DOOR_ROT_A = 13, DOOR_ROT_B = 14;
const SW_ROT_A = 101, SW_ROT_B = 104, SW_ALARM = [108, 109], SW_CRANE = 110;
const CLS_HENCH = 1, CLS_SCIENTIST = 2, CLS_KHALLOS = 3, CLS_REAPER = 4, CLS_SCOURGE = 6;
const KHALLOS_NODE = 1079;                // spawner 83's node (room 6, on the way to the reactor)
const PORTAL_NODE = 1358;                 // TODO(uncertain): the C uses node 1339 which is not in the table; room 8 (reactor hall) instead
const SPLITTER_NODES = [1093, 1097];      // spawners 84/85 sit at 1093/1337; keep them off the portal
const REAPER_NODE = 1335;                 // spawner 86
const BOMB_CALLS = { 300: 1203, 240: 1204, 180: 1205, 120: 1206, 60: 1207, 30: 1208, 20: 1209, 10: 1210 };
const BOOM_CALLS = { 120: 1287, 60: 1288, 30: 1289, 20: 1290, 10: 1291 };

const placed = (cond, diff) => !(cond & 0xc0000) && !!(cond & (0x80 << diff));
const near = (a, b, r, dy = 2.2) => { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz < r * r && Math.abs(a.y - b.y) < dy; };
const clock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const retire = (api, i) => { const s = api.story && api.story.spawners && api.story.spawners[i]; if (s) s.done = true; };
const spawnAt = (api, cls, node, opts) => { try { return api.spawn(cls, node, opts); } catch (e) { return null; } };

function countdown(api, v, key, calls, label) {
  // Spoken-style HUD countdown: a line at each threshold, every 10 s above a minute, every second under 30 s.
  const prev = v[key + 'Prev'] === undefined ? Infinity : v[key + 'Prev'];
  const t = v[key];
  v[key + 'Prev'] = t;
  const hit = Object.keys(calls).find(th => prev > th && t <= th);
  if (hit) return api.msg(`${label} ${api.text(calls[hit]).toUpperCase()}`, 2500);
  const step = t < 30 ? 1 : t < 60 ? 5 : 10;
  if (Math.floor(prev / step) !== Math.floor(t / step)) api.msg(`${api.text(1121).toUpperCase()} ${clock(t)}`, step === 1 ? 900 : 1800);
}

function defuse(api, b) {
  const v = api.vars;
  b.done = true; v.defused++;
  v.bombT += BOMB_BONUS[api.diff];
  api.sfx('switch');
  api.count(1, v.defused);
  const left = v.bombs.length - v.defused;
  if (left > 0) api.msg(`${left} ${api.text(left === 1 ? 1120 : 1119).toUpperCase()}`, 3000);
  else { api.complete(1); v.bombRunning = false; openKhallos(api); }
}

function openKhallos(api) {
  // Spawner 83's condition (0x3d4ea0) is not in the decompile. TODO(uncertain): Khallos shows up once the bombs are dealt with.
  const v = api.vars;
  if (v.khallos) return;
  v.khallos = spawnAt(api, CLS_KHALLOS, KHALLOS_NODE, { hp: 420 + api.diff * 180, weapon: 'ak47', skill: 1.4 + api.diff * 0.3 }) || true;
  api.msg(`${api.text(186).toUpperCase()} IS HEADING FOR THE REACTOR`, 3500);
}

function tryPortal(api) {
  const v = api.vars;
  if (v.portal || !(api.isDone(0) && api.isDone(1) && api.isDone(2) && api.isDone(5))) return;
  v.portal = true;
  if (api.isActive(4)) api.complete(4);                    // casualties kept under three: the secondary stands
  api.reveal(3);                                           // FUN_003b1e70: re-show "Escape" once the rest is done
  api.portal(PORTAL_NODE);
  api.say(1302, 3500);                                     // "The Time Portal has been stabilized"
  v.escapeT = ESCAPE_TIME[api.diff];
  api.after(3.6, a => a.say(1280, 3000));                  // "Self Destruct Sequence in Progress"
}

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars, d = api.data;
    // FUN_00383a78: objectives 0,1,2,4,5 shown at once; 3 (escape) stays hidden until the portal exists.
    v.bombs = (d.props || []).filter(p => BOMB_IDS.includes(p.id) && placed(p.cond, api.diff)).map(p => ({ id: p.id, pos: { x: p.pos[0], y: p.pos[1], z: p.pos[2] }, done: false, dwell: 0 }));
    v.handles = (d.props || []).filter(p => /atom_bigswitch_hdl/.test(p.path || '') && placed(p.cond, api.diff)).map(p => ({ pos: { x: p.pos[0], y: p.pos[1], z: p.pos[2] }, done: false, dwell: 0 }));
    v.defused = 0; v.pulled = 0; v.sci = 0;
    v.bombT = BOMB_TIME[api.diff]; v.bombRunning = true;
    v.fireDwell = { [DOOR_FIRE_A]: 0, [DOOR_FIRE_B]: 0 };
    api.reveal(0);
    api.reveal(1, v.bombs.length);
    api.reveal(2);
    api.reveal(4, 3);                                      // FUN_0038b9e0: three dead scientists fail it
    api.reveal(5);
    // Start room: the door only opens once the laser hits the fuse box (FUN_00389b98 -> FUN_00389638).
    api.lockDoor(DOOR_START, true);
    // Big doors 7 and 9 are blocked by fires until they are put out (DAT_004f6948 / DAT_004f6940 in FUN_00385a48).
    api.lockDoor(DOOR_FIRE_A, true); api.lockDoor(DOOR_FIRE_B, true);
    // Script-driven spawners (see header).
    [83, 84, 85, 86].forEach(i => retire(api, i));
    api.after(2.5, a => a.msg(`${a.text(1121).toUpperCase()} ${clock(v.bombT)}`, 3000));
    api.after(6, a => a.msg('CUT THE LASER: DESTROY THE FUSE BOX', 3000));
  },

  update(dt, api) {
    const v = api.vars, pp = api.playerPos();
    if (!pp) return;
    // Bomb timer (FUN_00387428): runs from the first frame, each defuse adds time, zero with bombs left = failure.
    if (v.bombRunning && !api.isDone(1)) {
      v.bombT -= dt;
      countdown(api, v, 'bombT', BOMB_CALLS, api.text(1199).toUpperCase());
      if (v.bombT <= 0) { v.bombRunning = false; api.msg('THE BOMBS DETONATED', 3000); api.fail(1); return; }
      for (const b of v.bombs) {
        if (b.done) continue;
        if (near(pp, b.pos, 1.7)) {
          if (b.id === CRANE_BOMB && !v.crane) { if (!b.warned || api.story.time - b.warned > 3) { b.warned = api.story.time; api.say(1118, 2000); } continue; } // TODO(uncertain): FUN_00386ea8 refuses while the player "holds" something; read as: lower the trolley with the crane first
          b.dwell += dt;
          if (b.dwell > 1.5) defuse(api, b);
          else if (!b.hint || api.story.time - b.hint > 2) { b.hint = api.story.time; api.msg('DEFUSING...', 900); }
        } else b.dwell = Math.max(0, b.dwell - dt * 2);
      }
    }
    // Reactor: pull every big switch handle (FUN_0038b558 counts them; only three exist in the table).
    if (!api.isDone(0)) for (const h of v.handles) {
      if (h.done) continue;
      if (near(pp, h.pos, 1.8, 2.6)) {
        h.dwell += dt;
        if (h.dwell > 1.2) { h.done = true; v.pulled++; api.sfx('switch'); api.msg(`REACTOR SWITCH ${v.pulled}/${v.handles.length}`, 2000); if (v.pulled >= v.handles.length) { api.complete(0); tryPortal(api); } }
      } else h.dwell = 0;
    }
    // Fire doors: lingering by the blaze (extinguishers are placed right there) counts as putting it out.
    for (const i of [DOOR_FIRE_A, DOOR_FIRE_B]) {
      const dr = api.story.doors && api.story.doors[i];
      if (!dr || !dr.locked) continue;
      if (near(pp, dr.pos, 5, 3)) { v.fireDwell[i] += dt; if (v.fireDwell[i] > 3) { api.lockDoor(i, false); api.msg('FIRE EXTINGUISHED', 2000); api.sfx('door'); } }
      else v.fireDwell[i] = 0;
    }
    // The crystal Khallos dropped.
    if (v.crystal && !api.isDone(2) && near(pp, v.crystal, 1.4, 2)) {
      v.crystal = null;
      api.complete(2);
      api.say(2406, 3000);                                 // "Crystal Recovered"
      spawnAt(api, CLS_REAPER, REAPER_NODE, { hp: 160, weapon: 'plasmamachinegun' }); // TODO(uncertain): spawner 86 (0x359588) read as "crystal taken"
      tryPortal(api);
    }
    // Escape timer after the portal opens (see header).
    if (v.portal && v.escapeT !== undefined && !api.story.over) {
      v.escapeT -= dt;
      countdown(api, v, 'escapeT', BOOM_CALLS, api.text(1281).toUpperCase());
      if (v.escapeT <= 0) { v.escapeT = undefined; api.lose('KHALLOS ISLAND WAS DESTROYED'); }
    }
  },

  on(event, p, api) {
    const v = api.vars;
    if (event === 'use') {
      if (p.id === SW_ROT_A) {                             // FUN_00385f58: button 101 opens rotating door 13
        api.openDoor(DOOR_ROT_A); api.lockDoor(DOOR_ROT_A, false);
        if (api.diff > 0 && !v.security) {                 // FUN_0038a258: "security measures" on normal/hard
          v.security = true; api.say(1229, 3000);
          api.after(1.5, a => { spawnAt(a, CLS_HENCH, 1288, { weapon: 'ak47' }); spawnAt(a, CLS_HENCH, 1295, { weapon: 'ak47' }); });
        }
      } else if (p.id === SW_ROT_B) { api.openDoor(DOOR_ROT_B); api.lockDoor(DOOR_ROT_B, false); }
      else if (SW_ALARM.includes(p.id)) {                  // FUN_00388350: sprinklers put the fires out
        if (!v.sprinklers) { v.sprinklers = true; api.alarm(true); api.msg('SPRINKLERS ACTIVATED', 2500); api.lockDoor(DOOR_FIRE_A, false); api.lockDoor(DOOR_FIRE_B, false); }
      } else if (p.id === SW_CRANE) {                      // FUN_0038a210: crane lowers the bomb trolley
        if (!v.crane) { v.crane = true; api.say(1167, 2500); }
      }
    } else if (event === 'destroyed') {
      const id = p.prop && p.prop.rec ? p.prop.rec.id : p.id;
      if (id === FUSE_BOX) {                               // FUN_00389638: start-room door
        api.lockDoor(DOOR_START, false); api.openDoor(DOOR_START); api.msg('LASER OFFLINE - DOOR UNLOCKED', 2500);
      } else if (BOMB_IDS.includes(id)) {                  // FUN_00387188: a shot bomb goes off -> timer dead -> fail
        const b = v.bombs.find(x => x.id === id);
        if (b && !b.done) { v.bombRunning = false; api.msg('THE BOMB EXPLODED', 3000); api.fail(1); }
      }
    } else if (event === 'killed') {
      if (p.classIdx === CLS_SCIENTIST) {                  // FUN_0038b808: scientist casualties
        v.sci++; api.count(4, v.sci); api.msg(`SCIENTIST KILLED ${v.sci}/3`, 2500);
        if (v.sci >= 3) api.fail(4);
      } else if (p.classIdx === CLS_KHALLOS && !api.isDone(5)) {
        api.complete(5);
        const g = p.bot && p.bot.group; const n = api.node(KHALLOS_NODE);
        v.crystal = g ? { x: g.position.x, y: g.position.y, z: g.position.z } : n ? { x: n.pos.x, y: n.pos.y, z: n.pos.z } : null;
        api.say(1303, 3500);                               // FUN_0038b8f0: "Time Crystal located"
        api.after(2, a => SPLITTER_NODES.forEach(nd => spawnAt(a, CLS_SCOURGE, nd, { hp: 120, weapon: 'plasmamachinegun' }))); // spawners 84/85 open on objective 5 (0x359e68)
        tryPortal(api);
      }
    } else if (event === 'seen') {
      if (!v.spotted) { v.spotted = true; api.alarm(true); api.msg(`SPOTTED BY ${(p.name || 'CAMERA').toUpperCase()}`, 2500); }
    } else if (event === 'portal') {
      api.complete(3); api.win();
    }
  },
};
