// Level 40 "Return to Planet X" (2280), story mission 9. Translated from FUN_003a2918 (init),
// FUN_003a31b8 (per frame) and the helpers 0x3a3d78..0x3a5558 of SLUS_203.14.
//
// Flow: objectives 0 (Locate the crashed UFO) and 3 (Retrieve the Time Crystal) are shown at start.
// The beach attack (5) appears when the player drops onto the beach and is done when every attacker is
// dead, which disables the laser gate to the east. Reaching the crashed UFO (east, room 8) completes 0.
// Going south of z 65 reveals the raid (6), done when the player gets back to node 1477 at the base.
// Normal/hard only: using the camera console reveals Find the UFO base (2), done at node 1199 in the
// hangar; walking onto the gunpod platform reveals Shoot down the escaping UFOs (1, 15 to count), which
// opens the pod lift (doors 7/8) and the hangar door (9) when done. Both weapon parts build the homing
// launcher. The crystal completes 3; once every other main objective is done the portal is placed (4).
//
// Approximations (the api has no equivalent):
// - No flyable little UFO and no gunpod turret: objective 1 is a timed sequence while the player stays
//   seated at a gunpod chair (switch fn 0x3a4668). Objective 6 used the vehicle's z position; the player
//   on foot is used. Objective 2 appeared when viewing hangar camera X2 (39007) through the console;
//   using the console (fn 0x2a5db8) or being spotted by X2 reveals it instead.
// - The laser gate (prop 39005) and the UFO iris door (prop 39000) are static props the C animates;
//   there is no prop api, so they are hidden through api.story.props (runtime internals, guarded).
// - Skipped: frozen Mox released with the canyon doors, little-UFO respawn, nav-link patching, locking
//   the gunpod door behind the player, the rotating UFO section (object 12), ambient sound.
// - Spawner conditions 0x3d4f60 / 0x3d5010 are level hooks (kill counts, see FUN_003a4e78) and are
//   driven from here; 0x359510 / 0x3595f8 are not in the decompile and are treated as "player near".

const UFO_TOTAL = 15;                       // DAT_00518e24
const BEACH = [49, 50, 51, 52];             // spawner group ids of the beach attack (FUN_003a4f20)
const RAID = [55];                          // raid on the crashed UFO (opens on objective 6)
const AFTER_RAID = [54, 56];                // teleporter Mox and the second raid wave (DAT_00518e60)
const NEAR_COND = ['0x359510', '0x3595f8'];

const placedOn = (cond, diff) => !(cond & 0xc0000) && !!(cond & (0x80 << diff));
const near = (api, ids, r) => ids.some(id => api.playerAt(id, r));
const dist = (a, b) => Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2]);
const groupIdx = (api, ids) => (api.data.spawners || []).map((s, i) => (ids.includes(s.id) ? i : -1)).filter(i => i >= 0);
const openGroup = (api, ids) => groupIdx(api, ids).forEach(i => api.openSpawner(i));
function groupTotal(api, ids) {
  let n = 0;
  for (const s of api.data.spawners || []) if (ids.includes(s.id) && placedOn(s.cond, api.diff) && s.char) n += Math.max(1, s.total | 0);
  return n;
}
const killsOf = (v, ids) => ids.reduce((n, id) => n + (v.kills[id] || 0), 0);
const mainsDoneExcept = (api, skip) => api.data.objectives.every((o, i) => i === skip || o.cat[api.diff] !== 0 || api.isDone(i));
function removeProp(api, id) {
  // The C flips a flag on the placed prop (FUN_003a4a90 / FUN_003a4120); here it is hidden and made passable.
  try {
    const S = api.story;
    for (const p of S.props) {
      if (!p || p.dead || p.rec.id !== id) continue;
      p.dead = true; p.group.visible = false;
      S.world.solid = S.world.solid.filter(m => m.parent !== p.group);
    }
  } catch (e) { /* runtime without props: nothing to open */ }
}

