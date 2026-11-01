// Level 41 "Robot Factory" (2315) — mission 4. Translated from FUN_003a5ed0 (start) and the
// prop/switch callbacks around it (0x3a5858..0x3aa7f0). The per-frame dispatcher at 0x3a6a18 is
// not in the Ghidra export, so the order of the boss and core events below is reconstructed from
// the callbacks and the level tables.
//
// Approximations (the api has no equivalent):
//  - The engine tests the held weapon (damage type 0x18 = ElectroTool) when a node is hit. Here a
//    node counts when the runtime destroys the prop with any weapon, or when the player stands by
//    it for 2 s after collecting the ElectroTool (api cannot read the current weapon).
//  - Type-6 doors are locked by the runtime; they are opened by proximity from update().
//  - Spawner condition functions 0x3d3ea8 (open when a given node is dead), 0x3d3f08 (bridge
//    extended + player near), 0x3598a8 (tool taken), 0x3d3fb0 (boss fight) and 0x359bc8
//    (crystal taken) are driven from the script with api.openSpawner.
//  - The Machinist boss machine (rfboss, 41002) is not destructible by the runtime, so a
//    high-hp Machinist character (class 0) is spawned in the boss bay instead.
//  - Cranes, pillars, the transporter and the extending bridge do not animate.

const T = { nodes: 1168, node: 1169, shield: 1170, bridge: 1171, crane: 1167, moveNode: 1172, transporter: 1173, scanDet: 1164, scanDef: 1165 };
const NODE_FNS = ['0x3a62e0', '0x3a5858', '0x3a5880'];          // energy node props (power towers, power cranes)
const BAY = [-138.5, 6.0, 38.0];                                 // centre of the Machinist bay (doors 14-17)
const PORTAL_NODE = 9073;                                        // TODO(uncertain): bay floor; the C does not say where the portal appears
const BOSS_NODE = 9072;
const BOSS_HP = [500, 750, 1000];

const placed = (c, diff) => !(c & 0xc0000) && !!(c & (0x80 << diff));
const dist = (p, a) => Math.hypot(p.x - a[0], p.y - a[1], p.z - a[2]);
const flat = (p, a) => Math.hypot(p.x - a[0], p.z - a[2]);
// Runtime index of a table row: the runtime only keeps the rows placed on this difficulty.
function rtIndex(list, dataIdx, diff, keep) {
  if (!keep(list[dataIdx])) return -1;
  let k = 0;
  for (let i = 0; i < dataIdx; i++) if (keep(list[i])) k++;
  return k;
}
const keepSpawner = diff => s => placed(s.cond, diff) && s.char && s.char.model;
const keepObject = diff => o => placed(o.cond, diff) && o.path;

function openSpawners(api, pred) {
  const list = api.data.spawners || [];
  list.forEach((s, i) => {
    if (!pred(s, i) || api.vars.opened.has(i)) return;
    api.vars.opened.add(i);
    const k = rtIndex(list, i, api.diff, keepSpawner(api.diff));
    if (k >= 0) api.openSpawner(k);
  });
}

function doorPos(api, i) {
  const o = api.data.objects[i];
  if (!o) return null;
  if (o.pos[0] || o.pos[1] || o.pos[2]) return o.pos;
  const nd = api.node(o.node);
  return nd ? [nd.pos.x, nd.pos.y, nd.pos.z] : null;
}

// Keep a locked (type 6) door open while the player stands at it.
function proximityDoor(api, i, radius = 3.4) {
  const v = api.vars, p = doorPos(api, i);
  if (!p || flat(api.playerPos(), p) > radius) return;
  if ((v.doorHold[i] || 0) > 0) return;
  v.doorHold[i] = 2.5;
  const k = rtIndex(api.data.objects, i, api.diff, keepObject(api.diff));
  if (k >= 0) api.openDoor(k);
}

