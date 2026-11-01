// Level 20 "Chicago" (Downtown 1932), story mission 2. Translated from SLUS_203.14:
// FUN_0037cca8/FUN_0037ce98 (setup: objectives 0,1,3,7,8,9 shown; 2,6,10 hidden), FUN_0037d9e8 (per frame:
// phone 102 rings at node 1029, pass card completes 3, warehouse doors 106/107 open past z<-12, Marco's lines
// by node), FUN_0037d3b0 (phones), FUN_0037d238 (barrel counter), FUN_0037d6f0/FUN_0037d7e8 (spawn/death by
// spawner id: 7 Marco, 4/5 civilians, 60 Big Tony who carries the crystal), FUN_003ce748/FUN_003ce658 (Marco
// waits, then walks to his hideout; objective 2 completes at node 1389), FUN_00382b90 case 0x336 / FUN_0037f708
// (Tony's brother's getaway: objective 6 re-shown, completed when stopped, failed when he gets away),
// FUN_003b1e70(10, 1433) portal, FUN_003b1db0(8) crystal.
//
// Approximations, because the api has no friendly characters, phones, dropped pickups or vehicles:
//  - Marco is not spawned (his spawner would make a hostile "Marco the Snitch"); he is a virtual escort that
//    walks the waypoints below only while the player stays close. He "dies" (objective 2 fails) when enemies
//    sit next to him for 10 s or the player strays more than 35 m for 8 s.
//  - Phone 102 cannot be used: it rings when the player reaches node 1029 and is answered by walking up to it.
//  - The pass card: easy takes the table pickup; normal/hard get it by breaking Tony's safe (no pickup can be
//    placed, so the card is granted directly).
//  - Big Tony drops a virtual crystal where he dies; walking over it completes objective 8.
//  - Tony's brother is a bot (class 0) that leaves the club gate for node 1618; he "escapes" if he gets there.
//  - Warehouse doors 106/107 are props, hidden through api.story (no api for prop animation).
//  - Spawner condition functions the runtime does not know (0x3ce3a8..0x3ce600, 0x3595f8, 0x359a18, 0x359a80,
//    0x359b70, 0x359e68, 0x359510) are driven here. Portal node 1433 is not in the table -> 1434.
// Objectives: 0 drain barrels (counted; secondary on easy, main after), 1 rendezvous, 2 protect Marco, 3 pass card,
// 4 stop the informant's call (secondary), 6 Tony's brother (secondary, main on hard), 7 Big Tony, 8 crystal,
// 9 civilian casualties (secondary; absent on easy), 10 portal. Objective 5 is absent on every difficulty.

const OBJ = { BARRELS: 0, MEET: 1, PROTECT: 2, CARD: 3, CALL: 4, BROTHER: 6, TONY: 7, CRYSTAL: 8, CIVIL: 9, PORTAL: 10 };
const DOOR = { BOUNCER: 2, GATE: 4 };
const PHONE_102 = { x: -2.16, y: 0.2, z: -22.76 };
const PHONES = [{ x: 62.66, y: 0.2, z: -150.2 }, { x: -5.22, y: 0.2, z: -131.58 }, { x: 56.93, y: 0.2, z: -98.97 }];
const NEWSSTAND = 1558, HIDEOUT = 1387, TONY_TRIGGER = 1424, PORTAL_NODE = 1434, ESCAPE_NODE = 1618;
// Marco's walk from the newspaper stand into O'Leary's and up to the snitch door (original: route 6 to node 1389).
const WAYPOINTS = [{ n: 1161, open: [24, 25] }, { n: 1209, say: 1128, open: [26, 27, 30, 31] }, { n: 1667, say: 1129 }, { n: 1452 }, { n: HIDEOUT, end: true }];
const CIVILIANS_CITY = [76, 77, 78, 79, 80, 81], CIVILIANS_BAR = [16, 17, 18, 19], BAR_FIGHT = [20, 21, 22];
const MARCO_SPAWNER = 23, ESCORT_START = [28, 29], AMBUSH_WINDOWS = [41, 42, 43, 44, 45], AMBUSH_OFFICE = [46, 47, 48];
const AFTER_CARD = [49, 50, 51, 52, 59, 60], INFORMANTS = [53, 54, 55], CLUB_GUARDS = [59, 60];
const TONY_SPAWNER = 72, SPLITTERS = [73, 74, 75], NEAR_FALLBACK = [34, 38];
const CIVILIAN_CLASSES = [8, 9, 10], BROTHER_CLASS = 0;

