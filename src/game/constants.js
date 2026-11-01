// All units: yards and seconds. Field runs along +x. Goal lines at x=0 and x=100.
// Offense plays are authored as if the offense drives toward +x; the sim mirrors for the other team.
export const FIELD = {
  length: 100, endzone: 10, width: 53.33,
  hashL: 23.58, hashR: 29.75, mid: 26.665,
  minX: -10, maxX: 110,
};

// Rule set. Everything that makes Blitz "Blitz" is a knob here so Task 2 (the tweaked version)
// can swap a second RULES object in without touching the simulation.
export const RULES = {
  name: 'CLASSIC RULES',
  playersPerSide: 7,
  firstDownYards: 30,
  downs: 4,
  quarters: 4,
  quarterSeconds: 120,
  overtimeSeconds: 120,
  playClock: 15,           // Blitz gives you a fast play clock
  penalties: false,
  lateHits: true,          // hits after the whistle allowed (and encouraged)
  onFireStreak: 3,         // consecutive scores to catch fire
  onFireBoost: 1.18,       // speed / catch / tackle multiplier while on fire
  turboMax: 100,
  turboDrain: 45,          // per second while held
  turboRegen: 14,          // per second while not held
  turboSpeed: 1.32,
  points: { td: 6, patKick: 1, patConv: 2, fg: 3, safety: 2 },
  kickoffSpot: 30,
  touchbackSpot: 20,
  patSpot: 2,              // 2-yard line
  clockStopsOn: ['incomplete', 'score', 'turnover', 'outOfBounds'],
  lateHitWindow: 2.0,      // seconds after whistle you may still pile on
};

// Movement tuning (arcade fast). Base speeds in yd/s.
export const MOVE = {
  speed: { QB: 8.6, RB: 9.6, WR: 9.9, OL: 7.4, TE: 8.8, DL: 8.0, LB: 9.0, CB: 9.8, S: 9.6 },
  accel: 28, decel: 34, turn: 10,
  diveSpeed: 13, diveTime: 0.45, diveRecover: 0.7,
  jumpTime: 0.55, spinTime: 0.5, stiffArmTime: 0.4,
  tackleRange: 1.15, breakTackleBase: 0.22,
  ballSpeedBullet: 34, ballSpeedLob: 24, gravity: 24,
  catchRadius: 1.6, pickRadius: 1.25,
  kickPower: 60, puntPower: 52,
};

export const TICK = 1 / 60;       // fixed sim step
export const NET_RATE = 20;       // snapshots per second host -> client

export const ROLES_OFF = ['QB', 'RB', 'OL', 'OL', 'WR', 'WR', 'WR'];
export const ROLES_DEF = ['DL', 'DL', 'LB', 'LB', 'CB', 'CB', 'S'];
export const RECEIVERS = [1, 4, 5, 6];           // eligible indices in offense
export const RECEIVER_LABELS = ['A', 'B', 'C', 'D'];

export const PHASE = {
  KICKOFF: 'kickoff', PLAYCALL: 'playcall', PRESNAP: 'presnap', LIVE: 'live',
  DEAD: 'dead', PAT_CHOICE: 'patchoice', HALFTIME: 'halftime', FINAL: 'final',
};