function overload(api, node) {
  const v = api.vars;
  if (node.dead) return;
  node.dead = true; node.hp = 0;
  v.dead++;
  api.count(2, v.dead);
  api.sfx('objective');
  const left = v.nodes.length - v.dead;
  if (left > 1) api.msg(`${left} ${api.text(T.nodes)}`.toUpperCase(), 3000);
  else if (left === 1) api.msg(`1 ${api.text(T.node)}`.toUpperCase(), 3000);
  // FUN_003d3ea8: reinforcement spawners keyed to this node open once it is dead.
  openSpawners(api, s => s.condFn === '0x3d3ea8' && api.node(s.node) && dist(api.node(s.node).pos, node.pos) < 45);
  if (left === 0) {
    api.complete(2);
    v.coreOpen = true;                                             // pillars 112 drop (FUN_003aa750): way to the core
  }
}

function startBridge(api) {
  const v = api.vars;
  v.bridge = 'moving';
  api.sfx('switch');
  api.say(T.bridge, 3000);
  api.after(5, () => {
    v.bridge = 'done';
    api.complete(0);                                               // FUN_003a65f8
  });
}

function startBoss(api) {
  const v = api.vars;
  v.bossStarted = true;
  api.complete(3);
  api.reveal(6);
  api.sfx('objective');
  v.boss = api.spawn(0, BOSS_NODE, { hp: BOSS_HP[api.diff] || 750, weapon: 'plasmamachinegun' });
  if (!v.boss) { v.bossDead = true; api.complete(6); }             // no model: do not strand the player
  openSpawners(api, s => s.condFn === '0x3d3fb0');                 // Gretel clones at the bay doors
}

function bossDead(api) {
  const v = api.vars;
  if (v.bossDead) return;
  v.bossDead = true;
  api.complete(6);                                                 // FUN_003aa2a8: unlocks bay doors 14 and 17
  tryPortal(api);
}

function takeCrystal(api) {
  const v = api.vars;
  if (v.crystal) return;
  v.crystal = true;
  api.complete(4);
  api.reveal(5);
  openSpawners(api, s => s.condFn === '0x359bc8');                 // FUN_00359bc8: open once objective 4 is done
  tryPortal(api);
}

