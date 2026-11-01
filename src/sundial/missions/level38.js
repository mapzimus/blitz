// Level 38 "NeoTokyo" (Tek Quarter 2019), story mission 5. Translated from SLUS_203.14:
// init FUN_0039a240, objective setup FUN_0039a278, per-frame FUN_0039aa28, and the callbacks around them
// (FUN_00399b70 card reader / laser wall, FUN_0039b3d8+FUN_0039b180+FUN_0039aee0 keypad and password,
// FUN_0039a508 evidence, FUN_0039c018+FUN_0039c0a0 upload console (pc_towers), FUN_0039c480 machine switch,
// FUN_0039c948 deaths, FUN_0039ca58 crystal drop, FUN_003cf548 hacker AI, FUN_003cf910 gang leader AI).
//
// Approximations, because the api has no NPC routes, no "look at" test, no removable props and no item drops:
//  - The hacker is spawned by the script (class 1) and walks her street route; the nodes missing from the table
//    make her cut corners. She notices the player like any bot (bot.alert) -> "Follow the hacker" fails, as does
//    killing her. "Follow" completes at the police station room (node 1284 is missing, 9058 stands in).
//  - Password: when she reaches the keypad she waits up to 45 s for the player; the player must be within 12 m
//    while she types (original: look at the keypad), else objective 1 fails. The player "types" it by standing at
//    the keypad; door 2 opens. Lab doors 1/3/4 (type 6) are made auto-open once the lab is entered.
//  - The laser wall (prop 103) is hidden/shown through api.story.props when the card readers are used
//    (the hacker uses hers at node 1191 as in FUN_003cf548).
//  - Evidence = standing by the research plans (pc_towers, node 1288) and by the TimeSplitter machine.
//    Upload = standing at the pc_towers for 8 s; the lockdown at 6 s left is reproduced (door 0, turrets).
//  - Gang leader: easy = the hacker herself, hostile once inside the lab, 150 s escape timer (route callbacks
//    FUN_0039cb58/FUN_0039cb78); normal/hard = class 5 spawned after the machine is off (spawners 28/59, id 39).
//    She drops the crystal where she dies: reaching that spot completes objective 7.
//  - Pedestrian spawners never open (the runtime would arm them), so "minimize civilian casualties" counts
//    nothing and completes with the crystal. Turrets are switched through api.cameras()[i].on.
//  - Portal node 1302 is missing from the table: 1245 (research entrance) is used.
// Spawner condition functions handled here (the runtime knows 0x359430 near-node and 0x359748 anim 401 only):
// 0x359bc8 open when objective 4 done; 0x359c20 / 0x3cfb98 objective 4 done and near the watched node;
// 0x359ad0 / 0x3cfa10 / 0x3cf8b8 objective 4 done and player in the room (approximated by distance).

const OBJ = { FOLLOW: 0, PASSWORD: 1, EVIDENCE: 2, UPLOAD: 3, MACHINE: 4, LEADER: 5, PORTAL: 6, CRYSTAL: 7, CIVIL: 8 };
const DOOR = { BACK: 0, MACHINE_WING: 1, LAB: 2, NORTH: 3, PLANS: 4 };
const KEYPAD = [13.08, -3.79, 46.94];    // prop 38000 neolaptop1
const PC_TOWERS = [5.04, -0.79, 75.34];  // prop 102, the "police server" console
const MACHINE = [-12.28, -0.2, 71.65];   // interact 306 neosplitterswitch
const HACKER_SPAWN = 1213, LAB_IN = 1247, LAB_LOOP = [1247, 1251, 1253, 1256, 1253, 1251];
const STATION_NODES = [9058, 1193], STATION_COP = 20, TURRETS = [17, 18, 19];
const LEADER_NODE = { 1: 1250, 2: 1025 }, LEADER_SPAWNERS = [28, 59];
const PEDESTRIAN = c => c >= 6 && c <= 25;
const CIVIL_LIMIT = { 1: 4, 2: 2 };

