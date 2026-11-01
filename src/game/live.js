// Live-ball tick: input -> intent -> movement, ball flight, catches, tackles, whistle.
import { FIELD, MOVE, RECEIVERS, PHASE } from './constants.js';
import { kickFactor, meterWave } from './constants.js';
import { dist, dist2, nearest, clamp, maxSpeed, steer, integrate, setState } from './entity.js';
import { offenseBrain, defenseBrain } from './ai.js';

export function attackTeam(g) {
  const b = g.ball, c = g.carrier();
  if (c) return c.team;
  if ((b.inAir || b.loose) && b.thrower) return (b.kind === 'punt' || b.kind === 'kick') ? 1 - b.thrower.team : b.thrower.team;
  return g.poss;
}

export function liveTick(g, dt, presnap) {
  const at = attackTeam(g);
  const off = g.ents[at], def = g.ents[1 - at];
  const all = [...off, ...def];
  const dead = g.phase === PHASE.DEAD;

  // 1. decide intents
  const intents = new Map();
  for (const e of all) {
    const human = g.human[e.team] && g.ctrl[e.team] === e.idx;
    let m;
    if (human) m = humanIntent(g, e, g.inputs[e.team], presnap);
    else if (presnap) m = presnapAI(g, e);
    else if (dead) m = deadAI(g, e);
    else m = e.team === at ? offenseBrain(g, e, off, def, dt) : defenseBrain(g, e, off, def, dt);
    intents.set(e, m || { dx: 0, dy: 0, mag: 0 });
  }
  if (presnap) {
    for (const e of g.offense()) { intents.set(e, { dx: 0, dy: 0, mag: 0 }); }   // offense is set
  }

  // 2. apply actions + move
  for (const e of all) {
    const m = intents.get(e);
    e.turboOn = !!m.turbo && e.turbo > 0 && !presnap;
    if (e.turboOn) e.turbo = Math.max(0, e.turbo - g.rules.turboDrain * dt);
    else e.turbo = Math.min(g.rules.turboMax, e.turbo + g.rules.turboRegen * dt);
    if (m.action && !presnap) doAction(g, e, m);
    const top = maxSpeed(e, g.rules, g.fire[e.team]);
    steer(e, m.dx, m.dy, m.mag, dt, top);
    integrate(e, dt);
    if (e.state === 'jump') e.z = Math.sin((1 - e.st / MOVE.jumpTime) * Math.PI) * 1.4;
    else if (e.state === 'dive') e.z = Math.sin((1 - e.st / MOVE.diveTime) * Math.PI) * 0.6;
    else e.z = 0;
  }

  // 3. blocking: blockers engage rushers
  if (!presnap && !dead) resolveBlocks(g, off, def, dt);
  g.attack = at;

  // 4. ball
  const b = g.ball;
  if (b.inAir) flyBall(g, dt);
  else if (b.loose) looseBall(g, dt);
  else {
    const c = g.carrier();
    if (c) { b.x = c.x; b.y = c.y; b.z = 1 + c.z; }
    // kicker: punt / field goal after the hold
    if (!dead && g.special && g.special !== 'kickoff' && g.special !== 'pat2' && c && c.task === 'kicker') {
      const m = g.meter;
      if (m) { m.t += dt; m.val = meterWave(m.t / m.dur); if (g.inputs[g.poss].a && m.t > 0.25) doKick(g, c, m.val); else if (m.t > 3 * m.dur) doKick(g, c, 0.6 + Math.random() * 0.35); }
      else { g.kickT -= dt; if (g.kickT <= 0) doKick(g, c); }
    }
    // run-play handoff
    if (!dead && c && c.role === 'QB' && g.playType === 'run' && !g.handedOff) {
      const rb = g.offense()[g.offPlay.carrier];
      if (rb && rb !== c && dist(rb, c) < 1.6 && g.liveT > 0.25) { g.giveBall(g.poss, rb.idx); g.handedOff = true; rb.task = 'path'; if (g.human[g.poss]) g.ctrl[g.poss] = rb.idx; }
    }
  }

  // 5. tackles / sideline / scoring
  if (!presnap) resolveContact(g, off, def, dt);
  if (!presnap && !dead) checkCarrierSpot(g);
}

