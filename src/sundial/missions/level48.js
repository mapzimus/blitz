// Level 48 "Aztec Ruins" (Guatemala 1920), story mission 6, Captain Ash. Translated from SLUS_203.14:
// init FUN_003abad8, update FUN_003abb00, event FUN_003abc80 and the helpers after them (FUN_003abed0 pillar
// puzzle, FUN_003ac430/FUN_003ac3f8 waterfall crank -> stakes -> jungle door, FUN_003ac610 falling logs,
// FUN_003af0f8 lever, FUN_003b0820 golem kills, FUN_003ad4d0 tongue/crystal, FUN_003b1db0 crystal held,
// FUN_003b1e70 portal placement). Hook 0x3d21e0 only drops a nav link and is ignored.
//
// Approximations, because the api cannot do what the original does:
//  - The time crystal is a runtime pickup in the original (on the stone face's tongue, nodes 9032/9033, not in
//    the node table). Here "Retrieve the Time Crystal" completes when the player reaches the tongue (node 1316).
//  - The six jungle pillars are rotated 90 degrees per hit until all face forward (normal/hard). The runtime only
//    reports a prop shot to pieces, so each pillar counts when destroyed; all down -> rolling door (object 3)
//    unlocks. On easy the pillars start aligned and the door is open from the start, as in the original.
//  - The waterfall crank (prop 13) is not shootable through the api, so it is "used" by standing next to it.
//    Its chain: logs drop (arms the High Priest ambushes, condFn 0x3d52d0), stakes rise, jungle door (object 0)
//    opens 4 s later.
//  - Nav nodes missing from the table: 1133 (temple found) -> 1131/1135, 1127 (crystal located) -> 1128,
//    1169 (golem objective) -> 1166/1405, 1337 (normal/hard portal) -> 1386, 0x3d5288 pit ambush -> node 1314.
//  - Pit door trap, spear traps, rolling boulder and the Maiden spawners (condFn 0x359b70/0x359e68, would be
//    hostile bots) are left to the runtime or skipped.
// Objectives: 0 find the lost temple, 1 retrieve the time crystal, 2 escape through the portal (hidden until the
// portal appears), 3 defeat the golems (counted; hidden until the trapdoor room). All are main on every difficulty.
// Classes (data.classes): 1 Stone Golem, 2 Wood Golem (the objective's golems, spawner ids 30 room / 31 gold),
// 4 High Priest, 5 Mister Giggles, 6 Maiden.

const OBJ = { TEMPLE: 0, CRYSTAL: 1, PORTAL: 2, GOLEMS: 3 };
const DOOR = { JUNGLE: 0, PIT: 1, PAINTED: 2, ROLLING: 3, STAKES: [4, 5, 6], GOLD: 7, TEMPLE: 18 };
const WOOD_GOLEM = 2;
const LEVER = 301;                          // interact[0], fn 0x3af0f8 -> opens the painted door (w11 = 2)
const CRANK_POS = [83.8, 10.827, 35.53];    // props id 13 aztecfallscrank
const GOLD_DOOR_NODE = 1386;                // FUN_003abc80: player at node 0x56a opens object 7
const PORTAL_NODE = [1293, 1337, 1337];     // FUN_003abc80: 0x50d easy, 0x539 normal/hard
const PORTAL_FALLBACK = 1386;               // TODO(uncertain): 1337 is not in the node table; corridor before the gold room
const PIT_AMBUSH_FN = '0x3d5288';           // Mister Giggles + High Priest in the pit (function not decompiled)
const PRIEST_AMBUSH_FN = '0x3d52d0';        // High Priests that wake once the logs have fallen (FUN_003b08e8) and the player is near

const placed = (cond, diff) => !(cond & 0xc0000) && !!(cond & (0x80 << diff));

// JSON spawner index -> runtime spawner index (the runtime only keeps the spawners placed on this difficulty).
function mapSpawners(api) {
  const map = {}; let k = 0;
  (api.data.spawners || []).forEach((s, j) => { if (placed(s.cond, api.diff) && s.char && s.char.model) map[j] = k++; });
  return map;
}
function dist(p, xyz) { return Math.hypot(p.x - xyz[0], p.y - xyz[1], p.z - xyz[2]); }

function showGolems(api) {
  const v = api.vars;
  if (v.golemShown) return;
  v.golemShown = true; v.golemShownAt = v.t;
  api.reveal(OBJ.GOLEMS, v.golemNeed);
  api.count(OBJ.GOLEMS, v.golemKills);
  // The trapdoor-room golems (spawner id 30) open on proximity to node 1164 in the tables; make sure they come.
  for (const j of v.roomGolemSpawners) api.openSpawner(v.map[j]);
}

