// Level 34 "Notre Dame" (Paris 1895), story mission 3. Translated from SLUS_203.14:
// init FUN_00392fa0, update FUN_00392fd8, event FUN_003936e0 and the callbacks that follow them
// (FUN_00393c80 maiden rescued, FUN_00394110 character died, FUN_003942c0 character spawned,
// FUN_003939a8 bell rope, FUN_00394618 padlocks, FUN_003b1e70 portal placement).
//
// Approximations, because the api has no civilians, no NPC routes and no shootable padlocks:
//  - Maidens are not spawned (their spawners would produce armed, hostile "Maiden" bots). A maiden counts as
//    rescued when the player reaches her shackle node. The spawners of scripted characters (maidens, hunchback,
//    Portal Daemon, Jacque) are silenced through api.story.spawners[i].done, the only handle the runtime exposes.
//  - The hunchback escort is a timer: he appears at the nave door (door 2) when the player gets there; the player
//    must reach the bell tower door (node 1194); 20 s later the bell rope rings and the objective completes.
//    It cannot fail (original: fails when the hunchback or his maiden dies, which also fails "rescue the maidens").
//  - Padlocks (props 104/105) cannot be shot in the runtime, so the cell gates 3/4 keep the runtime's auto-open.
//  - The planks at node 1292 cannot be removed; only the Crypt Zombies behind them are released.
//  - Nav nodes missing from the table: 1297 (sewer gate cue) -> 1305, 1139 (roof reached) -> 1137 / door 9,
//    1170 (time portal) -> 1169.
// Objectives: 0 rescue maidens (counted), 1 hunchback escape (secondary, main on hard), 2 Portal Daemon,
// 3 reach the roof, 4 time crystal, 5 escape through the portal, 6 eliminate Jacque de la Morte.
// Classes (data.classes): 2 Maiden, 3 Changeling, 4 Portal Daemon (TODO(uncertain): its text id says otherwise,
// but it is the only boss-type spawner with the daemon's custom condition), 7 Jacque de la Morte, 8 The Hunchback.

const OBJ = { MAIDENS: 0, HUNCH: 1, DAEMON: 2, ROOF: 3, CRYSTAL: 4, PORTAL: 5, JACQUE: 6 };
const DOOR = { SEWER_GATE: 0, TOWER: 1, NAVE: 2, CELL_W: 3, CELL_E: 4, ROOF_S: 5, ROOF_N: 6, ROOF_DOOR: 9 };
const MAIDEN_SPAWNERS = [20, 21, 22, 23, 24, 25]; // crypt cells; present ones depend on difficulty
const NAVE_MAIDEN_SPAWNER = 67;                   // the maiden the hunchback carries off
const HUNCHBACK_SPAWNER = 68, DAEMON_SPAWNER = 82, JACQUE_SPAWNER = 98;
const CRYPT_ZOMBIES = [16, 17, 18, 19];           // behind the planks at node 1292 (condFn 0x359510)
const STAIR_ZOMBIES = [51, 52];                   // crypt stairs under the nave (condFn 0x359588)
const DAEMON_SUMMONS = [69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 83, 84, 85]; // nave/gallery spawners with the daemon's condFns
const CHANGELINGS = [26, 27];
const TOWER_AMBUSH = [61];
const THANKS = [1186, 1187, 1188, 1190, 1191, 1192];

const placed = (cond, diff) => !(cond & 0xc0000) && !!(cond & (0x80 << diff));