function tryPortal(api) {
  const v = api.vars;
  if (v.portal || !v.crystal || !v.bossDead) return;
  v.portal = true;
  if (api.node(PORTAL_NODE)) api.portal(PORTAL_NODE);
  else api.win();
}

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars, d = api.data;
    Object.assign(v, { opened: new Set(), doorHold: {}, dead: 0, tool: false, bridge: null, shieldUnits: 0, shieldDown: false, scanner: false, coreOpen: false, bossStarted: false, bossDead: false, crystal: false, portal: false, boss: null, hint: 0, t: 0 });
    v.nodes = (d.props || []).filter(p => placed(p.cond, api.diff) && NODE_FNS.includes(p.fn)).map(p => ({ id: p.id, pos: p.pos, dead: false, near: 0 }));
    v.shieldUnits = (d.props || []).filter(p => placed(p.cond, api.diff) && p.fn === '0x3a6240').length;
    const sw = (d.props || []).find(p => p.fn === '0x3a6410');
    v.bridgeSwitch = sw ? sw.pos : [-6.382, 1.166, 37.367];
    const cr = (d.pickups || []).find(p => /timecrystal/.test(p.model || ''));
    v.crystalNode = cr ? cr.node : 9075;
    // FUN_003a5ed0: 0-4 shown at once, 5 and 6 appear later.
    api.reveal(0); api.reveal(1); api.reveal(2, v.nodes.length); api.reveal(3); api.reveal(4);
    api.count(2, 0);
  },

  update(dt, api) {
    const v = api.vars, p = api.playerPos();
    v.t += dt;
    for (const k in v.doorHold) if (v.doorHold[k] > 0) v.doorHold[k] -= dt;
    // Start-area doors and the door past the bridge switch.
    for (const i of [0, 1, 11]) proximityDoor(api, i);
    // Boss doors (12, 13) once the nodes are overloaded; bay entry doors with the fight; far doors after it.
    const nearCore = flat(p, doorPos(api, 12) || [0, 0, 0]) < 4 || flat(p, doorPos(api, 13) || [0, 0, 0]) < 4;
    if (v.coreOpen || api.isDone(2)) { proximityDoor(api, 12); proximityDoor(api, 13); }
    else if (nearCore && v.t - v.hint > 6) { v.hint = v.t; api.say(1083, 2500); }
    if (v.bossStarted) { proximityDoor(api, 15); proximityDoor(api, 16); }
    if (v.bossDead) { proximityDoor(api, 14); proximityDoor(api, 17); }

    // Bridge switch (prop 41001): used by standing at it.
    if (!v.bridge && dist(p, v.bridgeSwitch) < 2.6) startBridge(api);
    // FUN_003d3f08: these spawners wait for the bridge and the player near their watch node.
    if (v.bridge === 'done') openSpawners(api, s => s.condFn === '0x3d3f08' && api.playerAt(s.watch, 5));

    // Energy nodes: proximity overload with the ElectroTool (see header).
    if (v.tool && api.isActive(2)) for (const n of v.nodes) {
      if (n.dead) continue;
      if (dist(p, n.pos) < 4.5) { n.near += dt; if (n.near >= 2) overload(api, n); }
      else n.near = 0;
    }

    // Find the factory core / Machinist bay.
    if (!v.bossStarted && dist(p, BAY) < 9) startBoss(api);
    if (!api.isDone(3) && (v.bossStarted || (api.isDone(2) && nearCore))) api.complete(3);

    // Crystal fallback: the pickup sits on the control matrix above the boss; if the runtime floor
    // never reaches it, standing under it for 3 s after the fight collects it. TODO(uncertain)
    if (v.bossDead && !v.crystal) {
      const nd = api.node(v.crystalNode);
      if (nd && flat(p, [nd.pos.x, 0, nd.pos.z]) < 4 && Math.abs(p.y - nd.pos.y) < 12) { v.crystalNear = (v.crystalNear || 0) + dt; if (v.crystalNear > 3) takeCrystal(api); }
      else v.crystalNear = 0;
    }
  },

  on(event, payload, api) {
    const v = api.vars;
    if (event === 'pickup') {
      if (payload.kind === 'weapon' && payload.weapon === 'electrogun') {
        if (!v.tool) { v.tool = true; api.complete(1); openSpawners(api, s => s.condFn === '0x3598a8'); }
      } else if (/timecrystal/.test(payload.model || '')) takeCrystal(api);
    }
    else if (event === 'destroyed') {
      const path = payload.path || '', rec = payload.prop && payload.prop.rec;
      if (/rfpowertower|rfpowercrane/.test(path) && rec) {
        const n = v.nodes.find(x => x.id === rec.id && !x.dead);
        if (n) overload(api, n);
      } else if (/rfshieldunit/.test(path) && !v.shieldDown) {
        if (--v.shieldUnits <= 0) { v.shieldDown = true; api.say(T.shield, 3000); }   // shield over node 123 drops
      }
    }
    else if (event === 'use') {
      switch (payload.id) {
        case 400: v.scanner = !v.scanner; api.say(v.scanner ? T.scanDef : T.scanDet, 2500); break;  // FUN_003a58c0
        case 402: api.say(T.crane, 2500); break;                                                    // FUN_003a5a18
        case 403: api.say(T.moveNode, 2500); break;                                                 // FUN_003a5b38
        case 404: api.say(T.transporter, 2500); break;                                              // FUN_003a5ba8
      }
    }
    else if (event === 'killed') {
      if (v.boss && payload.bot === v.boss) bossDead(api);
    }
  },
};