// ---------- intents ----------
function humanIntent(g, e, inp, presnap) {
  const m = { dx: inp.mx, dy: inp.my, mag: Math.min(1, Math.hypot(inp.mx, inp.my)), turbo: inp.turbo, action: null };
  if (m.mag > 0) { m.dx /= m.mag; m.dy /= m.mag; }
  if (presnap) return e.team === g.poss ? { dx: 0, dy: 0, mag: 0 } : m;
  const offense = e.team === g.poss;
  // Assist: with the stick centered, a return man or the targeted receiver tracks the ball himself.
  const b = g.ball;
  if (m.mag < 0.1 && !e.hasBall && ((b.inAir && (b.target === e.idx || e.task === 'return')) || (b.loose && e.task === 'return'))) {
    const tx = b.inAir ? b.landX : b.x, ty = b.inAir ? b.landY : b.y;
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    if (d > 0.4) { m.dx = dx / d; m.dy = dy / d; m.mag = 1; m.turbo = true; }
  }
  if (offense) {
    if (e.hasBall) {
      if (e.task === 'kicker') { /* A belongs to the kick meter */ }
      else if (e.role === 'QB' && !g.handedOff && g.playType === 'pass') {
        if (inp.pass >= 0) { m.action = 'pass'; m.target = RECEIVERS[inp.pass]; }
        else if (inp.a) m.action = 'dive';
        else if (inp.b) m.action = 'spin';
      } else {
        if (inp.pass >= 0) m.action = 'lateral';
        else if (inp.a) m.action = 'dive';
        else if (inp.b) m.action = 'spin';
      }
    } else {
      if (inp.a) m.action = 'jump';
      if (inp.sw && g.ball.inAir) { /* switch to receiver handled on throw */ }
    }
  } else {
    if (inp.a) m.action = 'dive';
    if (inp.b) m.action = 'tackle';
    if (inp.sw) switchDefender(g, e.team);
  }
  return m;
}

function presnapAI(g, e) {
  if (e.team === g.poss) return null;
  return { dx: 0, dy: 0, mag: 0 };
}
function deadAI(g, e) {
  // after the whistle: defenders near the pile keep piling on (late hits); everyone else slows
  const c = g.carrier();
  if (!c || e.team === g.poss || !g.rules.lateHits) return { dx: 0, dy: 0, mag: 0 };
  const d = dist(e, c);
  if (d < 6 && Math.random() < 0.6 && g.deadT < 1.2) {
    const dx = c.x - e.x, dy = c.y - e.y, l = Math.hypot(dx, dy) || 1;
    return { dx: dx / l, dy: dy / l, mag: 1, turbo: true, action: d < 2.2 && e.state !== 'dive' ? 'dive' : null };
  }
  return { dx: 0, dy: 0, mag: 0 };
}

function switchDefender(g, team) {
  const b = g.ball; const list = g.ents[team];
  const [n] = nearest(list, b.x, b.y, e => e.idx !== g.ctrl[team] && e.state !== 'down');
  if (n) g.ctrl[team] = n.idx;
}

// ---------- actions ----------
function doAction(g, e, m) {
  const a = m.action;
  if (a === 'dive' && e.state !== 'dive' && e.state !== 'down' && e.st <= 0) { setState(e, 'dive', MOVE.diveTime); e.afterDive = true; return; }
  if (a === 'jump' && e.st <= 0 && e.state !== 'down') { setState(e, 'jump', MOVE.jumpTime); return; }
  if (a === 'spin' && e.st <= 0 && e.hasBall) { setState(e, 'spin', MOVE.spinTime); e.burstT = 0.6; return; }
  if (a === 'stiff' && e.st <= 0 && e.hasBall) { setState(e, 'stiff', MOVE.stiffArmTime); return; }
  if (a === 'block' && e.engaged < 0) { /* engagement resolved in resolveBlocks */ return; }
  if (a === 'tackle') { e.tackling = 0.25; return; }
  if (a === 'pass' && e.hasBall && e.state !== 'down') { throwPass(g, e, m.target); return; }
  if (a === 'lateral' && e.hasBall) { lateral(g, e); return; }
  if (a === 'scramble' && e.hasBall) { g.handedOff = true; e.task = 'path'; e.route = null; return; }
}

