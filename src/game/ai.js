// CPU brains for everyone the humans are not controlling. Each function returns a desired move
// {dx, dy, mag, turbo, action} for one entity for this tick. The sim applies it like a joystick.
import { dist, dist2, nearest, clamp } from './entity.js';
import { RECEIVERS } from './constants.js';

const toward = (e, x, y, mag = 1) => {
  const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy) || 1;
  return { dx: dx / d, dy: dy / d, mag: d < 0.3 ? 0 : mag, dist: d };
};
const idle = () => ({ dx: 0, dy: 0, mag: 0 });

// ---------- OFFENSE ----------
export function offenseBrain(g, e, off, def, dt) {
  const ball = g.ball;
  const carrier = g.carrier();
  const dir = g.dir[e.team];

  if (e.hasBall) return carrierBrain(g, e, off, def);
  if (ball.loose && dist2(e.x, e.y, ball.x, ball.y) < 12) return { ...toward(e, ball.x, ball.y, 1), turbo: true };
  if (e.task === 'return') {
    if (ball.inAir) return { ...toward(e, ball.landX, ball.landY, 1), turbo: true };
    return idle();
  }

  // After the ball is caught / handed off, everyone else becomes a blocker downfield.
  if (carrier && carrier.team === e.team && carrier !== e && e.role !== 'QB' && (g.handedOff || g.caught)) return blockBrain(g, e, def, carrier);

  if (e.role === 'QB' && !e.hasBall) {
    // QB after throw: trail the play
    if (ball.inAir) return idle();
    if (carrier) return toward(e, carrier.x - dir * 6, carrier.y, 0.6);
    return idle();
  }

  if (e.task === 'route' && e.route) {
    const [tx, ty] = e.route[Math.min(e.wp, e.route.length - 1)];
    const m = toward(e, tx, ty, 1);
    if (m.dist < 1.0 && e.wp < e.route.length - 1) e.wp++;
    // Ball thrown at me: go get it.
    if (ball.inAir && ball.target === e.idx) return { ...toward(e, ball.landX, ball.landY, 1), turbo: true, action: ball.landT < 0.25 && ball.landZ > 2.0 ? 'jump' : null };
    if (ball.inAir && ball.target !== e.idx) return idle();
    return { ...m, turbo: e.wp > 0 };
  }
  if (e.task === 'block') return blockBrain(g, e, def, carrier || g.qb());
  if (e.task === 'path' && e.route) {
    // run-play carrier before the handoff (RB going to the mesh point)
    const [tx, ty] = e.route[Math.min(e.wp, e.route.length - 1)];
    const m = toward(e, tx, ty, 1);
    if (m.dist < 0.8 && e.wp < e.route.length - 1) e.wp++;
    return m;
  }
  return idle();
}

function blockBrain(g, e, def, protect) {
  if (!protect) return idle();
  const dir = g.dir[e.team];
  const passPro = protect.role === 'QB' && protect.hasBall && !g.handedOff;
  // Pick the most dangerous unblocked defender near the man we protect, and get between them.
  let best = null, bs = 1e9;
  for (const d of def) {
    if (d.state === 'down' || d.state === 'tackled') continue;
    const dd = dist(d, protect);
    const ahead = (d.x - protect.x) * dir;            // defenders downfield of the carrier matter more
    let score = dd - (ahead > 0 && !passPro ? 3 : 0) + (d.engaged >= 0 ? 8 : 0) + (d.blocked > 0 ? 6 : 0);
    if (passPro && d.task !== 'rush' && dd > 6) score += 20;     // in pass pro, only rushers matter
    score += dist(d, e) * 0.35;                        // prefer the one closest to me
    if (score < bs) { bs = score; best = d; }
  }
  if (!best) return idle();
  if (e.engaged >= 0) { const d = def[e.engaged]; if (d) return { ...toward(e, d.x, d.y, 1), action: null }; }
  // stand on the line between the threat and the man we protect, a step in front of the threat
  const vx = best.x - protect.x, vy = best.y - protect.y, vl = Math.hypot(vx, vy) || 1;
  const gap = Math.min(vl - 0.9, passPro ? 2.2 : 1.6);
  const tx = protect.x + (vx / vl) * Math.max(0.8, gap), ty = protect.y + (vy / vl) * Math.max(0.8, gap);
  const dme = dist(e, best);
  const m = dme < 2.0 ? toward(e, best.x, best.y, 1) : toward(e, tx, ty, 1);
  return { ...m, turbo: dme > 3, action: dme < 1.6 && e.engaged < 0 ? 'block' : null };
}