function placePortal(api) {
  const v = api.vars;
  if (v.portalPlaced) return;
  v.portalPlaced = true;
  api.reveal(OBJ.PORTAL);
  api.say(Math.random() < 0.5 ? 1301 : 1302);          // "Time Portal stabilized" / "The Time Portal has been stabilized"
  const want = PORTAL_NODE[api.diff] || PORTAL_NODE[0];
  const node = api.node(want) ? want : (api.node(PORTAL_FALLBACK) ? PORTAL_FALLBACK : null);
  if (node !== null) api.portal(node);
  else api.after(2, a => { a.complete(OBJ.PORTAL); a.win(); }); // no node fits: end the mission anyway
}

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars, d = api.data;
    v.t = 0;
    v.map = mapSpawners(api);
    const sp = d.spawners || [];
    v.roomGolemSpawners = []; v.goldGolemSpawners = []; v.priestSpawners = []; v.pitSpawners = [];
    sp.forEach((s, j) => {
      if (!(j in v.map)) return;
      if (s.classIdx === WOOD_GOLEM) (s.id === 31 ? v.goldGolemSpawners : v.roomGolemSpawners).push(j);
      if (s.condFn === PRIEST_AMBUSH_FN) v.priestSpawners.push(j);
      if (s.condFn === PIT_AMBUSH_FN) v.pitSpawners.push(j);
    });
    // FUN_003abb00: golems to kill = category 0x1e (room) on easy, 0x1e + 0x1f (room + gold) otherwise.
    v.golemNeed = v.roomGolemSpawners.length + (api.diff > 0 ? v.goldGolemSpawners.length : 0);
    v.golemKills = 0; v.roomKills = 0; v.golemSpawned = 0;
    v.pillars = (d.props || []).filter(p => placed(p.cond, api.diff) && /aztecpillar/.test(p.path)).length;
    v.pillarsDown = 0;
    v.priestsOpened = new Set();

    // FUN_003abb00 shows 0 and 1; 3 and 2 are registered but hidden.
    api.reveal(OBJ.TEMPLE);
    api.reveal(OBJ.CRYSTAL);
    api.lockDoor(DOOR.JUNGLE, true);
    api.lockDoor(DOOR.PAINTED, true);
    // Pillar puzzle: on easy the pillars start aligned, so FUN_003abed0 unlocks the rolling door on frame one.
    if (api.diff === 0 || v.pillars === 0) { v.pillarsDone = true; api.lockDoor(DOOR.ROLLING, false); }
    else api.lockDoor(DOOR.ROLLING, true);
    // FUN_003b0820: on normal/hard the temple door only unlocks once the trapdoor-room golems are dead.
    if (api.diff > 0) api.lockDoor(DOOR.TEMPLE, true);
  },

  update(dt, api) {
    const v = api.vars; v.t += dt;
    const p = api.playerPos();

    // Waterfall crank (FUN_003ac5b8 / FUN_003ac430 / FUN_003ac3f8): logs fall, stakes rise, jungle door opens.
    if (!v.crank && dist(p, CRANK_POS) < 3.5) {
      v.crank = true;
      api.sfx('switch');
      api.msg('THE CRANK TURNS - THE LOGS GIVE WAY', 3000);
      api.after(3, a => { a.vars.logsDown = true; for (const i of DOOR.STAKES) a.openDoor(i); });
      api.after(7, a => { a.lockDoor(DOOR.JUNGLE, false); a.openDoor(DOOR.JUNGLE); a.msg('THE JUNGLE DOOR HAS OPENED', 3000); });
    }
    // High Priest ambushes armed by the fallen logs: original condition is logs down AND player near the watch node.
    if (v.logsDown) for (const j of v.priestSpawners) {
      if (v.priestsOpened.has(j)) continue;
      if (api.playerAt(api.data.spawners[j].watch, 5)) { v.priestsOpened.add(j); api.openSpawner(v.map[j]); }
    }
    // Hint at the locked rolling door while the pillar puzzle is unsolved.
    if (!v.pillarsDone && !v.pillarHint && api.playerAt(1363, 4)) { v.pillarHint = true; api.msg('THE SIX PILLARS HOLD THE DOOR SHUT', 3000); }

    // Beyond the jungle door: "Time Crystal located" (FUN_003b1d20 at node 1127) then the temple is found (node 1133).
    if (!v.located && api.playerAt(1128, 5)) { v.located = true; api.say(1303); }
    if (!api.isDone(OBJ.TEMPLE) && (api.playerAt(1131, 6) || api.playerAt(1135, 6))) api.complete(OBJ.TEMPLE);

    // Bottom of the ramp into the trapdoor room (node 1169 in the original): the golem objective appears.
    if (!v.golemShown && (api.playerAt(1166, 5) || api.playerAt(1405, 5) || api.playerAt(1293, 8))) showGolems(api);
    // Safety net: if no golem ever spawns (model missing), do not strand the mission.
    if (v.golemShown && !api.isDone(OBJ.GOLEMS) && v.golemSpawned === 0 && v.t - v.golemShownAt > 90) api.complete(OBJ.GOLEMS); // TODO(uncertain)

    // Pit ambush (condFn 0x3d5288): wake Mister Giggles and the priest when the player heads for the stone face.
    if (!v.pitOpened && api.playerAt(1314, 6)) { v.pitOpened = true; for (const j of v.pitSpawners) api.openSpawner(v.map[j]); }
    // The crystal sits on the stone face's tongue (FUN_003ad4d0); reaching it stands in for picking it up.
    if (!api.isDone(OBJ.CRYSTAL) && api.playerAt(1316, 4)) { api.complete(OBJ.CRYSTAL); api.sfx('objective'); }

    // Gold room door (object 7, type 6 never auto-opens): FUN_003abc80 opens it while the player stands at node 1386.
    if (api.playerAt(GOLD_DOOR_NODE, 6) && (v.goldDoorAt === undefined || v.t - v.goldDoorAt > 3)) { v.goldDoorAt = v.t; api.openDoor(DOOR.GOLD); }

    // FUN_003b1e70: once every other objective is done the portal appears and "escape" is revealed.
    if (!v.portalPlaced && api.isDone(OBJ.TEMPLE) && api.isDone(OBJ.CRYSTAL) && api.isDone(OBJ.GOLEMS)) placePortal(api);
  },

  on(event, payload, api) {
    const v = api.vars;
    switch (event) {
      case 'use':
        // FUN_003af0f8: the lever cog turns, the painted door (object 2) opens.
        if (payload.id === LEVER && !v.leverUsed) { v.leverUsed = true; api.lockDoor(DOOR.PAINTED, false); api.openDoor(DOOR.PAINTED); api.msg('THE PAINTED DOOR OPENS', 2500); }
        break;
      case 'destroyed':
        // FUN_003ac0a8 / FUN_003abed0: pillars aligned -> rolling door unlocked and opened.
        if (/aztecpillar/.test(payload.path || '') && !v.pillarsDone) {
          v.pillarsDown++;
          if (v.pillarsDown >= v.pillars) { v.pillarsDone = true; api.lockDoor(DOOR.ROLLING, false); api.openDoor(DOOR.ROLLING); api.sfx('door'); api.msg('THE ROLLING DOOR GRINDS OPEN', 3000); }
          else api.msg(`PILLARS: ${v.pillarsDown} / ${v.pillars}`, 1500);
        }
        break;
      case 'spawn': {
        const j = Object.keys(v.map).find(k => v.map[k] === payload.spawner);
        if (j !== undefined && api.data.spawners[j].classIdx === WOOD_GOLEM) { v.golemSpawned++; showGolems(api); }
        break;
      }
      case 'killed': {
        // FUN_003b0820: kills of spawner categories 0x1e/0x1f count towards "Defeat the golems".
        if (payload.classIdx !== WOOD_GOLEM) break;
        v.golemKills++;
        api.count(OBJ.GOLEMS, v.golemKills);
        const j = Object.keys(v.map).find(k => v.map[k] === payload.spawner);
        if (j !== undefined && api.data.spawners[j].id === 30) v.roomKills++;
        if (api.diff > 0 && !v.templeOpen && v.roomKills >= v.roomGolemSpawners.length) {
          v.templeOpen = true; api.lockDoor(DOOR.TEMPLE, false); api.openDoor(DOOR.TEMPLE); api.msg('THE TEMPLE DOOR HAS OPENED', 3000);
        }
        if (v.golemKills >= v.golemNeed) { if (!v.golemShown) showGolems(api); api.complete(OBJ.GOLEMS); }
        break;
      }
      case 'portal':
        api.complete(OBJ.PORTAL);
        api.win();
        break;
      default:
        break;
    }
  },
};