const placed = (cond, diff) => !(cond & 0xc0000) && !!(cond & (0x80 << diff));
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
// JSON spawner index -> runtime index (the runtime keeps only the spawners placed on this difficulty).
function mapSpawners(api) {
  const map = {}; let k = 0;
  (api.data.spawners || []).forEach((s, j) => { if (placed(s.cond, api.diff) && s.char && s.char.model) map[j] = k++; });
  return map;
}
const rt = (api, j) => api.vars.sp[j];
const openS = (api, list) => list.forEach(j => { const i = rt(api, j); if (i !== undefined) api.openSpawner(i); });
const spawnerBots = (api, list) => list.map(j => (api.story.spawners || [])[rt(api, j)]).filter(Boolean);
const doorIdx = (api, j) => { const d = (api.story.doors || []).find(x => x.rec === api.data.objects[j]); return d ? d.idx : j; };
const botPos = b => b && b.group && b.group.position;

function openWarehouse(api) {
  // FUN_0037f570: the warehouse doors swing open once the player is down the street.
  const S = api.story; if (!S || !S.props) return;
  for (const p of S.props) if (p.rec.id === 106 || p.rec.id === 107) { p.group.visible = false; if (S.world) S.world.solid = S.world.solid.filter(m => m.parent !== p.group); }
  api.sfx('door');
}

function barrelDrained(api) {
  const v = api.vars; v.drained++; api.count(OBJ.BARRELS, v.drained);
  const left = v.barrels - v.drained;
  if (left <= 0) api.complete(OBJ.BARRELS);
  else api.msg(`${left} ${api.text(left === 1 ? 1123 : 1122).toUpperCase()}`, 2500);
}

function rendezvous(api) {
  const v = api.vars; v.met = true; v.metAt = api.story.time;
  openS(api, CIVILIANS_BAR);
  if (api.diff === 0 || !spawnerBots(api, BAR_FIGHT).length) { api.complete(OBJ.MEET); return; } // no bar fight on easy
  api.say(1126, 3500); api.after(3.5, () => api.say(1127, 3500));
  openS(api, BAR_FIGHT);
  api.after(5, () => api.complete(OBJ.MEET));
}
// Bar fight over (all three gangsters dead), or Marco gets impatient after 75 s so the escort cannot dead-lock.
const barCleared = api => spawnerBots(api, BAR_FIGHT).every(s => s.done && s.alive.every(b => b.dead)) || api.story.time - api.vars.metAt > 75;

function startEscort(api) {
  const v = api.vars; v.escort = { wp: 0, heat: 0, stray: 0 };
  const n = api.node(NEWSSTAND); v.marco = { x: n.pos.x, y: n.pos.y, z: n.pos.z };
  api.reveal(OBJ.PROTECT);
  openS(api, ESCORT_START);
}

function tickEscort(dt, api) {
  const v = api.vars, e = v.escort, p = api.playerPos();
  const dp = Math.sqrt(d2(p, v.marco));
  // Marco only moves while the player keeps up; strays and a crowd of gangsters get him killed.
  e.stray = dp > 35 ? e.stray + dt : 0;
  const threats = api.enemies().filter(b => botPos(b) && d2(botPos(b), v.marco) < 36).length;
  e.heat = threats ? e.heat + dt : Math.max(0, e.heat - dt * 0.5);
  if (e.stray > 8) { api.msg('YOU LEFT MARCO BEHIND', 3000); v.escort = null; api.fail(OBJ.PROTECT); return; }
  if (e.heat > 15) { api.msg('MARCO HAS BEEN KILLED', 3000); v.escort = null; api.fail(OBJ.PROTECT); return; }
  if (dp > 14 || threats) return;
  const wp = WAYPOINTS[e.wp], nd = api.node(wp.n);
  if (!nd && !wp.end) { e.wp++; return; }
  const t = nd ? nd.pos : v.marco;
  const dx = t.x - v.marco.x, dy = t.y - v.marco.y, dz = t.z - v.marco.z, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const step = 2.2 * dt;
  if (len > step) { v.marco.x += dx / len * step; v.marco.y += dy / len * step; v.marco.z += dz / len * step; return; }
  v.marco = { x: t.x, y: t.y, z: t.z };
  if (wp.say) api.say(wp.say, 3000);
  if (wp.open) openS(api, wp.open);
  if (!wp.end) { e.wp++; return; }
  // Hideout reached: FUN_003ce658 completes objective 2; Marco's last line depends on the difficulty.
  v.escort = null; api.complete(OBJ.PROTECT);
  api.after(1.5, () => api.say(api.diff === 0 ? 1131 : 1130, 5000));
}

function gotCard(api) {
  const v = api.vars; if (v.hasCard) return; v.hasCard = true;
  api.msg(`${api.text(1649).toUpperCase()} OBTAINED`, 2500);
  api.after(2, () => api.complete(OBJ.CARD));
  api.lockDoor(doorIdx(api, DOOR.BOUNCER), false);
  openS(api, AFTER_CARD);
  // Phone 105 in Tony's office: Marco warns about the hitmen outside (FUN_0037d3b0), who then show up (0x359b70).
  if (api.isDone(OBJ.PROTECT)) api.after(3, () => { api.say(1125, 5000); openS(api, AMBUSH_WINDOWS); });
  else openS(api, AMBUSH_WINDOWS);
}

