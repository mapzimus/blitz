// The hub manifest. Each entry is one game tile.
// RULE: `code` and `hint` are what visitors see. Never put the game's real name here.
// `path` is the folder under /games/ (also code-worded so the URL doesn't leak it).
export const GAMES = [
  {
    code: 'KODIAK',
    hint: 'Seven a side. Thirty yards. No flags.',
    path: 'games/kodiak/',
    accent: '#ffb03b',
    ready: false,
  },
  {
    code: 'FIREFLY',
    hint: 'Same bones, house rules.',
    path: 'games/firefly/',
    accent: '#ff4d00',
    ready: false,
  },
  {
    code: 'SUNDIAL',
    hint: 'Ten eras. One arena. Bring your own disc.',
    path: 'games/sundial/',
    accent: '#3ad6c9',
    ready: true,
  },
];
