// Level 32 "Wild West" (Little Prospect, 1853) — story mission 8.
// Translated from SLUS_203.14 FUN_0038cc48 (setup), FUN_0038d758 (per frame) and the prop/AI callbacks
// around them (FUN_0038cee0 posters, FUN_0038fc08 water barrels, FUN_003d10f8 girl, FUN_003d1888 Ramona,
// FUN_00390170 jail wagon, FUN_0038f350 mine cart vs barrier).
//
// Approximations (the api has no equivalent, see the comments at each site):
//  - Jail: the original blows the cell open with the shootable wagon (easy) or a powder-keg wagon pushed to the
//    wall (normal/hard). Here Ramona is freed by standing at the cell bars for a moment (or destroying the wagon).
//  - Wanted posters are not destructible in the runtime, so a poster counts as torn down when the player
//    walks up to it (a 'destroyed' event for a poster is honoured too).
//  - The barn fire goes out when both roof water barrels (props 115/116) are shot, as in the original; as a
//    fallback the player can beat out the flames by standing in the hay loft for a few seconds.
//  - The mine-cart ride that smashes the barrier (prop 110) is replaced by the barrier giving way when the
//    player reaches it; that needs api.story.props (runtime internals), guarded.
//  - The Colonel's character class is missing from the level tables (classes[4] is null), so he is spawned with
//    the toughest available outlaw class and a big health pool.
//  - Objective 4 ("fight off the Colonel's troops") is absent on every difficulty in the tables, so it is skipped.

const OBJ = { RAMONA: 0, POSTERS: 1, BARN: 2, COLONEL: 3, CRYSTAL: 5, ESCAPE: 6 };
const NODE = { JAIL: 1144, BARN: 1187, LOFT: 1543, MINE_GATE: 1372, COLONEL: 1272, PORTAL: 1588 }; // TODO(uncertain): original portal node 1295 is not in the node table; 1588 is the mine exit next to the crystal.
const DOOR_GATE = 2;                       // objects[2] westerndoublegate, unlocked by FUN_00390138 once the cell is open
const SP = { GIRL: 16, RAMONA: 11, SALOON: [12, 13, 14, 15], BARN: [17, 18], STREET: [21], TROOPS: [46, 47, 48, 49, 50, 51, 52, 53], REAPERS: [55, 56, 57] };
const BARRIER_POS = [30.492, 0.11, 17.38];
const TXT = { HELP: 1176, BRAG: 1178, CHARGE: 1179, COLONEL: 1181, POSTERS: 1174, POSTER: 1175, THANKS: 2657, GO_COLONEL: 2658, THANKS_GIRL: 2655 };

const placed = (cond, diff) => !(cond & 0xc0000) && !!(cond & (0x80 << diff));
const dist2 = (a, b) => { const dx = a.x - b[0], dz = a.z - b[2]; return dx * dx + dz * dz; };

// The runtime keeps spawners at the same indices as data.spawners (null where not placed on this difficulty),
// so JSON indices are used directly; spawnerIdx only reports whether the record exists for this difficulty.
function spawnerIdx(api, dataIdx) {
  const s = (api.data.spawners || [])[dataIdx];
  return s && placed(s.cond, api.diff) && s.char && s.char.model ? dataIdx : -1;
}
const openAll = (api, list) => list.forEach(i => { if (spawnerIdx(api, i) >= 0) api.openSpawner(i); });
const closeAll = (api, list) => list.forEach(i => { if (spawnerIdx(api, i) >= 0) api.closeSpawner(i); });
const mainsDone = api => api.data.objectives.every((o, i) => i === OBJ.ESCAPE || o.cat[api.diff] !== 0 || api.isDone(i));

function postersRemaining(api, v) {
  const left = v.posters.filter(p => !p.down).length;
  api.count(OBJ.POSTERS, v.posters.length - left);
  if (left === 0) api.complete(OBJ.POSTERS);
  else api.msg(`${left} ${api.text(left === 1 ? TXT.POSTER : TXT.POSTERS).toUpperCase()}`, 2500);
}

function freeRamona(api) {
  const v = api.vars;
  if (v.ramonaFreed) return;
  v.ramonaFreed = true;
  api.sfx('switch');
  api.msg(api.text(TXT.THANKS).toUpperCase(), 3000);
  api.after(1.0, a => { a.lockDoor(DOOR_GATE, false); a.openDoor(DOOR_GATE); });
  api.after(2.0, a => { a.complete(OBJ.RAMONA); a.say(TXT.GO_COLONEL); });
  // The gang pours into the street once the gate opens (spawners with the level's own condition).
  api.after(3.0, a => { a.say(TXT.BRAG); openAll(a, SP.SALOON); });
}