function tonyKilled(api, bot) {
  const v = api.vars; if (v.tonyDead) return; v.tonyDead = true;
  api.complete(OBJ.TONY);
  const bp = botPos(bot) || api.node(1439).pos;
  v.crystal = { x: bp.x, y: bp.y, z: bp.z };
  api.msg('BIG TONY DROPPED THE TIME CRYSTAL', 3000);
  openS(api, SPLITTERS);
  api.after(4, () => { api.reveal(OBJ.BROTHER); api.msg("TONY'S BROTHER IS MAKING A RUN FOR IT - GET OUTSIDE", 4000); });
}

function brotherRuns(api) {
  // FUN_00382b90 case 0x336 / FUN_00381850: the getaway starts and gate 4 opens for it.
  const v = api.vars; v.brotherOut = true;
  api.openDoor(doorIdx(api, DOOR.GATE));
  const route = [1396, 1193, ESCAPE_NODE].map(id => api.node(id)).filter(Boolean);
  v.brother = api.spawn(BROTHER_CLASS, 1397, { hp: 90 + api.diff * 30, route, weapon: 'tommygun' });
  if (!v.brother) { api.complete(OBJ.BROTHER); return; } // TODO(uncertain): no class 0 model -> cannot escape
  v.brotherTimer = 150; // backstop
}

