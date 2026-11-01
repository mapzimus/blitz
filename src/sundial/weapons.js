// Weapon roster. Models live in GUN.PAK as ob/guns/<key>_ph.raw (first person), _cl.raw (held by characters),
// _promo.raw (menus). Numbers are a first pass tuned from play, not decompiled tables.
//   kind: hitscan | rocket | grenade | beam | thrown
export const WEAPONS = {
  luger:               { name: 'Luger Pistol',      dmg: 22, rpm: 300, clip: 8,   max: 96,  spread: 0.012, auto: false, sfx: 'gun_walther_colt22_02', reload: 'reload22_01' },
  silencedluger:       { name: 'Silenced Luger',    dmg: 20, rpm: 300, clip: 8,   max: 96,  spread: 0.010, auto: false, sfx: 'gun_silenced22', reload: 'reload22_01', quiet: true },
  silencedpistol:      { name: 'Silenced Pistol',   dmg: 19, rpm: 330, clip: 15,  max: 120, spread: 0.010, auto: false, sfx: 'gun_silenced22', reload: 'reload22_01', quiet: true },
  scifihandgun:        { name: 'SciFi Handgun',     dmg: 24, rpm: 360, clip: 20,  max: 140, spread: 0.010, auto: false, sfx: 'gun_handgun_scifi_22', reload: 'reload22_01' },
  magnum:              { name: 'Garrett Revolver',  dmg: 65, rpm: 140, clip: 6,   max: 48,  spread: 0.006, auto: false, sfx: 'gun_walther_colt22_03', reload: 'reload22_01' },
  uzi:                 { name: 'Uzi',               dmg: 11, rpm: 780, clip: 32,  max: 256, spread: 0.035, auto: true,  sfx: 'gun_uzi_withbullet22_01d', reload: 'reload22_01' },
  tommygun:            { name: 'Tommy Gun',         dmg: 13, rpm: 660, clip: 50,  max: 250, spread: 0.030, auto: true,  sfx: 'gun_tommygun_withbullet22_02', reload: 'assault_reload22_03' },
  ak47:                { name: 'Soviet S47',        dmg: 19, rpm: 600, clip: 30,  max: 240, spread: 0.025, auto: true,  sfx: 'gun_assault_rifle_withbullet22_01', reload: 'assault_reload22_03' },
  minigun:             { name: 'Minigun',           dmg: 11, rpm: 1300, clip: 200, max: 400, spread: 0.06, auto: true,  sfx: 'gun_mini_withbullet22_02', reload: 'assault_reload22_03' },
  doublebarrelshotgun: { name: 'Shotgun',           dmg: 13, rpm: 100, clip: 2,   max: 40,  spread: 0.07,  auto: false, pellets: 8, sfx: 'gun71b_withbullet22_01', reload: 'shotgun_cock1e_22' },
  assaultshotgun:      { name: 'Tactical 12-Gauge', dmg: 11, rpm: 180, clip: 8,   max: 48,  spread: 0.06,  auto: false, pellets: 8, sfx: 'gun_dr08c_22', reload: 'shotgun_cock1e_22' },
  sniperbolt:          { name: 'Vintage Rifle',     dmg: 75, rpm: 55,  clip: 5,   max: 40,  spread: 0.002, auto: false, sfx: 'gun_mauser_withbullet22_01', reload: 'reload22_01', zoom: 2.5 },
  sniperrifle:         { name: 'Sniper Rifle',      dmg: 85, rpm: 70,  clip: 10,  max: 50,  spread: 0.001, auto: false, sfx: 'gun_sniper_rifle22_01d', reload: 'reload22_01', zoom: 4 },
  crossbow:            { name: 'Crossbow',          dmg: 55, rpm: 80,  clip: 1,   max: 30,  spread: 0.004, auto: false, sfx: 'crossbow_fire22_01', reload: 'crossbow_pullback22_01', quiet: true },
  laser:               { name: 'Lasergun',          dmg: 26, rpm: 420, clip: 50,  max: 300, spread: 0.008, auto: true,  sfx: 'gun_laser01b_me_22', reload: 'reload22_01', tracer: 0xff6040 },
  plasmamachinegun:    { name: 'Plasma Autorifle',  dmg: 17, rpm: 720, clip: 40,  max: 280, spread: 0.02,  auto: true,  sfx: 'gun_laser02_me_22', reload: 'reload22_01', tracer: 0x40ff80 },
  electrogun:          { name: 'Electrotool',       dmg: 6,  rpm: 1200, clip: 100, max: 300, spread: 0,    auto: true,  kind: 'beam', range: 7, sfx: 'gun_electrogun22_01', reload: 'reload22_01' },
  flamethrower:        { name: 'Flamethrower',      dmg: 6,  rpm: 900, clip: 100, max: 300, spread: 0.08,  auto: true,  kind: 'beam', range: 7, sfx: 'gun_flamethrower22_02', reload: 'reload22_01' },
  fireext:             { name: 'Fire Extinguisher', dmg: 2,  rpm: 900, clip: 100, max: 300, spread: 0.1,   auto: true,  kind: 'beam', range: 5, sfx: 'gun_fire_extin22_04', reload: 'reload22_01' },
  rocketlauncher:      { name: 'Rocket Launcher',   dmg: 110, rpm: 55, clip: 1,   max: 10,  spread: 0,     auto: false, kind: 'rocket', speed: 28, radius: 3.5, sfx: 'gun_rocketlauncher22', reload: 'reload22_01' },
  homingrocketlauncher:{ name: 'Homing Launcher',   dmg: 95, rpm: 50,  clip: 1,   max: 10,  spread: 0,     auto: false, kind: 'rocket', speed: 18, radius: 3, homing: true, sfx: 'gun_hybrid_rocket01b_22', reload: 'reload22_01' },
  grenadelauncher:     { name: 'Grenade Launcher',  dmg: 85, rpm: 110, clip: 6,   max: 30,  spread: 0,     auto: false, kind: 'grenade', speed: 20, radius: 3.5, fuse: 2.2, sfx: 'gun_grenade_launcher01c_22', reload: 'assault_reload22_03' },
  tnt:                 { name: 'TNT',               dmg: 100, rpm: 60, clip: 1,   max: 8,   spread: 0,     auto: false, kind: 'grenade', speed: 14, radius: 4, fuse: 2.5, sfx: 'brick16_03d', reload: 'reload22_01', throwUp: 0.35 },
  brick:               { name: 'Brick',             dmg: 30, rpm: 100, clip: 1,   max: 12,  spread: 0,     auto: false, kind: 'grenade', speed: 16, radius: 0, fuse: 0, sfx: 'brick16_03d', reload: 'reload22_01', throwUp: 0.3, hitSfx: 'brickhit22_01c' },
};
export const ORDER = Object.keys(WEAPONS);
export const BOT_WEAPONS = ['uzi', 'tommygun', 'ak47', 'luger', 'doublebarrelshotgun', 'laser', 'plasmamachinegun', 'scifihandgun', 'magnum', 'silencedpistol', 'sniperbolt', 'rocketlauncher', 'grenadelauncher'];
export const SFX = { explode: 'mini_explode22_01', explodeBig: 'fe_explosion22_01', dry: 'gun_dryfire01_22', ricochet: ['ricochet_n01_16', 'ricochet_n02_16', 'ricochet_n03_16', 'ricochet_n04_16'], ammo: 'getammo22_03', health: 'health_pickup22_01', pickup: 'pickups02_22', armour: 'bag_pickup01_22' };
export const slotName = key => (WEAPONS[key] && WEAPONS[key].name) || key;
