// Weapon roster. Models live in the gun pack as ob/guns/<key>_ph.raw (first person), _cl.raw (held by
// characters), _promo.raw (menus). clip, max, spread, dmg (body) and head (headshot) come from the game's own
// weapon table; rate of fire and the sound choices are tuned by hand. `tid` is the display name's id in the
// disc's text table; the fallback label is just the key.
//   kind: hitscan | rocket | grenade | beam | thrown
export const WEAPONS = {
  luger:               { tid: 1589, dmg: 22, head: 35, rpm: 300, clip: 7,   max: 70,  spread: 0.010, auto: false, sfx: 'gun_walther_colt22_02', reload: 'reload22_01' },
  silencedluger:       { tid: 1587, dmg: 22, head: 35, rpm: 300, clip: 7,   max: 70,  spread: 0.010, auto: false, sfx: 'gun_silenced22', reload: 'reload22_01', quiet: true },
  silencedpistol:      { tid: 1585, dmg: 30, head: 32, rpm: 280, clip: 8,   max: 64,  spread: 0.010, auto: false, sfx: 'gun_silenced22', reload: 'reload22_01', quiet: true },
  scifihandgun:        { tid: 1600, dmg: 21, head: 21, rpm: 360, clip: 30,  max: 90,  spread: 0.010, auto: false, sfx: 'gun_handgun_scifi_22', reload: 'reload22_01' },
  magnum:              { tid: 1591, dmg: 20, head: 40, rpm: 140, clip: 6,   max: 36,  spread: 0.002, auto: false, sfx: 'gun_walther_colt22_03', reload: 'reload22_01' },
  uzi:                 { tid: 1613, dmg: 8,  head: 4,  rpm: 780, clip: 64,  max: 192, spread: 0.025, auto: true,  sfx: 'gun_uzi_withbullet22_01d', reload: 'reload22_01' },
  tommygun:            { tid: 1610, dmg: 7,  head: 7,  rpm: 660, clip: 32,  max: 128, spread: 0.010, auto: true,  sfx: 'gun_tommygun_withbullet22_02', reload: 'assault_reload22_03' },
  ak47:                { tid: 1597, dmg: 8,  head: 8,  rpm: 600, clip: 30,  max: 60,  spread: 0.030, auto: true,  sfx: 'gun_assault_rifle_withbullet22_01', reload: 'assault_reload22_03' },
  minigun:             { tid: 1620, dmg: 12, head: 4,  rpm: 1300, clip: 100, max: 400, spread: 0.010, auto: true, sfx: 'gun_mini_withbullet22_02', reload: 'assault_reload22_03' },
  doublebarrelshotgun: { tid: 1615, dmg: 12, head: 25, rpm: 100, clip: 2,   max: 16,  spread: 0.030, auto: false, pellets: 8, sfx: 'gun71b_withbullet22_01', reload: 'shotgun_cock1e_22' },
  assaultshotgun:      { tid: 1612, dmg: 10, head: 10, rpm: 180, clip: 8,   max: 32,  spread: 0.070, auto: false, pellets: 8, sfx: 'gun_dr08c_22', reload: 'shotgun_cock1e_22' },
  sniperbolt:          { tid: 1594, dmg: 43, head: 60, rpm: 55,  clip: 5,   max: 8,   spread: 0.001, auto: false, sfx: 'gun_mauser_withbullet22_01', reload: 'reload22_01', zoom: 2.5 },
  sniperrifle:         { tid: 1593, dmg: 43, head: 60, rpm: 70,  clip: 5,   max: 8,   spread: 0.001, auto: false, sfx: 'gun_sniper_rifle22_01d', reload: 'reload22_01', zoom: 4 },
  crossbow:            { tid: 1619, dmg: 55, head: 80, rpm: 80,  clip: 1,   max: 30,  spread: 0.004, auto: false, sfx: 'crossbow_fire22_01', reload: 'crossbow_pullback22_01', quiet: true },
  laser:               { tid: 1603, dmg: 20, head: 20, rpm: 420, clip: 100, max: 1700, spread: 0.001, auto: true, sfx: 'gun_laser01b_me_22', reload: 'reload22_01', tracer: 0xff6040 },
  plasmamachinegun:    { tid: 1604, dmg: 9,  head: 9,  rpm: 900, clip: 50,  max: 150, spread: 0.020, auto: true,  sfx: 'gun_laser02_me_22', reload: 'reload22_01', tracer: 0x40ff80 },
  electrogun:          { tid: 1599, dmg: 5,  head: 5,  rpm: 1200, clip: 100, max: 750, spread: 0,    auto: true,  kind: 'beam', range: 7, sfx: 'gun_electrogun22_01', reload: 'reload22_01' },
  flamethrower:        { tid: 1595, dmg: 6,  head: 6,  rpm: 900, clip: 100, max: 500, spread: 0.2,   auto: true,  kind: 'beam', range: 7, sfx: 'gun_flamethrower22_02', reload: 'reload22_01' },
  fireext:             { tid: 1596, dmg: 2,  head: 2,  rpm: 900, clip: 100, max: 500, spread: 0.2,   auto: true,  kind: 'beam', range: 5, sfx: 'gun_fire_extin22_04', reload: 'reload22_01' },
  rocketlauncher:      { tid: 1601, dmg: 110, head: 110, rpm: 55, clip: 3,  max: 9,   spread: 0,     auto: false, kind: 'rocket', speed: 28, radius: 3.5, sfx: 'gun_rocketlauncher22', reload: 'reload22_01' },
  homingrocketlauncher:{ tid: 1602, dmg: 95, head: 95, rpm: 50,  clip: 1,   max: 8,   spread: 0,     auto: false, kind: 'rocket', speed: 18, radius: 3, homing: true, sfx: 'gun_hybrid_rocket01b_22', reload: 'reload22_01' },
  grenadelauncher:     { tid: 1605, dmg: 85, head: 85, rpm: 110, clip: 8,   max: 12,  spread: 0,     auto: false, kind: 'grenade', speed: 20, radius: 3.5, fuse: 2.2, sfx: 'gun_grenade_launcher01c_22', reload: 'assault_reload22_03' },
  tnt:                 { tid: 1609, dmg: 100, head: 100, rpm: 60, clip: 1,  max: 1,   spread: 0,     auto: false, kind: 'grenade', speed: 14, radius: 4, fuse: 2.5, sfx: 'brick16_03d', reload: 'reload22_01', throwUp: 0.35 },
  brick:               { tid: 1617, dmg: 30, head: 40, rpm: 100, clip: 1,   max: 20,  spread: 0,     auto: false, kind: 'grenade', speed: 16, radius: 0, fuse: 0, sfx: 'brick16_03d', reload: 'reload22_01', throwUp: 0.3, hitSfx: 'brickhit22_01c' },
};
export const ORDER = Object.keys(WEAPONS);
export const BOT_WEAPONS = ['uzi', 'tommygun', 'ak47', 'luger', 'doublebarrelshotgun', 'laser', 'plasmamachinegun', 'scifihandgun', 'magnum', 'silencedpistol', 'sniperbolt', 'rocketlauncher', 'grenadelauncher'];
export const SFX = { explode: 'mini_explode22_01', explodeBig: 'fe_explosion22_01', dry: 'gun_dryfire01_22', ricochet: ['ricochet_n01_16', 'ricochet_n02_16', 'ricochet_n03_16', 'ricochet_n04_16'], ammo: 'getammo22_03', health: 'health_pickup22_01', pickup: 'pickups02_22', armour: 'bag_pickup01_22' };
// Display name: the disc's text when a text table is loaded, otherwise the key.
let text = null;
export function setText(t) { text = t; }
export const slotName = key => (text && WEAPONS[key] && text.get(WEAPONS[key].tid)) || key.toUpperCase();