function fireOut(api) {
  const v = api.vars;
  if (v.fireOut) return;
  v.fireOut = true;
  api.msg('THE FIRE IS OUT', 2500);
  // FUN_003d10f8: the girl thanks you and runs clear, then FUN_0038f5c0 completes the objective.
  api.after(2.5, a => { if (!a.isDone(OBJ.BARN)) { a.msg(a.text(TXT.THANKS_GIRL).toUpperCase(), 2500); a.complete(OBJ.BARN); openAll(a, SP.STREET); } });
}

function spawnColonel(api) {
  const v = api.vars;
  if (v.colonelSpawned) return;
  v.colonelSpawned = true;
  const classes = api.data.classes || [];
  let cls = 4; // the Colonel's own slot (null in the extracted tables)
  if (!classes[cls]) { cls = -1; let best = -1; classes.forEach((c, i) => { if (c && c.model && c.stats && c.stats[1] > best && i !== 5 && i !== 8 && i !== 9) { best = c.stats[1]; cls = i; } }); }
  const hp = [320, 450, 600][api.diff] || 450;
  v.colonel = cls >= 0 ? api.spawn(cls, NODE.COLONEL, { hp, weapon: 'magnum', skill: 2 }) : null;
  api.say(TXT.COLONEL);
  // FUN_003d12f8: he runs to the alarm chain and rings the bell; the troops (spawners 46-53) answer.
  api.after(6.0, a => { if (a.isDone(OBJ.COLONEL)) return; a.vars.alarmRung = true; a.say(TXT.CHARGE); a.anim(300); openAll(a, SP.TROOPS); });
}

function colonelDown(api) {
  if (api.isDone(OBJ.COLONEL)) return;
  api.complete(OBJ.COLONEL);
  closeAll(api, SP.TROOPS); // the gang gives up without him
}

function knockBarrier(api) {
  const v = api.vars;
  if (v.barrierDown) return;
  v.barrierDown = true;
  const S = api.story;
  if (S && S.props && S.world) {
    for (const p of S.props) {
      if (!p || p.dead || !p.rec || !/westernbarrier/i.test(p.rec.path || '')) continue;
      p.dead = true; p.group.visible = false;
      S.world.solid = S.world.solid.filter(m => m.parent !== p.group);
      if (S.hooks && S.hooks.explode) S.hooks.explode(p.group.position, true);
    }
  }
  api.msg('THE BARRIER GIVES WAY', 2500);
}

function tryEnding(api) {
  const v = api.vars;
  if (v.ending || !mainsDone(api)) return;
  v.ending = true;
  api.reveal(OBJ.ESCAPE);
  if (api.node(NODE.PORTAL)) api.portal(NODE.PORTAL);
  else api.after(2.0, a => a.win()); // no node to stand the portal on
}

