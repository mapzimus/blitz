import { MOVE, FIELD } from './constants.js';

export function makeEntity(team, idx, role, info) {
  return {
    team, idx, role, name: info.name, num: info.num, spd: info.spd, pow: info.pow, hands: info.hands,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, face: 0,
    state: 'idle', st: 0,          // state + seconds remaining in it
    turbo: 100, turboOn: false,
    task: 'idle', route: null, wp: 0, assign: -1, zone: null,
    hasBall: false, engaged: -1, engT: 0, shaken: 0,
    blocked: 0, burstT: 0,
  };
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function nearest(list, x, y, pred) {
  let best = null, bd = 1e9;
  for (const e of list) {
    if (pred && !pred(e)) continue;
    const d = dist2(e.x, e.y, x, y);
    if (d < bd) { bd = d; best = e; }
  }
  return [best, bd];
}

export function maxSpeed(e, rules, fire) {
  let s = MOVE.speed[e.role] * e.spd;
  if (e.turboOn && e.turbo > 0) s *= rules.turboSpeed;
  if (fire) s *= rules.onFireBoost;
  if (e.state === 'dive') s = MOVE.diveSpeed;
  if (e.state === 'down' || e.state === 'tackled' || e.state === 'celebrate') s = 0;
  if (e.state === 'spin') s *= 0.8;
  if (e.state === 'jump') s *= 0.9;
  if (e.engaged >= 0) s *= 0.15;
  if (e.blocked > 0) s *= 0.25;
  return s;
}

// Steer toward a desired velocity (dx, dy are a direction, mag is 0..1), with acceleration limits.
export function steer(e, dx, dy, mag, dt, top) {
  const want = top * clamp(mag, 0, 1);
  let tx = dx * want, ty = dy * want;
  if (e.state === 'dive') { tx = Math.cos(e.face) * top; ty = Math.sin(e.face) * top; }
  const ax = tx - e.vx, ay = ty - e.vy;
  const al = Math.hypot(ax, ay);
  const a = (want > 0.01 ? MOVE.accel : MOVE.decel) * dt;
  if (al > a) { e.vx += (ax / al) * a; e.vy += (ay / al) * a; } else { e.vx = tx; e.vy = ty; }
  const sp = Math.hypot(e.vx, e.vy);
  if (sp > 0.4) {
    const target = Math.atan2(e.vy, e.vx);
    let d = target - e.face;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    e.face += clamp(d, -MOVE.turn * dt, MOVE.turn * dt);
  }
}

export function integrate(e, dt) {
  e.x += e.vx * dt; e.y += e.vy * dt;
  // keep bodies on the playing surface (sideline handling is done by the sim for the carrier)
  e.x = clamp(e.x, FIELD.minX + 0.5, FIELD.maxX - 0.5);
  e.y = clamp(e.y, -1.5, FIELD.width + 1.5);
  if (e.st > 0) { e.st -= dt; if (e.st <= 0) { e.st = 0; if (e.state !== 'idle' && e.state !== 'run') e.state = 'idle'; } }
  if (e.shaken > 0) e.shaken -= dt;
  if (e.blocked > 0) e.blocked -= dt;
  if (e.burstT > 0) e.burstT -= dt;
}

export function setState(e, s, t) { e.state = s; e.st = t; }

// Serialize for the network snapshot (short keys, rounded).
export function packEntity(e) {
  return [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2), +e.face.toFixed(2), e.state, e.hasBall ? 1 : 0, Math.round(e.turbo)];
}
export function unpackEntity(e, p) {
  e.x = p[0]; e.y = p[1]; e.z = p[2]; e.face = p[3]; e.state = p[4]; e.hasBall = !!p[5]; e.turbo = p[6];
}
