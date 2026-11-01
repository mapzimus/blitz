// Mission scripts by level number. Each module exports { setup(api), update(dt, api), on(event, payload, api) }.
// The script decides when objectives appear and complete and what the scripted set pieces do; the
// placement tables (enemies, doors, pickups, cameras) are handled by story.js on their own.
// Story levels: 35 Siberia, 20 Chicago, 34 Notre Dame, 41 Robot Factory, 38 NeoTokyo, 48 Aztec,
// 31 Atom Smasher, 32 Wild West, 40 Planet X, 39 Spacestation.
export const MISSIONS = [35, 20, 34, 41, 38, 48, 31, 32, 40, 39];

const loaders = {
  35: () => import('./level35.js'),
  20: () => import('./level20.js'),
  34: () => import('./level34.js'),
  41: () => import('./level41.js'),
  38: () => import('./level38.js'),
  48: () => import('./level48.js'),
  31: () => import('./level31.js'),
  32: () => import('./level32.js'),
  40: () => import('./level40.js'),
  39: () => import('./level39.js'),
};

export async function loadMission(level) {
  const l = loaders[level];
  if (!l) return null;
  try { const m = await l(); return m.default || m; } catch (e) { console.warn(`no script for level ${level}`, e.message); return null; }
}