const dist = (api, p) => { const q = api.playerPos(); return Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]); };
const botNear = (b, p, r) => !!b && !b.dead && Math.hypot(b.group.position.x - p[0], b.group.position.z - p[2]) < r;
const botAtNode = (api, b, id, r = 2.5) => { const n = api.node(id); return !!n && botNear(b, [n.pos.x, n.pos.y, n.pos.z], r); };
const setTurrets = (api, on) => TURRETS.forEach(i => { const c = api.cameras()[i]; if (c && !c.dead) c.on = on; });
function laserWall(api, up) {
  const S = api.story, p = S.props.find(x => x.rec.id === 103);
  if (!p || p.up === up) return;
  p.up = up; p.group.visible = up;
  if (up) S.world.solid.push(...p.group.children); else S.world.solid = S.world.solid.filter(m => m.parent !== p.group);
  api.sfx('switch');
}
function hackerRoute(api) {
  // Route table entries are stored flat (3 per row); the hacker uses entry 0 (normal/hard) or 4 (easy).
  const flat = (api.data.difficulty || []).flat();
  const r = flat[api.diff === 0 ? 4 : 0];
  const ids = r ? r.words.slice(0, r.n).filter(w => w >= 1000 && w < 10000) : [HACKER_SPAWN, 1012, 1074, 1093, 1171, 1174, 1175, 1186, 1193, 1245, LAB_IN];
  return [...ids, ...LAB_LOOP.slice(1)].map(id => api.node(id)).filter(Boolean);
}

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars;
    v.civil = 0; v.spotted = 0; v.phase = 'tail'; v.evidence = { plans: false, machine: false }; v.leader = null;
    // FUN_0039a278: 0, 2, 3, 7, 8 shown; 1, 4, 5, 6 revealed then hidden straight away.
    api.reveal(OBJ.FOLLOW); api.reveal(OBJ.EVIDENCE, 2); api.count(OBJ.EVIDENCE, 0); api.reveal(OBJ.UPLOAD); api.reveal(OBJ.CRYSTAL); api.reveal(OBJ.CIVIL);
    api.lockDoor(DOOR.LAB, true);                      // opened by the keypad (FUN_0039b180 -> FUN_00296a08(2,1))
    if (api.diff !== 0) api.lockDoor(DOOR.BACK, true); // FUN_00296920(0) on normal/hard
    setTurrets(api, false);                            // turrets sleep until the lockdown (FUN_0039c0a0)
    v.hacker = api.spawn(1, HACKER_SPAWN, { route: hackerRoute(api), hp: 60, weapon: 'silencedpistol' });
    if (!v.hacker) api.msg('FOLLOW THE HACKER THROUGH THE STREETS', 3000); // model missing: checkpoints only
  },

  update(dt, api) {
    const v = api.vars, h = v.hacker;
    // ---- tailing ----
    if (api.isActive(OBJ.FOLLOW)) {
      if (h && h.alert && !h.dead) {
        if (botNear(h, [api.playerPos().x, 0, api.playerPos().z], 22)) { api.msg('THE HACKER HAS SEEN YOU', 3000); api.fail(OBJ.FOLLOW); return; }
        h.alert = false; // alerted by a fight elsewhere, not by the player: she keeps walking
      }
      if (STATION_NODES.some(n => api.playerAt(n, 5))) { api.complete(OBJ.FOLLOW); api.reveal(OBJ.PASSWORD); } // player node == 1284
    }
    if (h && !v.wallDown && (botAtNode(api, h, 1191, 4) || botAtNode(api, h, 1193, 3))) { v.wallDown = true; laserWall(api, false); } // FUN_0039cb30
    // ---- the password: she waits at the keypad, then types it ----
    if (h && !h.dead && !v.typed && botNear(h, KEYPAD, 7)) {
      if (!v.keyT) { v.keyT = 0.001; h.wait = 60; }
      v.keyT += dt;
      const close = dist(api, KEYPAD) < 12;
      if (close || v.keyT > 45) {
        v.typed = true; h.wait = 0;
        if (!api.isActive(OBJ.PASSWORD)) { api.complete(OBJ.FOLLOW); api.reveal(OBJ.PASSWORD); }
        api.after(4, () => {
          api.say(1233, 2000); // ACCEPTED
          if (close) this.passwordSeen(api); else api.fail(OBJ.PASSWORD); // FUN_0039aee0 / FUN_0039b180 state 3
          api.openDoor(DOOR.LAB); api.after(5, () => { if (!v.labOpen) api.lockDoor(DOOR.LAB, true); });
        });
      }
    }
    if (!h && api.isActive(OBJ.PASSWORD) && dist(api, KEYPAD) < 3) { this.passwordSeen(api); api.say(1233, 2000); } // no hacker: read it off the keypad
    // Player enters the code (FUN_0039b3d8 state 1 -> 3 -> door 2).
    if (api.isDone(OBJ.PASSWORD) && !v.labOpen && dist(api, KEYPAD) < 2.2) {
      v.labOpen = true; api.say(1231, 1500); api.sfx('switch');
      api.after(2.5, () => { api.say(1233, 2000); api.openDoor(DOOR.LAB); this.openLab(api); });
    }
    // ---- the hacker inside the lab ----
    if (h && !h.dead && !v.hackerIn && botAtNode(api, h, LAB_IN, 2.5)) {
      v.hackerIn = true;
      h.route = LAB_LOOP.map(id => api.node(id)).filter(Boolean); h.routeIdx = 0; // bot route swap: patrol the lab, not the streets
      if (api.diff === 0) this.leaderAppears(api, h); // easy: the hacker is the gang leader (FUN_0039cb58 on her route)
    }
    // ---- easy: the machine objective appears past door 1 (node 1253, FUN_0039aa28) ----
    if (api.diff === 0 && !api.isActive(OBJ.MACHINE) && !api.isDone(OBJ.MACHINE) && api.playerAt(1253, 3)) api.reveal(OBJ.MACHINE);
    // ---- evidence (FUN_0039a508) ----
    if (api.isActive(OBJ.EVIDENCE)) {
      const e = v.evidence;
      if (!e.plans && api.playerAt(1288, 3)) { e.plans = true; api.say(1223, 2500); api.after(2.5, () => { if (!e.machine) api.say(1224, 2500); }); }
      if (!e.machine && dist(api, MACHINE) < 5) { e.machine = true; api.msg('TIMESPLITTER MACHINE RECORDED AS EVIDENCE', 2500); if (!e.plans) api.after(2.5, () => api.say(1226, 2500)); }
      const n = (e.plans ? 1 : 0) + (e.machine ? 1 : 0);
      api.count(OBJ.EVIDENCE, n);
      if (n === 2) api.complete(OBJ.EVIDENCE);
    }
    // ---- upload at the pc_towers (FUN_0039c018 / FUN_0039c0a0) ----
    if (api.isDone(OBJ.EVIDENCE) && api.isActive(OBJ.UPLOAD) && !v.upload && dist(api, PC_TOWERS) < 3) {
      v.upload = 8; api.say(1235, 2500); api.sfx('switch'); // UPLOADING...
    }
    if (v.upload > 0) {
      v.upload -= dt;
      if (v.upload < 6 && !v.lockdown) this.lockdown(api);
      if (v.upload <= 0) { api.say(1236, 2000); api.complete(OBJ.UPLOAD); api.reveal(OBJ.MACHINE); } // COMPLETE
    }
    // ---- gang leader escape timer (easy) ----
    if (v.escape > 0) {
      v.escape -= dt;
      if (v.escape <= 0 && api.isActive(OBJ.LEADER)) { api.msg('THE GANG LEADER HAS ESCAPED', 3000); api.fail(OBJ.LEADER); return; } // FUN_0039cb78
    }
    // ---- the dropped crystal (FUN_0039ca58 / FUN_003b1db0) ----
    if (v.crystalAt && !api.isDone(OBJ.CRYSTAL) && dist(api, v.crystalAt) < 2) {
      api.complete(OBJ.CRYSTAL); api.say(1303, 3000); // Time Crystal located
      if (api.isActive(OBJ.CIVIL)) api.complete(OBJ.CIVIL);
    }
    // ---- reinforcements after the machine is deactivated ----
    if (api.isDone(OBJ.MACHINE)) this.afterMachine(api);
    // ---- ending (FUN_003b1e70(6, 1302)) ----
    if (!v.portal && api.isDone(OBJ.CRYSTAL) && this.mainsDone(api)) {
      v.portal = true;
      api.reveal(OBJ.PORTAL);
      api.say(1301, 3000); // Time Portal stabilized
      if (api.node(1245)) api.portal(1245); // TODO(uncertain): node 1302 is not in the table
      else api.after(2, () => api.win());
    }
  },

  on(event, p, api) {
    const v = api.vars;
    if (event === 'killed') {
      if (v.hacker && p.bot === v.hacker) {
        if (v.leader === p.bot) return this.leaderDead(api, p.bot);
        if (api.isActive(OBJ.FOLLOW) || api.isActive(OBJ.PASSWORD)) { api.fail(OBJ.FOLLOW); api.fail(OBJ.PASSWORD); } // FUN_0039c948 case 0x26
        else if (api.diff === 0 && !v.leader) { v.leader = p.bot; this.leaderDead(api, p.bot); } // easy: she was the gang leader
      } else if (v.leader && p.bot === v.leader) this.leaderDead(api, p.bot);    // case 0x27
      else if (PEDESTRIAN(p.classIdx) && api.diff !== 0) {                          // spawner id 4
        v.civil++;
        if (v.civil > CIVIL_LIMIT[api.diff]) api.fail(OBJ.CIVIL);
      }
    } else if (event === 'seen') {
      api.anim(401); // the police (spawners 18/19) answer the cameras
      if (api.isActive(OBJ.FOLLOW)) {
        v.spotted++;
        if (v.spotted >= 2) { api.msg('SECURITY HAS IDENTIFIED YOU', 3000); api.fail(OBJ.FOLLOW); }
        else api.msg('A CAMERA SPOTTED YOU - STAY OUT OF SIGHT', 3000); // TODO(uncertain): original only summons police
      } else api.msg('SECURITY ALERTED', 2000);
    } else if (event === 'use') {
      if (p.id === 303 || p.id === 304) { const w = api.story.props.find(x => x.rec.id === 103); laserWall(api, w ? w.up === false : false); } // FUN_00399b70 toggles the wall
      else if (p.id === 306) this.machineSwitch(api);                                  // FUN_0039c480
    } else if (event === 'destroyed' && p.id === 102 && !api.isDone(OBJ.EVIDENCE)) {
      api.fail(OBJ.EVIDENCE); // FUN_0039aa28: pc_towers destroyed
    } else if (event === 'portal') {
      api.complete(OBJ.PORTAL);
      api.win();
    }
  },

  // ---- helpers ----
  passwordSeen(api) {
    if (!api.isActive(OBJ.PASSWORD)) api.reveal(OBJ.PASSWORD);
    api.complete(OBJ.PASSWORD);
    api.openSpawner(STATION_COP); // the riot officer in the station comes looking (FUN_003cfac0)
  },
  openLab(api) {
    const v = api.vars;
    api.lockDoor(DOOR.LAB, false);
    if (api.diff === 0 && !v.hacker && !v.leader) this.leaderAppears(api, null); // no hacker model: the leader still has to show up
    [DOOR.MACHINE_WING, DOOR.NORTH, DOOR.PLANS].forEach(i => { const d = api.story.doors[i]; if (d) { d.auto = true; d.locked = false; } }); // TODO(uncertain): who opens the type-6 lab doors
  },
  lockdown(api) {
    const v = api.vars; v.lockdown = true;
    api.say(1227, 3000); api.after(4, () => api.say(1229, 3000)); api.after(8, () => api.say(1230, 3000));
    api.anim(402);
    api.closeDoor(DOOR.LAB); api.lockDoor(DOOR.LAB, true); // FUN_00296b90(2)
    api.openDoor(DOOR.BACK); api.lockDoor(DOOR.BACK, false); // FUN_00296990(0), FUN_00296a08(0,1)
    setTurrets(api, true); // 201/202 (+203 on hard; 203 is only placed on hard)
    if (api.diff === 1 && !v.leader) this.leaderAppears(api, null); // spawner 28: Sadako in the lab on normal
  },
  machineSwitch(api) {
    const v = api.vars;
    if (api.isDone(OBJ.MACHINE)) return;
    if (!api.isActive(OBJ.MACHINE)) { api.say(1244, 2000); return; } // "This console is inoperative" until the objective is up
    api.complete(OBJ.MACHINE);
    api.msg('TIMESPLITTER MACHINE DEACTIVATED', 3000); api.sfx('switch');
    laserWall(api, false);
    api.openDoor(DOOR.LAB); api.lockDoor(DOOR.LAB, false); // FUN_00296a08(2,1)
    setTurrets(api, false);                               // FUN_0039c430
    api.anim(403);
    if (api.diff === 2 && !v.leader) this.leaderAppears(api, null); // spawner 59: Sadako in the streets on hard
  },
  leaderAppears(api, bot) {
    const v = api.vars;
    v.leader = bot || api.spawn(5, LEADER_NODE[api.diff] || 1250, { hp: 240 + api.diff * 80, weapon: 'uzi' });
    if (bot) { bot.alert = true; bot.hp = bot.maxHp = 260; }
    if (api.diff === 0) {
      api.reveal(OBJ.LEADER); v.escape = 150; // FUN_0039cb58; FUN_0039cb78 when she reaches her escape node
      api.msg('THE GANG LEADER IS MAKING FOR THE EXIT', 3000);
    } else api.msg('THE GANG LEADER HAS THE TIME CRYSTAL', 3000);
    if (!v.leader) this.leaderDead(api, null); // model missing: do not block the mission
  },
  leaderDead(api, bot) {
    const v = api.vars; v.escape = 0;
    if (!api.isDone(OBJ.LEADER)) { api.reveal(OBJ.LEADER); api.complete(OBJ.LEADER); } // no-op on normal/hard (absent)
    const q = bot ? bot.group.position : api.playerPos();
    v.crystalAt = [q.x, q.y, q.z];
    api.msg('SHE DROPPED THE TIME CRYSTAL', 3000);
  },
  afterMachine(api) {
    const v = api.vars; v.spOpen = v.spOpen || {};
    (api.data.spawners || []).forEach((s, j) => {
      if (v.spOpen[j] || !s.condFn || LEADER_SPAWNERS.includes(j)) return; // the leader (id 39) is spawned by the script
      const fn = s.condFn, w = s.watch;
      let ok = false;
      if (fn === '0x359bc8') ok = true;
      else if (fn === '0x359c20' || fn === '0x3cfb98') ok = api.playerAt(w, 6);
      else if (fn === '0x359ad0' || fn === '0x3cfa10' || fn === '0x3cf8b8') ok = api.playerAt(w >= 1000 ? w : s.node, 14);
      if (ok) { v.spOpen[j] = true; api.openSpawner(j); }
    });
  },
  mainsDone(api) {
    return (api.data.objectives || []).every((o, i) => i === OBJ.PORTAL || o.cat[api.diff] !== 0 || api.isDone(i));
  },
};