function carrierBrain(g, e, off, def) {
  const dir = g.dir[e.team];
  if (e.role === 'QB' && g.playType === 'pass' && !g.handedOff) return qbBrain(g, e, off, def);
  // Ball carrier: follow the designed path, then find daylight.
  let tx, ty;
  if (e.task === 'path' && e.route && e.wp < e.route.length) {
    [tx, ty] = e.route[e.wp];
    if (dist2(e.x, e.y, tx, ty) < 1.2) e.wp++;
  }
  if (tx === undefined) {
    // sample a few headings, score by open space ahead
    let best = null, bs = -1e9;
    for (let a = -1.1; a <= 1.1; a += 0.275) {
      const hx = Math.cos(a) * dir, hy = Math.sin(a);
      let s = hx * 6 - Math.abs(a) * 1.2;
      for (const d of def) {
        if (d.state === 'down' || d.state === 'tackled') continue;
        const px = e.x + hx * 5, py = e.y + hy * 5;
        const dd = dist2(px, py, d.x, d.y);
        s -= Math.max(0, 7 - dd) * 1.3;
        const dn = dist(d, e);
        if (dn < 3) s -= Math.max(0, 3 - dn) * 2;
      }
      const edge = Math.min(e.y, 53.33 - e.y);
      if (edge + hy * 5 < 2) s -= 6;
      if (s > bs) { bs = s; best = { hx, hy }; }
    }
    tx = e.x + best.hx * 6; ty = e.y + best.hy * 6;
  }
  const m = toward(e, tx, ty, 1);
  const [nd, ndd] = nearest(def, e.x, e.y, d => d.state !== 'down' && d.state !== 'tackled');
  let action = null;
  if (nd && ndd < 2.2 && e.state === 'run' && Math.random() < 0.08) action = Math.random() < 0.5 ? 'spin' : 'stiff';
  if (nd && ndd < 1.6 && (e.x - g.firstDownX) * dir > -4 && (e.x - g.firstDownX) * dir < 0 && Math.random() < 0.3) action = 'dive';
  const gl = g.goalLineFor(e.team);
  if ((gl - e.x) * dir < 4 && (gl - e.x) * dir > 0 && nd && ndd < 2.5) action = 'dive';
  return { ...m, turbo: true, action };
}

function qbBrain(g, e, off, def) {
  const dir = g.dir[e.team];
  g.qbT = (g.qbT || 0);
  const [rusher, rd] = nearest(def, e.x, e.y, d => d.state !== 'down');
  const pressured = rusher && rd < 2.8;
  // drop back for a beat
  let move = idle();
  if (g.liveT < 0.9) move = toward(e, g.los - dir * 7, e.y, 0.8);
  else if (pressured) move = toward(e, e.x - dir * 2, e.y + (e.y < 26 ? 4 : -4), 1);
  if (g.liveT < 0.7) return move;
  // Evaluate receivers: separation from nearest defender, plus depth.
  let best = -1, bs = -1e9;
  for (const ri of RECEIVERS) {
    const r = off[ri];
    if (!r || r.task !== 'route' || r.state === 'down') continue;
    const [nd, ndd] = nearest(def, r.x, r.y);
    const depth = (r.x - g.los) * dir;
    let s = Math.min(ndd, 9) * 1.4 + Math.min(depth, 30) * 0.12;
    if (ndd < 1.2) s -= 6;
    if (depth < -2) s -= 4;
    if (g.liveT > 3.2) s += depth * 0.1;         // getting antsy: throw it deep
    s += Math.random() * 1.5;
    if (s > bs) { bs = s; best = ri; }
  }
  const mustThrow = (pressured && g.liveT > 1.0) || g.liveT > 3.4;
  if (best >= 0 && (bs > 8.5 || mustThrow || (g.liveT > 1.8 && bs > 5.5))) return { ...move, action: 'pass', target: best };
  if (pressured && rd < 1.4 && g.liveT > 1.0) return { ...move, action: 'scramble' };
  return move;
}