function throwPass(g, qb, target) {
  const off = g.offense();
  const r = off[target];
  if (!r || r === qb) return;
  g.stats.team[g.poss].att++;
  const dir = g.dir[g.poss];
  // lead the receiver along his velocity by the flight time
  const d0 = dist(qb, r);
  const bullet = d0 < 22;
  const v = bullet ? MOVE.ballSpeedBullet : MOVE.ballSpeedLob;
  let t = Math.max(0.35, d0 / v);
  let tx = r.x + r.vx * t * 0.9, ty = r.y + r.vy * t * 0.9;
  if (r.task === 'route' && r.route && r.wp < r.route.length) {
    // aim toward where the route is going rather than where he is drifting
    const [wx, wy] = r.route[r.wp]; const dd = dist2(r.x, r.y, wx, wy);
    if (dd > 2) { const k = Math.min(1, (maxSpeedGuess(r) * t) / dd); tx = r.x + (wx - r.x) * k; ty = r.y + (wy - r.y) * k; }
  }
  tx = clamp(tx, FIELD.minX + 1, FIELD.maxX - 1); ty = clamp(ty, 0.5, FIELD.width - 0.5);
  g.throwBall(qb, tx, ty, bullet ? 'bullet' : 'lob', bullet ? 1.0 : 1.3);
  setState(qb, 'throw', 0.5);
  g.ball.target = target;
  g.ball.thrownBy = qb.idx;
  g.say(`${g.teams[g.poss].abbr} QB throws to ${RECEIVERS.indexOf(target) >= 0 ? ['A', 'B', 'C', 'D'][RECEIVERS.indexOf(target)] : '?'}`);
  g.emit('sound', { name: 'throw' });
  if (g.human[g.poss]) g.ctrl[g.poss] = target;
}
function maxSpeedGuess(e) { return MOVE.speed[e.role] * e.spd * 1.15; }

function lateral(g, c) {
  const off = g.offense(); const dir = g.dir[g.poss];
  let best = null, bd = 1e9;
  for (const o of off) { if (o === c || o.state === 'down') continue; if ((o.x - c.x) * dir > 0.5) continue; const d = dist(o, c); if (d < bd && d < 18) { bd = d; best = o; } }
  if (!best) return;
  g.throwBall(c, best.x + best.vx * 0.3, best.y + best.vy * 0.3, 'lob', 1.0, 22);
  g.ball.target = best.idx; g.ball.lateral = true;
  if (g.human[g.poss]) g.ctrl[g.poss] = best.idx;
  g.say('Lateral!');
}

function doKick(g, k, pf = null) {
  const dir = g.dir[g.poss];
  const f = kickFactor(pf);
  g.meter = null;
  if (g.special === 'punt') {
    const power = MOVE.puntPower * f.power;
    const tx = clamp(k.x + dir * power, FIELD.minX + 2, FIELD.maxX - 2), ty = clamp(k.y + (Math.random() * 16 - 8) * f.spread, 3, FIELD.width - 3);
    g.throwBall(k, tx, ty, 'punt', 2.2, power / 1.1);
    g.ball.target = 6; g.punted = true;
    g.say(`${g.teams[g.poss].abbr} punts.`); g.emit('sound', { name: 'kick' });
    return;
  }
  // field goal / PAT: fly at the uprights, decide by distance (+ a little luck)
  const goal = g.goalLineFor(g.poss);
  const distYds = Math.abs(goal - k.x) + 10;
  let p = g.special === 'pat' ? 0.96 : clamp(1.15 - distYds / 62, 0.05, 0.97);
  if (pf !== null) p = pf >= 0.75 ? Math.min(0.99, p + 0.08) : p * (pf / 0.75) * 0.8;   // sweet spot helps, a weak press hurts
  const reach = pf === null ? 22 : 22 * (0.3 + 0.7 * pf) - Math.max(0, distYds - 45) * (1 - pf);
  const good = Math.random() < p && reach > 2;
  const ty = FIELD.mid + (good ? (Math.random() * 6 - 3) : (Math.random() < 0.5 ? -13 : 13));
  g.throwBall(k, goal + dir * reach, ty, 'kick', 2.1, 52 * (pf === null ? 1 : 0.7 + 0.3 * pf));
  g.ball.target = -1; g.ball.fgGood = good;
  g.emit('sound', { name: 'kick' });
}

