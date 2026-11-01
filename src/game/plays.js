// Playbook. Offense authored facing +x (downfield), +y = offense's right. Coordinates relative
// to the ball at the line of scrimmage. Routes are waypoints relative to each player's start.
// Player index: 0 QB, 1 RB, 2 OL, 3 OL, 4 WR(left), 5 WR(right), 6 WR/slot.

const F = {
  pro:     [[-1.6, 0], [-6, 0], [-0.7, -1.1], [-0.7, 1.1], [0, -17], [0, 17], [-1, 8]],
  shotgun: [[-5.5, 0], [-5.5, -3.2], [-0.7, -1.1], [-0.7, 1.1], [0, -18], [0, 18], [-1, 9]],
  trips:   [[-5, 0], [-6, -2], [-0.7, -1.1], [-0.7, 1.1], [0, 19], [-1, 13], [-1, 7]],
  spread:  [[-5.5, 0], [-1, -10], [-0.7, -1.1], [-0.7, 1.1], [0, -20], [0, 20], [-1, 10]],
  iform:   [[-1.6, 0], [-7.5, 0], [-0.7, -1.1], [-0.7, 1.1], [0, -16], [0, 16], [-0.6, 3.5]],
  bunch:   [[-5, 0], [-6, 3], [-0.7, -1.1], [-0.7, 1.1], [0, -18], [-1, -14], [-2, -10]],
  goal:    [[-1.6, 0], [-5, 0], [-0.7, -1.1], [-0.7, 1.1], [0, -8], [0, 8], [-0.6, 3.2]],
};

// Route primitives (dy sign is flipped automatically for players on the left side)
const R = {
  go:     [[40, 0]],
  post:   [[12, 0], [38, -14]],
  corner: [[12, 0], [34, 16]],
  slant:  [[3, 0], [22, -14]],
  out:    [[8, 0], [9, 14]],
  dig:    [[12, 0], [13, -20]],
  curl:   [[11, 0], [9, -1.5]],
  hitch:  [[6, 0], [5, -1]],
  flat:   [[1, 10], [3, 16]],
  wheel:  [[1, 12], [8, 15], [40, 15]],
  drag:   [[2, 0], [5, -24]],
  cross:  [[8, 0], [20, -26]],
  screen: [[-3, 6], [-2, 12]],
  swing:  [[-1, 8], [3, 12], [12, 13]],
  seam:   [[35, 2]],
  fade:   [[6, 2], [30, 5]],
  comeback:[[15, 0], [12, 3]],
  block:  null,
};

const P = (name, form, routes, extra = {}) => ({ name, form, routes, type: 'pass', ...extra });
const RUN = (name, form, carrier, path, routes = {}) => ({ name, form, routes, type: 'run', carrier, path });

export const OFFENSE_PAGES = [
  [ // page 1 - the classics
    P('DA BOMB', 'spread', { 1: 'go', 4: 'go', 5: 'go', 6: 'post' }),
    P('HAIL MARY', 'shotgun', { 1: 'wheel', 4: 'go', 5: 'go', 6: 'go' }),
    P('FLEA FLICKER', 'pro', { 1: 'flea', 4: 'go', 5: 'post', 6: 'flat' }, { flea: true }),
    RUN('QB SNEAK', 'goal', 0, [[2, 0], [12, 0]], { 4: 'block', 5: 'block', 6: 'block', 1: 'block' }),
    RUN('POWER DIVE', 'iform', 1, [[7, 1], [20, 1]], { 4: 'go', 5: 'go', 6: 'block' }),
    P('SPREAD', 'spread', { 1: 'curl', 4: 'out', 5: 'out', 6: 'seam' }),
    P('Z CROSS', 'pro', { 1: 'swing', 4: 'cross', 5: 'dig', 6: 'drag' }),
    P('SCREEN', 'shotgun', { 1: 'screen', 4: 'go', 5: 'slant', 6: 'go' }, { screen: true }),
    P('CROSSFIRE', 'trips', { 1: 'flat', 4: 'post', 5: 'cross', 6: 'drag' }),
  ],
  [ // page 2
    P('SCISSORS', 'shotgun', { 1: 'swing', 4: 'corner', 5: 'post', 6: 'post' }),
    P('DEEP CROSS', 'bunch', { 1: 'flat', 4: 'go', 5: 'cross', 6: 'dig' }),
    P('QUICK OUT', 'pro', { 1: 'flat', 4: 'out', 5: 'out', 6: 'hitch' }),
    RUN('SWEEP', 'pro', 1, [[-2, 9], [6, 14], [24, 13]], { 4: 'block', 5: 'go', 6: 'block' }),
    RUN('REVERSE', 'pro', 4, [[-4, 8], [-5, 24], [6, 32], [26, 30]], { 1: 'block', 5: 'go', 6: 'block' }),
    P('SLANT PASS', 'shotgun', { 1: 'flat', 4: 'slant', 5: 'slant', 6: 'slant' }),
    P('BOOT PASS', 'iform', { 1: 'flat', 4: 'comeback', 5: 'corner', 6: 'drag' }, { boot: 1 }),
    P('HOOK & LADDER', 'pro', { 1: 'swing', 4: 'curl', 5: 'go', 6: 'go' }, { lateral: [4, 1] }),
    P('FAKE SPIKE', 'shotgun', { 1: 'wheel', 4: 'fade', 5: 'fade', 6: 'seam' }),
  ],
];

// Defense. Index: 0 DL, 1 DL, 2 LB, 3 LB, 4 CB, 5 CB, 6 S. Defense authored facing -x (toward offense).
// Alignments are relative to the ball; coverage says what each man does at the snap.
const D = (name, align, rush, cov) => ({ name, align, rush, cov });
export const DEFENSE_PAGE = [
  D('SAFE COVER', 'base', [0, 1], 'zone'),
  D('MAN UP', 'press', [0, 1], 'man'),
  D('SUICIDE BLITZ', 'base', [0, 1, 2, 3, 6], 'man'),
  D('GOAL LINE', 'goal', [0, 1, 2, 3], 'man'),
  D('ZONE', 'base', [0, 1, 2], 'zone'),
  D('COVER 2', 'off', [0, 1], 'cover2'),
  D('CB BLITZ', 'press', [0, 1, 4], 'man'),
  D('LB BLITZ', 'base', [0, 1, 2, 3], 'zone'),
  D('PREVENT', 'deep', [0, 1], 'prevent'),
];
export const DEF_ALIGN = {
  base:  [[1.2, -1.6], [1.2, 1.6], [4.5, -4], [4.5, 4], [6, -17], [6, 17], [13, 0]],
  press: [[1.2, -1.6], [1.2, 1.6], [4, -3], [4, 3], [1.5, -17], [1.5, 17], [11, 0]],
  off:   [[1.2, -1.6], [1.2, 1.6], [5, -5], [5, 5], [8, -16], [8, 16], [16, 0]],
  goal:  [[1.0, -2.2], [1.0, 2.2], [2.5, -5], [2.5, 5], [2, -10], [2, 10], [6, 0]],
  deep:  [[1.2, -1.6], [1.2, 1.6], [8, -8], [8, 8], [12, -16], [12, 16], [22, 0]],
};

export const FORMATIONS = F;
export const ROUTES = R;

export function routePoints(playRoutes, idx, start) {
  const key = playRoutes[idx];
  if (!key || key === 'block' || key === 'flea') return null;
  const pts = R[key];
  if (!pts) return null;
  const side = start[1] < 0 ? -1 : 1;           // mirror inside-breaking routes for left side
  return pts.map(([dx, dy]) => [start[0] + dx, start[1] + dy * side]);
}