// ---------- DEFENSE ----------
export function defenseBrain(g, e, off, def, dt) {
  const ball = g.ball;
  const carrier = g.carrier();
  const dir = -g.dir[e.team];      // direction the offense is driving
  if (e.state === 'down' || e.state === 'tackled') return idle();
  if (ball.loose && dist2(e.x, e.y, ball.x, ball.y) < 12) return { ...toward(e, ball.x, ball.y, 1), turbo: true };
  if (e.task === 'cover' && !carrier) return { ...toward(e, ball.inAir ? ball.landX : ball.x, ball.inAir ? ball.landY : ball.y, 1), turbo: true };

  // Ball in the air: the men closest to its landing spot go for it.
  if (ball.inAir) {
    const d = dist2(e.x, e.y, ball.landX, ball.landY);
    if (d < 9 || e.task === 'man' && e.assign === ball.target) {
      return { ...toward(e, ball.landX, ball.landY, 1), turbo: true, action: ball.landT < 0.3 && d < 1.8 && ball.landZ > 1.8 ? 'jump' : null };
    }
  }
  if (carrier && (g.handedOff || g.caught || carrier.role !== 'QB' || e.task === 'rush' || e.task === 'cover' || g.liveT > 2.2)) {
    // Pursuit angle: aim at where the carrier will be.
    const lead = clamp(dist(e, carrier) * 0.12, 0, 1.2);
    const tx = carrier.x + carrier.vx * lead, ty = carrier.y + carrier.vy * lead;
    const m = toward(e, tx, ty, 1);
    const d = dist(e, carrier);
    let action = null;
    if (d < 2.4 && d > 1.0 && e.state !== 'dive' && Math.random() < 0.35) action = 'dive';
    else if (d < 1.3) action = 'tackle';
    if (e.task === 'rush' && carrier.role === 'QB' && !g.handedOff) action = (d < 1.3) ? 'tackle' : (d < 2.0 && g.liveT > 1.4 && Math.random() < 0.12 ? 'dive' : null);
    return { ...m, turbo: true, action };
  }
  if (e.task === 'rush') {
    const qb = g.qb();
    if (!qb) return idle();
    const m = toward(e, qb.x, qb.y, 1);
    return { ...m, turbo: true, action: m.dist < 1.3 ? 'tackle' : null };
  }
  if (e.task === 'man') {
    const r = off[e.assign];
    if (!r) return idle();
    // trail inside shoulder, 1.5 yards deep
    const tx = r.x + dir * 1.5 + r.vx * 0.15, ty = r.y + (26.67 - r.y) * 0.03;
    const m = toward(e, tx, ty, 1);
    return { ...m, turbo: m.dist > 2 };
  }
  if (e.task === 'zone' && e.zone) {
    // sit in the zone, drift toward the closest receiver inside it
    let tx = e.zone[0], ty = e.zone[1];
    const [r, rd] = nearest(off, tx, ty, o => o.task === 'route');
    if (r && rd < 7) { tx = (tx + r.x) / 2; ty = (ty + r.y) / 2; }
    const m = toward(e, tx, ty, 0.9);
    return m;
  }
  return idle();
}

export function pickPlayAI(g, team, pages, isDefense) {
  if (isDefense) {
    const r = Math.random();
    if (g.down >= 3 && g.toGo > 12) return r < 0.5 ? 4 : r < 0.8 ? 5 : 8;
    if (g.toGo < 6) return r < 0.5 ? 3 : 2;
    return (Math.random() * 9) | 0;
  }
  const page = (Math.random() * pages.length) | 0;
  let slot = (Math.random() * 9) | 0;
  if (g.toGo < 5 && Math.random() < 0.6) { return [0, 3 + ((Math.random() * 2) | 0)]; }
  if (g.toGo > 20 && Math.random() < 0.5) { return [0, Math.random() < 0.5 ? 0 : 1]; }
  return [page, slot];
}