// ---------- ball flight ----------
function flyBall(g, dt) {
  const b = g.ball;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vz -= MOVE.gravity * dt;
  b.landT -= dt; b.flightT = (b.flightT || 0) + dt;
  const off = g.offense(), def = g.defense();
  const all = [...off, ...def];
  // field goal / PAT resolve when it crosses the goal line plane
  if (b.kind === 'kick' && b.target === -1) {
    const goal = g.goalLineFor(g.poss), dir = g.dir[g.poss];
    if ((b.x - goal) * dir >= 0 || b.z <= 0) {
      b.inAir = false;
      if (b.fgGood) { g.endPlay('score', goal, b.y); g.say(g.special === 'pat' ? 'Extra point is good!' : 'Field goal is GOOD!'); g.emit('sound', { name: 'fgood' }); }
      else { g.endPlay('miss', g.los, b.y); g.emit('sound', { name: 'doink' }); }
      return;
    }
    return;
  }
  // catch attempts: anyone within reach while ball is at catchable height
  const grace = (b.kind === 'kick' || b.kind === 'punt') ? 0.45 : 0.22;
  if (b.z < 2.9 && b.flightT > grace) {
    let best = null, bd = 1e9;
    for (const e of all) {
      if (e.state === 'down' || e.state === 'tackled') continue;
      if (b.thrower && e.team === b.thrower.team && e.idx === b.thrower.idx && b.landT > -0.2 && !b.lateral) continue;
      const reach = (e.state === 'jump' ? 1.2 : 0) + (e.state === 'dive' ? 0.8 : 0);
      const d = dist2(e.x, e.y, b.x, b.y);
      const zOk = b.z < 2.2 + reach + e.z;
      if (d < MOVE.catchRadius + reach * 0.4 && zOk && d < bd) { bd = d; best = e; }
    }
    if (best) {
      const isOff = best.team === g.poss;
      const [nd, ndd] = nearest(isOff ? def : off, best.x, best.y);
      let p = isOff ? 0.8 * best.hands : 0.11 * best.hands;
      if (b.kind === 'kick' || b.kind === 'punt') p = 0.98;
      if (isOff && best.idx === b.target) p += 0.15;
      if (nd && ndd < 1.3) p -= isOff ? 0.25 : 0;
      if (!isOff && best.state === 'jump') p += 0.12;
      if (!isOff && b.kind === 'lob' && b.landT < 0) p += 0.08;   // floated balls get picked
      if (g.fire[best.team]) p += 0.1;
      if (g.psychic && !isOff) p += 0.25;
      if (Math.random() < p) { catchBall(g, best); return; }
      // bobble / deflect: ball drops dead or bounces loose
      if (!isOff && (b.kind === 'bullet' || b.kind === 'lob') && Math.random() < 0.55) { b.inAir = false; g.endPlay('incomplete', g.los, FIELD.mid); g.say('Broken up!'); g.emit('sound', { name: 'incomplete' }); return; }
      b.vx *= 0.3; b.vy *= 0.3; b.vz = 2; b.deflected = true; b.target = -1;
      best.shaken = 0.4;
    }
  }
  if (b.z <= 0) {
    b.z = 0;
    if (b.kind === 'kick' || b.kind === 'punt') {
      // kick on the ground: touchback if past the receiving goal line, else live loose ball for the return man
      const goal = g.ownGoalFor(g.poss), dir = g.dir[g.poss];
      if ((goal - b.x) * dir >= 0 || b.x <= FIELD.minX + 1 || b.x >= FIELD.maxX - 1) { b.inAir = false; g.endPlay('touchback', b.x, b.y); g.say('Touchback.'); return; }
      if (b.y < 0 || b.y > FIELD.width) { b.inAir = false; g.endPlay('oob', b.x, b.y); return; }
      b.inAir = false; b.loose = true; b.vx *= 0.5; b.vy *= 0.5; b.vz = 6 + Math.random() * 6; b.bounces = 0;
      return;
    }
    b.inAir = false;
    if (b.lateral) { b.loose = true; b.vz = 4; b.bounces = 0; g.say('Lateral hits the turf! Live ball!'); return; }
    g.endPlay('incomplete', g.los, FIELD.mid); g.say('Incomplete.'); g.emit('sound', { name: 'incomplete' });
  }
}