// Every main objective but the portal (and the casualty count, which only ever fails) is done.
function mainsDone(api) {
  return api.story.objectives.every(o => o.cat !== 0 || o.state === 'absent' || o.i === OBJ.PORTAL || o.i === OBJ.CIVIL || o.state === 'done');
}

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars;
    v.sp = mapSpawners(api); v.civ = 0; v.drained = 0;
    v.barrels = (api.data.props || []).filter(p => /whiskybarrel/i.test(p.path) && placed(p.cond, api.diff)).length;
    // FUN_0037ce98: 0, 1, 3, 7, 8, 9 shown; 2, 6, 10 revealed then hidden; 4 waits for the informant.
    api.reveal(OBJ.BARRELS, v.barrels); api.count(OBJ.BARRELS, 0);
    api.reveal(OBJ.MEET); api.reveal(OBJ.CARD); api.reveal(OBJ.TONY); api.reveal(OBJ.CRYSTAL); api.reveal(OBJ.CIVIL);
    if (!v.barrels) api.complete(OBJ.BARRELS);
    const marco = api.story.spawners[rt(api, MARCO_SPAWNER)]; if (marco) marco.done = true;
    v.cardPickup = (api.story.pickups || []).some(p => /clubcard/i.test(p.model || '')); // easy: the card on the table
    api.lockDoor(doorIdx(api, DOOR.BOUNCER), true); // members only until the pass card is held
    openS(api, CIVILIANS_CITY);
  },

  update(dt, api) {
    const v = api.vars, p = api.playerPos();
    // Phone 102 rings once the player reaches node 1029; answering it brings Marco to the newspaper stand.
    if (!v.ring && api.playerAt(1029, 5)) { v.ring = true; api.msg('A PHONE IS RINGING IN THE BOOTH', 3000); api.sfx('switch'); }
    if (!v.marcoThere && ((v.ring && d2(p, PHONE_102) < 2.2 * 2.2) || api.playerAt(NEWSSTAND, 6))) {
      v.marcoThere = true;
      if (v.ring && d2(p, PHONE_102) < 2.2 * 2.2) api.say(1124, 6000);
    }
    if (!v.warehouse && p.z < -12 && p.x > 30) { v.warehouse = true; openWarehouse(api); }
    // Rendezvous (objective 1), then the escort once O'Leary's is quiet and the player is back with Marco.
    if (v.marcoThere && !v.met && api.playerAt(NEWSSTAND, 4)) rendezvous(api);
    if (v.met && !v.escort && !v.escortDone && api.isDone(OBJ.MEET) && barCleared(api) && api.playerAt(NEWSSTAND, 5)) { v.escortDone = true; startEscort(api); }
    if (v.escort) tickEscort(dt, api);
    // After the card: the office ambush (0x359a18) and the informants (0x359a80) open when the player gets near.
    if (v.hasCard) {
      if (!v.office && api.playerAt(1660, 6)) { v.office = true; openS(api, AMBUSH_OFFICE); }
      for (const j of INFORMANTS) { const s = api.data.spawners[j]; if (s && !v['inf' + j] && api.playerAt(s.node, 40)) { v['inf' + j] = true; openS(api, [j]); } }
    } else {
      if (api.diff === 0 && !v.cardPickup && api.playerAt(9057, 1.5)) gotCard(api); // table pickup failed to load
      if (api.playerAt(1247, 3) && (!v.hint || api.story.time - v.hint > 4)) { v.hint = api.story.time; api.msg('MEMBERS ONLY - YOU NEED THE CLUB PASS CARD', 2500); }
    }
    for (const j of NEAR_FALLBACK) { const s = api.data.spawners[j]; if (s && !v['nf' + j] && api.playerAt(s.node, 14)) { v['nf' + j] = true; openS(api, [j]); } }
    // The informant's call: he must die before he reaches a phone booth or the 30 s run out.
    if (v.informant && !v.callOver) {
      v.callTimer -= dt;
      const ip = botPos(v.informant);
      if (v.informant.dead) { v.callOver = true; api.complete(OBJ.CALL); }
      else if (v.callTimer <= 0 || (ip && PHONES.some(ph => d2(ip, ph) < 6))) { v.callOver = true; api.msg('TONY HAS BEEN WARNED', 3000); api.fail(OBJ.CALL); openS(api, CLUB_GUARDS); }
    }
    // Crystal lying where Big Tony fell (FUN_003b1db0(8)).
    if (v.crystal && !api.isDone(OBJ.CRYSTAL) && d2(p, v.crystal) < 1.6 * 1.6) { api.complete(OBJ.CRYSTAL); api.msg('TIME CRYSTAL RECOVERED', 3000); }
    // Tony's brother leaves when the player steps out of the club.
    if (v.tonyDead && !v.brotherOut && api.isActive(OBJ.BROTHER) && (api.playerAt(1247, 6) || api.playerAt(1253, 6))) brotherRuns(api);
    if (v.brother && api.isActive(OBJ.BROTHER)) {
      v.brotherTimer -= dt;
      const bp = botPos(v.brother), esc = api.node(ESCAPE_NODE);
      if (v.brother.dead) api.after(1.5, () => api.complete(OBJ.BROTHER));
      else if (v.brotherTimer <= 0 || (bp && esc && d2(bp, esc.pos) < 9)) { api.msg("TONY'S BROTHER GOT AWAY", 3000); api.fail(OBJ.BROTHER); }
      if (v.brother.dead || !api.isActive(OBJ.BROTHER)) v.brother = null;
    }
    // Ending: the portal opens once every other main objective is done (FUN_003b1e70(10, 1433)).
    if (!v.portal && api.isDone(OBJ.CRYSTAL) && mainsDone(api)) {
      v.portal = true;
      if (api.isActive(OBJ.CIVIL)) api.complete(OBJ.CIVIL); // TODO(uncertain): its check fns 0x37f6f0/0x37f700 are not in the decompile
      api.reveal(OBJ.PORTAL);
      if (api.node(PORTAL_NODE)) api.portal(PORTAL_NODE); // TODO(uncertain): original node 1433 is not in the table
      else api.after(2, () => api.win());
    }
  },

  on(event, p, api) {
    const v = api.vars;
    if (event === 'destroyed') {
      if (/whiskybarrel/i.test(p.path || '')) barrelDrained(api);
      else if (/gangstersafe\.raw/i.test(p.path || '')) gotCard(api); // the spare card in Tony's safe (normal/hard route)
    } else if (event === 'pickup') {
      if (/clubcard/i.test(p.model || '')) gotCard(api);
      else if (/timecrystal/i.test(p.model || '')) api.complete(OBJ.CRYSTAL);
    } else if (event === 'spawn') {
      if (p.spawner === rt(api, TONY_SPAWNER)) { api.say(1150, 2000); api.after(2, () => api.say(1151, 3000)); }
      else if (!v.informant && INFORMANTS.some(j => rt(api, j) === p.spawner)) {
        v.informant = p.bot; v.callTimer = 30;
        api.reveal(OBJ.CALL); api.msg('AN INFORMANT IS RUNNING FOR A PHONE BOOTH', 3500);
      }
    } else if (event === 'killed') {
      if (p.spawner === rt(api, TONY_SPAWNER) || (p.classIdx === 1 && !v.tonyDead)) tonyKilled(api, p.bot);
      else if (CIVILIAN_CLASSES.includes(p.classIdx)) {
        v.civ++;
        if (api.isActive(OBJ.CIVIL)) { api.count(OBJ.CIVIL, v.civ); api.msg(`CIVILIAN CASUALTIES: ${v.civ}`, 2000); if (v.civ > 4) api.fail(OBJ.CIVIL); } // FUN_0037d7e8
      }
    } else if (event === 'portal') {
      api.complete(OBJ.PORTAL);
    }
  },
};