export default {
  manualEnd: true,

  setup(api) {
    const v = api.vars;
    const d = api.data;
    // FUN_0038cc48: show 0, 1, 3, 5 at once; 2 and 6 are revealed later.
    v.posters = (d.props || []).filter(p => placed(p.cond, api.diff) && /wantedposter/i.test(p.path || '')).map(p => ({ pos: p.pos, down: false }));
    api.reveal(OBJ.RAMONA);
    api.reveal(OBJ.POSTERS, v.posters.length);
    api.reveal(OBJ.COLONEL);
    api.reveal(OBJ.CRYSTAL);
    v.fires = (d.props || []).filter(p => placed(p.cond, api.diff) && /heybail/i.test(p.path || '')).length || 3;
    v.firesOut = 0; v.barrels = {};
    v.jailHold = 0; v.loftHold = 0; v.posterHold = 0;
    v.girlSpawner = spawnerIdx(api, SP.GIRL);
    v.ramonaSpawner = spawnerIdx(api, SP.RAMONA);
    if (v.girlSpawner >= 0) api.openSpawner(v.girlSpawner); // she is in the loft from the start
  },

  update(dt, api) {
    const v = api.vars;
    const pp = api.playerPos();
    if (!pp) return;

    // Jail: standing at the cell bars frees Ramona (approximation of blowing the wall).
    if (!v.ramonaFreed && !api.isDone(OBJ.RAMONA)) {
      if (api.playerAt(NODE.JAIL, 4.5)) { v.jailHold += dt; if (v.jailHold > 1.5) freeRamona(api); }
      else v.jailHold = 0;
    }

    // Posters: tear one down by walking up to it.
    if (!api.isDone(OBJ.POSTERS) && v.posters.length) {
      const near = v.posters.find(p => !p.down && dist2(pp, p.pos) < 2.2 * 2.2 && Math.abs(pp.y - p.pos[1]) < 3);
      if (near) { v.posterHold += dt; if (v.posterHold > 0.5) { near.down = true; v.posterHold = 0; api.sfx('switch'); postersRemaining(api, v); } }
      else v.posterHold = 0;
    }

    // Barn: the cry for help reveals the objective when the player gets near (FUN_0038d758 message 1176).
    if (!v.barnRevealed && api.playerAt(NODE.BARN, 14)) {
      v.barnRevealed = true;
      api.say(TXT.HELP);
      api.reveal(OBJ.BARN);
      openAll(api, SP.BARN);
    }
    // Fallback: beat the flames out from the hay loft if the barrels cannot be shot.
    if (v.barnRevealed && !v.fireOut && !api.isDone(OBJ.BARN)) {
      if (api.playerAt(NODE.LOFT, 2.5)) { v.loftHold += dt; if (v.loftHold > 4) fireOut(api); } // TODO(uncertain)
      else v.loftHold = 0;
    }

    // The Colonel waits at the mine; he shows himself when the player reaches the mine gate.
    if (!v.colonelSpawned && (api.playerAt(NODE.MINE_GATE, 6) || api.playerAt(NODE.COLONEL, 8))) spawnColonel(api);
    if (v.colonelSpawned && !api.isDone(OBJ.COLONEL)) {
      if (!v.colonel) { if (api.playerAt(NODE.COLONEL, 3)) colonelDown(api); } // spawn failed: reaching his post counts
      else if (v.colonel.dead) colonelDown(api);
    }

    // Mine barrier (stand-in for the runaway mine cart).
    if (!v.barrierDown && dist2(pp, BARRIER_POS) < 7 * 7 && Math.abs(pp.y - BARRIER_POS[1]) < 4) knockBarrier(api);

    tryEnding(api);
  },

  on(event, p, api) {
    const v = api.vars;
    if (event === 'destroyed') {
      const path = p.path || '';
      const rid = p.prop && p.prop.rec ? p.prop.rec.id : -1;
      if (/wantedposter/i.test(path) && !api.isDone(OBJ.POSTERS)) {
        const pos = p.prop.group.position;
        let best = null, bd = 9;
        for (const q of v.posters) { if (q.down) continue; const dd = dist2(pos, q.pos); if (dd < bd) { bd = dd; best = q; } }
        if (best) { best.down = true; postersRemaining(api, v); }
      } else if (/hugebarrel/i.test(path) && !v.fireOut) {
        // FUN_0038fc08: barrel 115 douses hay 113, barrel 116 douses hay 112 and 114.
        const key = rid === 115 ? 'a' : rid === 116 ? 'b' : 'x' + (p.index || 0);
        if (!v.barrels[key]) { v.barrels[key] = true; v.firesOut += rid === 116 ? 2 : 1; api.msg('WATER DOUSES THE FLAMES', 2000); }
        if (v.firesOut >= v.fires) fireOut(api);
      } else if (/shootablewagon|westernwagon/i.test(path)) {
        freeRamona(api); // FUN_00390170: the blast opens the cell
      }
    } else if (event === 'killed') {
      if (v.colonel && p.bot === v.colonel) colonelDown(api);
      else if (p.spawner >= 0 && p.spawner === v.girlSpawner && !api.isDone(OBJ.BARN)) { api.msg('THE GIRL WAS KILLED', 3000); api.fail(OBJ.BARN); }
      else if (p.spawner >= 0 && p.spawner === v.ramonaSpawner && !api.isDone(OBJ.RAMONA)) { api.msg('RAMONA WAS KILLED', 3000); api.fail(OBJ.RAMONA); }
    } else if (event === 'pickup') {
      if (/timecrystal/i.test(p.model || '') || (p.kind === 'item' && /crystal/i.test(p.model || ''))) {
        api.complete(OBJ.CRYSTAL);
        openAll(api, SP.REAPERS); // FUN_00359ce0: the mine's guardians wake once the crystal is taken
        tryEnding(api);
      }
    } else if (event === 'portal') {
      api.complete(OBJ.ESCAPE);
      api.win();
    }
  },
};