function catchBall(g, e) {
  const b = g.ball;
  const wasOff = e.team === g.poss;
  g.giveBall(e.team, e.idx);
  if (wasOff && (b.kind === 'bullet' || b.kind === 'lob') && !b.lateral) { g.catcher = { team: e.team, idx: e.idx }; g.stats.team[e.team].comp++; }
  b.lateral = false;
  e.task = 'carry'; e.route = null;
  if (e.state !== 'jump' && e.state !== 'dive') setState(e, 'catch', 0.3);
  if (!wasOff) {
    // interception, or a punt fielded by the return man: possession flips
    if (b.kind === 'bullet' || b.kind === 'lob') { g.banner('INTERCEPTION!', ''); g.say('Picked off!'); g.emit('sound', { name: 'pick' }); g.stats.team[1 - e.team].int++; g.stat(e, 'ints'); g.special = null; g.intercepted = true; }
    g.poss = e.team;
    g.caught = true; g.handedOff = true;
    for (const t of g.ents) for (const o of t) { if (o.team === e.team) { if (o !== e) o.task = 'block'; } else o.task = 'pursue'; }
    if (g.human[e.team]) g.ctrl[e.team] = e.idx;
    if (g.human[1 - e.team]) switchDefender(g, 1 - e.team);
    return;
  }
  g.caught = true; g.handedOff = true;
  if (b.kind === 'bullet' || b.kind === 'lob') { g.emit('sound', { name: 'catch' }); }
  for (const o of g.offense()) if (o !== e && o.role !== 'QB') o.task = 'block';
  if (g.human[e.team]) g.ctrl[e.team] = e.idx;
}

function looseBall(g, dt) {
  const b = g.ball;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vz -= MOVE.gravity * dt;
  b.vx *= (1 - 1.2 * dt); b.vy *= (1 - 1.2 * dt);
  if (b.z <= 0) { b.z = 0; b.vz = -b.vz * 0.45; b.bounces = (b.bounces || 0) + 1; if (b.vz < 1) b.vz = 0; }
  if (b.y < -0.5 || b.y > FIELD.width + 0.5) { b.loose = false; g.endPlay('oob', clamp(b.x, 1, 99), b.y); g.say('Ball out of bounds.'); return; }
  // recovery
  const all = [...g.offense(), ...g.defense()];
  for (const e of all) {
    if (e.state === 'down') continue;
    if (dist2(e.x, e.y, b.x, b.y) < 0.9 && b.z < 1.4) {
      const wasOff = e.team === g.poss;
      b.loose = false;
      g.giveBall(e.team, e.idx); e.task = 'carry';
      const kickBall = b.kind === 'kick' || b.kind === 'punt';
      if (!wasOff) { g.poss = e.team; if (!kickBall) { g.special = null; g.intercepted = true; g.banner('FUMBLE!', 'RECOVERED BY ' + g.teams[e.team].abbr); } else g.say(`${g.teams[e.team].abbr} picks up the kick.`); }
      for (const t of g.ents) for (const o of t) o.task = o.team === e.team ? (o === e ? 'carry' : 'block') : 'pursue';
      g.caught = true; g.handedOff = true;
      if (g.human[e.team]) g.ctrl[e.team] = e.idx;
      return;
    }
  }
}

// ---------- blocking ----------
function resolveBlocks(g, off, def, dt) {
  for (const o of off) {
    if (o.task !== 'block' || o.hasBall || o.state === 'down') continue;
    if (o.engaged >= 0) {
      const d = def[o.engaged];
      o.engT -= dt;
      if (!d || d.state === 'down' || o.engT <= 0 || dist(o, d) > 2.4) { o.engaged = -1; if (d) d.blocked = 0; continue; }
      d.blocked = 0.1;
      // drive the rusher away from the man we protect
      const push = 0.9 * dt; const dx = d.x - o.x, dy = d.y - o.y, l = Math.hypot(dx, dy) || 1;
      d.x += (dx / l) * push; d.y += (dy / l) * push;
      continue;
    }
    const [d, dd] = nearest(def, o.x, o.y, x => x.state !== 'down' && x.blocked <= 0 && !x.hasBall && x.state !== 'jump');
    const passPro = g.playType === 'pass' && !g.handedOff && !g.caught;
    if (d && dd < (passPro ? 2.3 : 1.6)) {
      const r = Math.random();
      const win = r < (passPro ? 0.85 : 0.72) * o.pow / d.pow;
      if (win) { o.engaged = d.idx; o.engT = 1.2 + Math.random() * 1.6; d.blocked = 0.1; }
      else if (r > 0.92) { setState(o, 'down', 1.0); }         // pancaked
      else { o.shaken = 0.5; o.blocked = 0.4; }                 // beaten, slowed a beat
    }
  }
}