function ufoDone(api) {
  const v = api.vars;
  if (v.ufoFinished) return;
  v.ufoFinished = true;
  api.complete(1);                                   // FUN_003a4f88
  api.openDoor(7);                                   // pod lift door
  api.after(3, a => a.openDoor(8));                  // pod lift hatch (DAT_00518dd0 timer)
  api.after(1, a => a.openDoor(9));                  // hangar swing door (FUN_003a4ef8, nodes 1121/1130 skipped)
}

export default {
  manualEnd: true,

  setup(api) {
    Object.assign(api.vars, { kills: {}, canyon: false, beach: 0, beachNeed: 0, raid: 0, raidNeed: 0, tele: false, parts: 0, iris: false, ufoShown: false, ufo: 0, seat: null, seatT: 0, ufoFinished: false, portal: false, opened: {} });
    // FUN_003a2918: only 0 and 3 start visible; 1, 2, 4, 5, 6 are revealed later.
    api.reveal(0);
    api.reveal(3);
  },

  update(dt, api) {
    const v = api.vars, D = api.diff, p = api.playerPos();
    // 0: Locate the crashed UFO. Node 1119 is missing from the tables; room 8 (1111/1112) is the crash site.
    if (!api.isDone(0) && near(api, [1112, 1111], 9)) api.complete(0); // TODO(uncertain): node 1119 approximated

    // Canyon doors at node 1157 (0x485): doors 0/1, then the hatches 2/3 after a pause.
    if (!v.canyon && api.playerAt(1157, 6)) {
      v.canyon = true;
      api.openDoor(0); api.openDoor(1);
      api.after(4, a => { a.openDoor(2); a.openDoor(3); });   // TODO(uncertain): fGpffffba70 delay unknown
    }

    // 5: Repel the beach attack. Node 1063 (0x427) is missing; the beach room 14 stands in for it.
    if (v.beach === 0 && near(api, [1564, 1565, 1069], 12)) {   // TODO(uncertain): node 1063 approximated
      v.beach = 1;
      api.reveal(5);                                 // FUN_003a4000
      api.anim(53);                                  // FUN_0035a168(0x35) at node 1052, nearby
      openGroup(api, BEACH);                         // condFn 0x3d4f60
      v.beachNeed = groupTotal(api, BEACH);
    }
    if (v.beach === 1 && killsOf(v, BEACH) >= v.beachNeed) {
      v.beach = 2;
      api.complete(5);                               // FUN_003a4d40
      api.after(1, a => removeProp(a, 39005));       // FUN_003a4a90: laser gate off
    }

    // 2: Find the UFO base, completed in the hangar at node 1199 (0x4af).
    if (!api.isDone(2) && api.playerAt(1199, 6)) { api.reveal(2); api.complete(2); }

    // 1: the gunpod platform box of FUN_003a51e0 reveals the escaping-UFO objective (normal/hard; absent on easy).
    if (D > 0 && !v.ufoShown && p && p.y >= 11 && p.x >= -130 && p.x <= -105 && p.z >= 100 && p.z <= 155) { // TODO(uncertain): low z bound fGpffffbac8
      v.ufoShown = true;
      api.after(3, a => a.reveal(1, UFO_TOTAL));     // FUN_003a4a38
    }
    // Manning a gunpod chair counts the UFOs down (stand-in for the turret and the UFO entities).
    if (api.isActive(1) && v.seat && p && v.ufo < UFO_TOTAL) {
      if (dist(p, v.seat) < 4) {
        v.seatT += dt;
        if (v.seatT >= 2.5) {
          v.seatT = 0; v.ufo++;
          api.count(1, v.ufo);
          api.sfx('switch');
          api.msg(`UFO SHOT DOWN  ${v.ufo}/${UFO_TOTAL}`, 1500);
          if (v.ufo >= UFO_TOTAL) ufoDone(api);
        }
      } else { v.seat = null; api.msg('RETURN TO THE GUNPOD', 2000); }
    }

    // 6: Fight off the raid on the crashed UFO. Revealed south of z 65 (the vehicle check at +0x13e0), done at node 1477 (0x5c5).
    if (v.raid === 0 && api.isDone(0) && p && p.z < 65) {
      v.raid = 1;
      api.reveal(6);
      openGroup(api, RAID);                          // condFn 0x3d5010 with DAT_00518e4c
      v.raidNeed = groupTotal(api, RAID);
    }
    if (!api.isDone(6) && api.playerAt(1477, 6)) {
      if (v.raid === 0) { v.raid = 1; api.reveal(6); }
      v.raid = 2;
      api.complete(6);
    }
    // All raiders dead (DAT_00518e60): the teleporter hatch and door open and more Mox come through it.
    if (!v.tele && v.raidNeed > 0 && killsOf(v, RAID) >= v.raidNeed) {
      v.tele = true;
      api.openDoor(14);
      api.after(3, a => { a.openDoor(13); openGroup(a, AFTER_RAID); });   // FUN_003a3d78, FUN_003a4e78
    }

    // Iris door of the mothership (FUN_003a4120 at node 1220): opens when the player is under the UFO.
    if (!v.iris && near(api, [1220, 1224], 8)) { v.iris = true; removeProp(api, 39000); api.sfx('door'); }

    // Spawners whose condition code is not in the decompile: open when the player is near the watched node.
    (api.data.spawners || []).forEach((s, i) => {
      if (v.opened[i] || !NEAR_COND.includes(s.condFn) || !placedOn(s.cond, D)) return;
      const ok = api.node(s.watch) ? api.playerAt(s.watch, 8) : api.playerAt(s.node, 14);   // TODO(uncertain)
      if (ok) { v.opened[i] = true; api.openSpawner(i); }
    });

    // 4: the time portal (FUN_003b1e70) once everything but the escape is done.
    if (!v.portal && api.isDone(3) && mainsDoneExcept(api, 4)) {
      v.portal = true;
      api.reveal(4);
      const node = D === 0 ? 1500 : 1596;   // TODO(uncertain): C uses 1497 (easy) / 1593 (normal, hard), both missing from the tables
      if (api.node(node)) { api.portal(node); api.say(Math.random() < 0.5 ? 1301 : 1302); }
      else api.win();
    }
  },

  on(event, payload, api) {
    const v = api.vars;
    if (event === 'killed') {
      const s = payload.spawner >= 0 ? (api.data.spawners || [])[payload.spawner] : null;
      if (s) v.kills[s.id] = (v.kills[s.id] || 0) + 1;
    } else if (event === 'pickup') {
      if (/timecrystal/i.test(payload.model || '')) { api.complete(3); api.say(1303); }      // FUN_003b1db0, FUN_003b1d20
      else if (/pxhrocketpart/i.test(payload.model || '')) {
        v.parts++;
        if (v.parts >= 2) { api.give('homingrocketlauncher'); api.msg(`${api.text(1602).toUpperCase()} ASSEMBLED`, 2500); }   // FUN_002abac0(0,2,0x14)
        else api.msg(`${api.text(1653).toUpperCase()}  1/2`, 2000);
      }
    } else if (event === 'use') {
      if (payload.fn === '0x3a4668') {              // gunpod chair
        if (api.isActive(1) && !api.isDone(1)) {
          const sw = (api.data.interact || [])[payload.index];
          v.seat = sw ? sw.pos : null; v.seatT = 0;
          api.msg(`${api.text(sw && sw.w11 === 39002 ? 2394 : 2393).toUpperCase()} ONLINE`, 2000);
        } else api.msg('NO TARGETS', 1500);
      } else if (payload.fn === '0x2a5db8') api.reveal(2);   // camera console: hangar seen through camera X2
    } else if (event === 'seen') {
      if (payload.camera && payload.camera.rec && payload.camera.rec.id === 39007) api.reveal(2);
    } else if (event === 'portal') {
      api.complete(4);
      api.win();
    }
  },
};