// JSON spawner index -> runtime spawner index (the runtime only keeps the spawners placed on this difficulty).
function mapSpawners(api) {
  const map = {}; let k = 0;
  (api.data.spawners || []).forEach((s, j) => { if (placed(s.cond, api.diff) && s.char && s.char.model) map[j] = k++; });
  return map;
}
const openS = (api, list) => list.forEach(j => { const i = api.vars.sp[j]; if (i !== undefined) api.openSpawner(i); });
function silence(api, list) {
  const S = api.story && api.story.spawners;
  if (!S) return;
  list.forEach(j => { const i = api.vars.sp[j]; if (i !== undefined && S[i]) S[i].done = true; });
}
const pick = a => a[Math.floor(Math.random() * a.length)];

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars;
    v.sp = mapSpawners(api);
    // Maidens of this difficulty: crypt cells plus the one in the nave (counted when the hunchback gets her out).
    v.maidens = MAIDEN_SPAWNERS.map(j => api.data.spawners[j]).filter(s => s && placed(s.cond, api.diff) && api.node(s.node)).map(s => ({ node: s.node, done: false }));
    v.total = v.maidens.length + 1;
    v.rescued = 0;
    silence(api, [...MAIDEN_SPAWNERS, NAVE_MAIDEN_SPAWNER, HUNCHBACK_SPAWNER, DAEMON_SPAWNER, JACQUE_SPAWNER]);

    // FUN_00392fd8: objectives 0, 3, 4, 6 shown; 1, 2, 5 revealed then hidden straight away.
    api.reveal(OBJ.MAIDENS, v.total); api.count(OBJ.MAIDENS, 0);
    api.reveal(OBJ.ROOF); api.reveal(OBJ.CRYSTAL); api.reveal(OBJ.JACQUE);

    // Gates the script opens later: sewer exit (timer), nave door (hunchback), roof gates (maidens / daemon).
    [DOOR.SEWER_GATE, DOOR.NAVE, DOOR.ROOF_S, DOOR.ROOF_N].forEach(d => api.lockDoor(d, true));
  },

  update(dt, api) {
    const v = api.vars;

    // Sewer exit: original cue at node 1297, then FUN_00393188 and a 20 s wait before gate 0 opens.
    if (!v.gateCue && api.playerAt(1305, 7)) {
      v.gateCue = true;
      api.msg('SOMETHING IS MOVING BEYOND THE GATE', 2500);
      api.after(8, () => { api.openDoor(DOOR.SEWER_GATE); api.sfx('door'); }); // TODO(uncertain): original waits ~20 s
    }

    // Crypt: the planks burst at node 1292 (FUN_003931d0) and the Crypt Zombies come through.
    if (!v.planks && api.playerAt(1292, 5)) {
      v.planks = true;
      api.sfx('door');
      openS(api, CRYPT_ZOMBIES);
    }
    if (!v.stairs && (api.playerAt(1226, 6) || api.playerAt(1227, 6))) { v.stairs = true; openS(api, STAIR_ZOMBIES); }

    // Maidens: reach the shackle to free her (original: use the maiden, FUN_00393c80).
    for (const m of v.maidens) if (!m.done && api.playerAt(m.node, 2.2)) { m.done = true; this.rescued(api); }

    // The hunchback shows up at the nave door (FUN_003942c0 case 0x16): door 2 unlocks, objective 1 appears.
    if (!v.hunch && (api.playerAt(1105, 6) || api.playerAt(1102, 6) || api.playerAt(1009, 5))) {
      v.hunch = true;
      api.openDoor(DOOR.NAVE);
      api.reveal(OBJ.HUNCH);
      api.say(1195); // "Help me!!"
      openS(api, CHANGELINGS);
      openS(api, TOWER_AMBUSH);
    }
    // Escort: once the player reaches the bell tower door the hunchback climbs and rings the rope (FUN_003939a8).
    if (v.hunch && !v.rope && api.playerAt(1194, 6)) {
      v.rope = true;
      api.msg('THE HUNCHBACK CLIMBS THE BELL TOWER', 3000);
      api.after(20, () => {
        api.sfx('switch');
        api.say(1189); // "Come on dear, let's go"
        if (api.isActive(OBJ.HUNCH)) api.complete(OBJ.HUNCH); // FUN_00394008
        if (!v.naveMaiden) { v.naveMaiden = true; this.rescued(api); }
      });
    }

    // Portal Daemon: appears on the upper gallery once the maidens are free (spawner 82 watched node 1117).
    if (!v.daemon && api.isDone(OBJ.MAIDENS) && api.playerAt(1117, 5)) {
      v.daemon = true;
      api.reveal(OBJ.DAEMON);
      [DOOR.ROOF_S, DOOR.ROOF_N, DOOR.NAVE].forEach(d => api.lockDoor(d, true)); // FUN_00296b90(5), (6), (2)
      v.daemonBot = api.spawn(4, 1118, { hp: 350 + api.diff * 100 }); // TODO(uncertain): original rises from node 9001
      openS(api, DAEMON_SUMMONS);
      if (!v.daemonBot) this.daemonDead(api);
    }

    // Roof reached (original: nearest node 1139, just past door 9).
    if (!api.isDone(OBJ.ROOF) && api.isDone(OBJ.DAEMON) && api.playerAt(1137, 2.5)) this.roofReached(api);

    // Ending: the portal appears when every other main objective is done (FUN_003b1e70).
    if (!v.portal && api.isDone(OBJ.CRYSTAL) && this.mainsDone(api)) {
      v.portal = true;
      api.reveal(OBJ.PORTAL);
      api.say(1301); // "Time Portal stabilized"
      if (api.node(1169)) api.portal(1169); // TODO(uncertain): original node 1170 is not in the table
      else api.after(2, () => api.win());
    }
  },

  on(event, p, api) {
    const v = api.vars;
    if (event === 'pickup' && /timecrystal/i.test(p.model || '')) {
      api.complete(OBJ.CRYSTAL); // FUN_003b1db0(4)
      api.say(1303);             // "Time Crystal located"
    } else if (event === 'killed') {
      if (v.daemonBot && p.bot === v.daemonBot) this.daemonDead(api);               // FUN_00394110 case 0x18
      else if (v.jacque && p.bot === v.jacque) { api.complete(OBJ.JACQUE); api.msg('JACQUE DE LA MORTE ELIMINATED', 3000); } // case 0x19
    } else if (event === 'doorOpen' && p.door === DOOR.ROOF_DOOR && api.isDone(OBJ.DAEMON) && !api.isDone(OBJ.ROOF)) {
      this.roofReached(api);
    } else if (event === 'portal') {
      api.complete(OBJ.PORTAL);
      api.win();
    }
  },

  // ---- helpers ----
  rescued(api) {
    const v = api.vars;
    v.rescued++;
    api.count(OBJ.MAIDENS, v.rescued);
    api.say(pick(THANKS), 2000);
    const left = v.total - v.rescued;
    if (left > 1) api.after(2, () => api.msg(`${left} ${api.text(1196)}`.toUpperCase(), 2500));
    else if (left === 1) api.after(2, () => api.msg(`1 ${api.text(1197)}`.toUpperCase(), 2500));
    if (v.rescued >= v.total) { api.complete(OBJ.MAIDENS); api.openDoor(DOOR.ROOF_N); } // FUN_00393c80: gate 6 opens
  },
  daemonDead(api) {
    api.complete(OBJ.DAEMON);
    [DOOR.ROOF_S, DOOR.ROOF_N, DOOR.NAVE].forEach(d => api.openDoor(d)); // FUN_00296a08(5|6|2, 1)
  },
  roofReached(api) {
    const v = api.vars;
    api.complete(OBJ.ROOF);
    if (v.jacque) return;
    api.after(1.5, () => {
      api.say(1194); // "The Angels of Time are with me!"
      v.jacque = api.spawn(7, 1150, { hp: 500 + api.diff * 150, weapon: 'doublebarrelshotgun' }); // TODO(uncertain): spawner 98 used node 1174
      if (!v.jacque) api.complete(OBJ.JACQUE); // model missing: do not block the mission
    });
  },
  mainsDone(api) {
    return (api.data.objectives || []).every((o, i) => i === OBJ.PORTAL || o.cat[api.diff] !== 0 || api.isDone(i));
  },
};