// ---------- contact ----------
function resolveContact(g, off, def, dt) {
  const c = g.carrier();
  if (!c) return;
  const dead = g.phase === PHASE.DEAD;
  const defenders = c.team === g.poss ? def : off;
  for (const d of defenders) {
    if (d.state === 'down' || d.state === 'tackled') continue;
    const dd = dist(d, c);
    const reach = d.state === 'dive' ? 1.9 : MOVE.tackleRange;
    if (dd > reach) continue;
    if (dead) {
      // late hit: knock the carrier again, no consequence (penalties: false)
      if (d.state === 'dive' || d.tackling > 0) { d.tackling = 0; setState(d, 'down', 0.8); g.stats.hits[d.team]++; g.emit('sound', { name: 'hit' }); g.emit('latehit', {}); if (Math.random() < 0.2) g.say('LATE HIT! No flag in Blitz.'); }
      continue;
    }
    if (c.state === 'jump' && d.state !== 'jump' && d.state !== 'dive') continue;   // hurdled
    // tackle resolution
    let p = 0.55;
    p += (d.pow - c.pow) * 0.8;
    if (d.state === 'dive') p += 0.25;
    if (d.tackling > 0) p += 0.15;
    if (c.state === 'spin' || c.state === 'stiff') p -= 0.35;
    if (c.turboOn) p -= 0.08;
    if (c.burstT > 0) p -= 0.15;
    if (g.fire[c.team]) p -= 0.2;
    if (g.fire[d.team]) p += 0.15;
    if (c.role === 'QB' && !g.handedOff) p += 0.2;
    if (Math.random() < clamp(p, 0.08, 0.95)) {
      // down. fumble on big hits
      const big = d.state === 'dive' && Math.random() < 0.5;
      g.stats.hits[d.team]++;
      g.emit('sound', { name: big ? 'bighit' : 'hit' });
      if (Math.random() < (big ? 0.08 : 0.025) && !g.special && g.rules.fumbles !== false) {
        g.dropBall(); const b = g.ball; b.loose = true; b.vx = (Math.random() - 0.5) * 6; b.vy = (Math.random() - 0.5) * 6; b.vz = 7; b.bounces = 0;
        setState(c, 'down', 1.0); setState(d, 'down', 0.6); g.say('FUMBLE!'); g.stats.team[c.team].fum++; g.emit('sound', { name: 'fumble' });
        return;
      }
      setState(d, d.state === 'dive' ? 'down' : 'hit', 0.8);
      g.stat(d, 'tackles');
      finishCarrier(g, c, 'tackle');
      if (big) g.banner(['BIG HIT!', 'CRUSHED!', 'OUCH!', 'PANCAKE!'][(Math.random() * 4) | 0], '');
      return;
    }
    // broken tackle: defender falls
    setState(d, 'down', 0.9); d.shaken = 1;
    c.burstT = 0.5;
    g.emit('sound', { name: 'break' });
    if (Math.random() < 0.3) g.say('Breaks the tackle!');
  }
  if (c.tackling > 0) c.tackling -= dt;
  for (const d of defenders) if (d.tackling > 0) d.tackling -= dt;
}

function finishCarrier(g, c, reason) {
  g.endPlay(reason, c.x, c.y);
}

function checkCarrierSpot(g) {
  const c = g.carrier();
  if (!c) return;
  const dir = g.dir[c.team];
  const goal = g.goalLineFor(c.team), own = g.ownGoalFor(c.team);
  if (c.y < 0 || c.y > FIELD.width) { g.endPlay('oob', clamp(c.x, 0.5, 99.5), c.y); g.say('Out of bounds.'); return; }
  if ((c.x - goal) * dir >= 0) {
    if (g.special === 'kickoff' && !g.caught) return;
    g.endPlay('score', goal, c.y);
    g.banner('TOUCHDOWN!', g.teams[c.team].city.toUpperCase());
    g.say(`TOUCHDOWN ${g.teams[c.team].city}!`); g.emit('sound', { name: 'touchdown' });
    return;
  }
  if ((own - c.x) * dir >= 0 && c.team === g.poss && g.caught && !g.special) { g.endPlay('safety', own, c.y); g.say('SAFETY!'); return; }
  // returner tackled in own end zone on a kick = touchback
  if ((own - c.x) * dir >= 0 && (g.special === 'kickoff' || g.special === 'punt') && c.state === 'tackled') { g.endPlay('touchback', own, c.y); }
}
