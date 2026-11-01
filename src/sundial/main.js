// SUNDIAL: browser runtime for a PS2 arena shooter, fed from the player's own disc copy.
import * as THREE from 'three';
import { Pak } from './pak.js';
import { parseMap } from './map.js';
import { parsePad } from './pad.js';
import { parseModel } from './model.js';
import { parseAnim } from './anim.js';
import { makeBind } from './skeleton.js';
import { TexSource, mapToGroup, modelToGroup } from './build.js';
import { cache } from './store.js';
import { Bots } from './bots.js';
import { Sfx } from './audio.js';
import { WEAPONS, ORDER, BOT_WEAPONS, SFX, slotName } from './weapons.js';
import { Projectiles } from './projectiles.js';
import { Pickups } from './pickups.js';
import { Music } from './music.js';

const $ = s => document.querySelector(s);
const status = t => { $('#dirstatus').textContent = t; };
const msg = (t, ms = 2000) => { const el = $('#msg'); el.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => (el.textContent = ''), ms); };
const pick = a => a[Math.floor(Math.random() * a.length)];
const BOT_NAMES = ['Cortez', 'Harry Tipper', 'Jo-Beth', 'Hank', 'Lady Jane', 'Viola', 'Gretel', 'Sgt. Shock', 'Jake Fenton', 'Chastity', 'Lt. Shade', 'Stone Golem'];

// ---------- file acquisition ----------
let pickedFiles = new Map(); // lowercase name -> File
const NEEDED = ['gun.pak', 'sounds.pak', 'anim.pak', 'fe_anim.pak'];
const ARENA = /^l_(\d+)_ar\.pak$/;
const ARENA_IDS = [10, 11, 13, 21, 29, 32, 33, 34, 35, 36, 42, 43, 45, 46, 47, 48, 50, 55, 56, 64, 65];
// Themes read off each pack's sky and props; the game's own arena names live in its text tables.
const THEME = { 10: 'Siberia', 11: 'Siberia · Hangar', 13: 'The Site', 21: 'Chinese Restaurant', 29: 'Aztec', 32: 'Wild West', 33: 'Atom Smasher', 34: 'Notre Dame', 35: 'Chicago', 36: 'Space Station', 42: 'Mexican Mission', 43: 'Chicago · Gangsters', 45: 'Hospital', 46: 'Scrapyard', 47: 'Circus', 48: 'Aztec Temple', 50: 'Ufopia', 55: 'Chicago · Streets', 56: 'Night', 64: 'Robot Factory', 65: 'Scrapyard · Night' };
const SRC = new URLSearchParams(location.search).get('src'); // dev: fetch archives from a local server
const MUSIC_TRACKS = [...Array(30)].map((_, i) => 1030 + i); // MUSIC1 folder, 1030-1059

async function fileBuf(name) {
  name = name.toLowerCase();
  if (SRC) {
    let path = name.toUpperCase();
    if (ARENA.test(name)) path = 'ARCADE/' + path;
    else if (/^\d{4}\.mib$/.test(name)) { const id = parseInt(name); path = `../MUSIC/MUSIC${id < 1030 ? 0 : id < 1060 ? 1 : 2}/${path}`; }
    const r = await fetch(SRC + path);
    if (!r.ok) throw new Error(`${r.status} fetching ${name}`);
    return r.arrayBuffer();
  }
  let buf = await cache.get(name);
  if (buf) return buf;
  const f = pickedFiles.get(name);
  if (!f) throw new Error(`Need ${name}: pick the PAK folder first.`);
  buf = await f.arrayBuffer();
  await cache.put(name, buf);
  return buf;
}

async function refreshLevelList() {
  const cached = new Set(SRC ? [] : await cache.keys());
  if (SRC) {
    for (const n of ARENA_IDS) pickedFiles.set(`l_${n}_ar.pak`, true);
    for (const n of NEEDED) pickedFiles.set(n, true);
    for (const n of MUSIC_TRACKS) pickedFiles.set(`${n}.mib`, true);
  }
  const names = new Set([...cached, ...pickedFiles.keys()].filter(n => ARENA.test(n)));
  const sel = $('#level');
  sel.innerHTML = '';
  const sorted = [...names].sort((a, b) => parseInt(a.match(ARENA)[1]) - parseInt(b.match(ARENA)[1]));
  for (const n of sorted) {
    const o = document.createElement('option');
    const id = n.match(ARENA)[1];
    o.value = n; o.textContent = `${THEME[id] || 'Arena'} (${id})${cached.has(n) ? ' ·cached' : ''}`;
    sel.appendChild(o);
  }
  haveMusic = [...cached, ...pickedFiles.keys()].some(n => /^\d{4}\.mib$/.test(n));
  const have = NEEDED.every(n => cached.has(n) || pickedFiles.has(n));
  $('#levelrow').hidden = !(sorted.length && have);
  $('#cachenote').textContent = cached.size ? `${cached.size} archive(s) kept in this browser. Nothing is uploaded anywhere.` : '';
  if (sorted.length && have) status(`${sorted.length} arenas available.`);
  else if (sorted.length) status('Found arenas but not GUN.PAK / SOUNDS.PAK / ANIM.PAK. Pick the PAK folder itself.');
}
let haveMusic = false;
$('#dir').addEventListener('change', e => {
  pickedFiles = new Map();
  for (const f of e.target.files) if (/\.(pak|mib)$/i.test(f.name)) pickedFiles.set(f.name.toLowerCase(), f);
  const paks = [...pickedFiles.keys()].filter(n => n.endsWith('.pak')).length, mibs = pickedFiles.size - paks;
  status(paks ? `Found ${paks} archives${mibs ? ` and ${mibs} music tracks` : ' (no MUSIC folder, so no music)'}.` : 'No .PAK files in that folder. Pick the folder you copied the disc to.');
  refreshLevelList();
});
refreshLevelList();

// ---------- engine ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 400);
const weaponCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
const weaponScene = new THREE.Scene();
weaponScene.add(new THREE.AmbientLight(0xffffff, 1));
scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x3a3328, 1.6));
const sun = new THREE.DirectionalLight(0xfff0dd, 1.2); sun.position.set(3, 10, 4); scene.add(sun);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  weaponCam.aspect = w / h; weaponCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const world = { group: null, solid: [], pad: null, nodes: [], spawn: new THREE.Vector3(0, 2, 0), bots: null, proj: null, pickups: null, gun: null, gunTex: null, sky: null };
const match = { limit: 10, time: 300, left: 300, over: false, started: 0 };
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  eye: 1.5, radius: 0.35, grounded: false, hp: 100, armour: 0, kills: 0, deaths: 0, dead: false, respawnIn: 0,
  weapons: [], cur: 0, cool: 0, reloading: 0, zoom: false, name: 'YOU',
};
let sfx = new Sfx(null), anims = null, bind = null, music = null, track = -1;
const hurtVoices = [], dieVoices = [];
let hurt = 0;
async function playMusic(next = false) {
  if (!haveMusic) return;
  if (!music) music = new Music(sfx.ensure(), sfx.gain);
  const ids = MUSIC_TRACKS.filter(id => SRC || pickedFiles.has(`${id}.mib`) || true);
  track = next && track >= 0 ? (track + 1) % ids.length : Math.floor(Math.random() * ids.length);
  try { music.play(new Uint8Array(await fileBuf(`${ids[track]}.mib`)), { volume: 0.35 }); msg(`TRACK ${ids[track]}`, 1500); }
  catch (e) { console.warn('music', e.message); if (!next) haveMusic = false; }
}

// ---------- input ----------
const keys = new Set();
let firing = false;
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  if (!playing()) return;
  if (/^Digit[1-9]$/.test(e.code)) selectWeapon(parseInt(e.code[5]) - 1);
  if (e.code === 'KeyR') reload();
  if (e.code === 'Tab') $('#board').hidden = false;
  if (e.code === 'KeyQ') selectWeapon(player.cur + 1);
  if (e.code === 'KeyM') playMusic(true);
});
addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') $('#board').hidden = true; });
addEventListener('wheel', e => { if (playing()) selectWeapon(player.cur + (e.deltaY > 0 ? 1 : -1)); });
addEventListener('contextmenu', e => e.preventDefault());

let locked = false, noLock = false, dragging = false;
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
async function grabMouse() {
  if (noLock || locked) return;
  try { await canvas.requestPointerLock(); } catch (e) { noLock = true; msg('HOLD MOUSE BUTTON TO LOOK', 3000); }
}
const playing = () => world.group && $('#setup').hidden && !match.over;
canvas.addEventListener('mousedown', e => {
  if (!playing()) return;
  if (e.button === 2) { player.zoom = true; return; }
  if (!locked && !noLock) grabMouse(); else if (locked) firing = true; else dragging = true;
});
canvas.addEventListener('mouseup', e => { if (e.button === 2) player.zoom = false; else { firing = false; dragging = false; } });
canvas.addEventListener('click', () => { if (playing() && noLock && !dragging) fireOnce(); });
addEventListener('mousemove', e => {
  if (!playing() || !(locked || dragging)) return;
  const k = player.zoom ? 0.0008 : 0.0022;
  player.yaw -= e.movementX * k;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - e.movementY * k));
});

// ---------- collision ----------
const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
function castDown(from, maxDist) { ray.set(from, DOWN); ray.far = maxDist; const h = ray.intersectObjects(world.solid, false); return h.length ? h[0] : null; }
function castDir(from, dir, maxDist) { ray.set(from, dir); ray.far = maxDist; const h = ray.intersectObjects(world.solid, false); return h.length ? h[0] : null; }

const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
function step(dt) {
  if (!world.group) return;
  if (player.dead) {
    player.respawnIn -= dt;
    if (player.respawnIn <= 0 && (firing || keys.has('Space') || player.respawnIn < -4)) respawn();
  } else {
    fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    right.set(fwd.z, 0, -fwd.x);
    const speed = keys.has('ShiftLeft') ? 3.2 : 5.5;
    tmp.set(0, 0, 0);
    if (keys.has('KeyW')) tmp.add(fwd);
    if (keys.has('KeyS')) tmp.sub(fwd);
    if (keys.has('KeyD')) tmp.add(right);
    if (keys.has('KeyA')) tmp.sub(right);
    if (tmp.lengthSq()) tmp.normalize().multiplyScalar(speed);
    player.vel.x = tmp.x; player.vel.z = tmp.z;
    player.vel.y -= 16 * dt;
    if (player.grounded && keys.has('Space')) { player.vel.y = 6; player.grounded = false; }
    const move = tmp.clone().multiplyScalar(dt);
    if (move.lengthSq() > 0) {
      const dir = move.clone().normalize();
      for (const h of [0.4, 1.2]) {
        const from = player.pos.clone(); from.y += h;
        const hit = castDir(from, dir, move.length() + player.radius);
        if (hit) {
          const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          if (n.dot(dir) > 0) n.negate();
          n.y = 0; n.normalize();
          move.sub(n.multiplyScalar(move.dot(n)));
          break;
        }
      }
    }
    player.pos.add(move);
    player.pos.y += player.vel.y * dt;
    const from = player.pos.clone(); from.y += 1.0;
    const hit = castDown(from, 1.3);
    if (hit && player.vel.y <= 0) { player.pos.y = hit.point.y; player.vel.y = 0; player.grounded = true; } else player.grounded = false;
    if (player.pos.y < -60) die(null);

    // weapons
    player.cool -= dt;
    if (player.reloading > 0) { player.reloading -= dt; if (player.reloading <= 0) finishReload(); }
    const w = curWeapon();
    if (firing && w && w.def.auto) fireOnce();
  }

  camera.position.copy(player.pos); camera.position.y += player.eye;
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  const wdef = curWeapon() && curWeapon().def;
  const fovWant = player.zoom && wdef && wdef.zoom ? 80 / wdef.zoom : 80;
  if (Math.abs(camera.fov - fovWant) > 0.1) { camera.fov += (fovWant - camera.fov) * 0.3; camera.updateProjectionMatrix(); }

  if (world.bots) world.bots.update(dt, player);
  if (world.proj) world.proj.update(dt, projectileHit);
  if (world.pickups && !player.dead) world.pickups.update(dt, player, takePickup);

  // match clock
  if (!match.over) {
    match.left -= dt;
    if (match.left <= 0) endMatch();
    $('#clock').textContent = `${Math.floor(Math.max(0, match.left) / 60)}:${String(Math.floor(Math.max(0, match.left) % 60)).padStart(2, '0')}`;
  }

  // view model bob/recoil
  const t = performance.now() / 1000;
  if (weapon) {
    const moving = tmp.lengthSq() > 0 && player.grounded ? 1 : 0;
    const target = weaponRest.clone().add(new THREE.Vector3(Math.sin(t * 7) * 0.004 * moving, Math.abs(Math.cos(t * 7)) * 0.006 * moving - recoil, recoil * 0.6));
    if (player.zoom) target.set(0, -0.12, -0.3);
    weapon.position.lerp(target, 0.3);
    recoil *= 0.75;
    for (const f of weapon.flash || []) f.visible = recoil > 0.012;
    weapon.visible = !player.dead;
  }
}

// ---------- player weapons ----------
let weapon = null, recoil = 0;
const weaponRest = new THREE.Vector3(0.18, -0.2, -0.38);
const viewModels = new Map();
const flash = new THREE.PointLight(0xffc070, 0, 6); scene.add(flash);
const tracerMat = new THREE.LineBasicMaterial({ color: 0xff8040, transparent: true, opacity: 0.9, depthWrite: false });
const tracers = [];

function curWeapon() { return player.weapons[player.cur] || null; }
function giveWeapon(key) {
  const def = WEAPONS[key]; if (!def) return false;
  let w = player.weapons.find(x => x.key === key);
  if (w) { if (w.ammo >= def.max) return false; w.ammo = Math.min(def.max, w.ammo + def.clip * 2); return true; }
  w = { key, def, clip: def.clip, ammo: Math.min(def.max, def.clip * 2) };
  player.weapons.push(w);
  player.weapons.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  selectWeapon(player.weapons.indexOf(w));
  return true;
}
function selectWeapon(i) {
  if (!player.weapons.length) return;
  player.cur = (i + player.weapons.length) % player.weapons.length;
  player.reloading = 0;
  showViewModel(curWeapon().key);
  updateHud();
}
function viewModel(key) {
  if (viewModels.has(key)) return viewModels.get(key);
  const p = `ob/guns/${key}_ph.raw`;
  if (!world.gun || !world.gun.has(p)) return null;
  const gm = parseModel(world.gun.get(p));
  const g = modelToGroup(gm, world.gunTex);
  g.scale.setScalar(0.12 * (gm.scale || 1));
  g.rotation.set(0, Math.PI, 0);
  g.flash = [];
  g.traverse(o => {
    if (!o.isMesh) return;
    const alpha = o.material.every(m => m.map && m.map.hasAlpha);
    if (o.userData.stream === 2 || (alpha && o.geometry.boundingSphere.radius > 0.25)) { o.visible = false; g.flash.push(o); }
  });
  viewModels.set(key, g);
  return g;
}
function showViewModel(key) {
  if (weapon) weaponScene.remove(weapon);
  weapon = viewModel(key);
  if (weapon) { weapon.position.copy(weaponRest).add(new THREE.Vector3(0, -0.15, 0)); weaponScene.add(weapon); }
}
function reload() {
  const w = curWeapon(); if (!w || player.reloading > 0 || w.clip >= w.def.clip || w.ammo <= 0) return;
  player.reloading = w.def.kind === 'beam' ? 1.2 : 1.6;
  sfx.play(w.def.reload || 'reload22_01', { volume: 0.6 });
}
function finishReload() {
  const w = curWeapon(); if (!w) return;
  const need = w.def.clip - w.clip, take = Math.min(need, w.ammo);
  w.clip += take; w.ammo -= take; updateHud();
}
function fireOnce() {
  const w = curWeapon();
  if (!w || player.dead || match.over || player.cool > 0 || player.reloading > 0) return;
  if (w.clip <= 0) { if (w.ammo > 0) reload(); else { sfx.play(SFX.dry, { volume: 0.5 }); player.cool = 0.3; } return; }
  const d = w.def;
  w.clip--; player.cool = 60 / d.rpm;
  recoil = d.kind === 'beam' ? 0.008 : Math.min(0.06, 0.012 + d.dmg / 1500);
  flash.intensity = d.quiet ? 4 : 30; flash.position.copy(camera.position);
  sfx.play(d.sfx, { volume: d.quiet ? 0.45 : 0.8 });
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const origin = camera.position.clone();
  if (d.kind === 'rocket' || d.kind === 'grenade') {
    const from = origin.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.15, 0));
    const tgt = world.bots && nearestBotInSight(origin, dir);
    world.proj.fire({ ...d, key: w.key }, from, dir, 'player', tgt ? tgt.group.position.clone().setY(tgt.group.position.y + 1) : null);
  } else {
    const n = d.pellets || 1;
    const range = d.kind === 'beam' ? d.range : 200;
    for (let i = 0; i < n; i++) {
      const s = d.spread * (player.zoom && d.zoom ? 0.3 : 1);
      const dd = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2)).normalize();
      hitscan(origin, dd, range, d.dmg, w.key, d.tracer);
    }
  }
  if (w.clip === 0 && w.ammo > 0) reload();
  updateHud();
}
function nearestBotInSight(origin, dir) {
  let best = null, bd = 0.9;
  for (const b of world.bots.list) {
    if (b.dead) continue;
    const to = b.group.position.clone().setY(b.group.position.y + 1).sub(origin);
    const dist = to.length(); to.normalize();
    const dot = to.dot(dir);
    if (dot > bd && dist < 60) { bd = dot; best = b; }
  }
  return best;
}
function hitscan(origin, dir, range, dmg, key, tracer) {
  ray.set(origin, dir); ray.far = range;
  const botGroups = world.bots ? world.bots.groups : [];
  const hits = ray.intersectObjects([...botGroups, ...world.solid], true);
  let end = origin.clone().addScaledVector(dir, range);
  if (hits.length) {
    end = hits[0].point;
    const bot = world.bots && world.bots.find(hits[0].object);
    if (bot) {
      if (world.bots.hit(bot, dmg, 'player')) { /* kill handled in onBotKilled */ }
      else if (dmg >= 15 && hurtVoices.length) sfx.play(pick(hurtVoices), { pos: bot.group.position, listener: camera.position, volume: 0.6 });
    } else if (Math.random() < 0.25) sfx.play(pick(SFX.ricochet), { pos: end, listener: camera.position, volume: 0.5 });
  }
  if (tracer) {
    const g = new THREE.BufferGeometry().setFromPoints([origin.clone().add(new THREE.Vector3(0.1, -0.1, 0)), end]);
    const l = new THREE.Line(g, tracerMat.clone()); l.material.color.set(tracer); l.userData.t = 0; scene.add(l); tracers.push(l);
  }
}
// Projectiles call this each step to see if they touched a character.
function projectileHit(p) {
  if (!world.bots) return null;
  for (const b of world.bots.list) {
    if (b.dead || (p.owner === b)) continue;
    const c = b.group.position.clone(); c.y += 0.9;
    if (c.distanceTo(p.pos) < 0.7) return b;
  }
  if (p.owner !== 'player' && !player.dead) {
    const c = player.pos.clone(); c.y += 0.8;
    if (c.distanceTo(p.pos) < 0.7) return 'player';
  }
  return null;
}
function splash(pos, radius, dmg, owner, direct) {
  if (world.bots) {
    if (direct && direct !== 'player') world.bots.hit(direct, dmg, owner);
    if (radius > 0.6) world.bots.splash(pos, radius, dmg, owner);
  }
  if (!player.dead) {
    const c = player.pos.clone(); c.y += 0.8;
    const d = c.distanceTo(pos);
    if (direct === 'player') damagePlayer(dmg, owner);
    else if (radius > 0.6 && d < radius) damagePlayer(Math.round(dmg * (1 - d / radius * 0.7) * (owner === 'player' ? 0.5 : 1)), owner);
  }
}

// ---------- damage, death, score ----------
function damagePlayer(dmg, by) {
  if (player.dead || dmg <= 0 || player.god) return;
  const absorbed = Math.min(player.armour, Math.round(dmg * 0.66));
  player.armour -= absorbed; player.hp -= dmg - absorbed; hurt = 0.3;
  if (hurtVoices.length) sfx.play(pick(hurtVoices), { volume: 0.5 });
  if (player.hp <= 0) die(by);
  updateHud();
}
function die(by) {
  player.dead = true; player.deaths++; player.respawnIn = 1.5; player.hp = 0;
  if (by && by.kills !== undefined) { by.kills++; }
  if (dieVoices.length) sfx.play(pick(dieVoices), { volume: 0.7 });
  msg(by && by.name ? `SPLIT BY ${by.name.toUpperCase()}` : 'YOU WERE SPLIT', 2500);
  updateHud(); updateBoard();
  if (by && by.kills >= match.limit) endMatch();
}
function respawn() {
  const nodes = world.nodes;
  if (nodes.length) { const s = pick(nodes); world.spawn.set(s.pos.x, s.pos.y + 0.2, s.pos.z); }
  player.pos.copy(world.spawn); player.vel.set(0, 0, 0); player.hp = 100; player.armour = 0; player.dead = false;
  player.weapons = []; giveWeapon('luger');
  const starter = pick(['uzi', 'tommygun', 'scifihandgun', 'doublebarrelshotgun']);
  giveWeapon(starter);
  updateHud();
}
function onBotKilled(bot, by) {
  if (by === 'player') { player.kills++; msg(`SPLIT  ${bot.name.toUpperCase()}`); if (dieVoices.length) sfx.play(pick(dieVoices), { pos: bot.group.position, listener: camera.position }); if (player.kills >= match.limit) endMatch(); }
  else if (by && by.kills !== undefined) { by.kills++; if (by.kills >= match.limit) endMatch(); }
  updateHud(); updateBoard();
}
function onBotShoot(bot, w, from, target, hits) {
  sfx.play(w.sfx, { pos: from, listener: camera.position, volume: w.quiet ? 0.3 : 0.55, rate: 0.95 + Math.random() * 0.1 });
  const dir = target.clone().sub(from).normalize();
  if (w.kind === 'rocket' || w.kind === 'grenade') { world.proj.fire({ ...w, key: bot.weapon }, from, dir, bot, target.clone()); return; }
  if (hits) {
    // Friendly fire between bots: whoever stands in the way takes it first.
    ray.set(from, dir); ray.far = 60;
    const others = world.bots.list.filter(b => b !== bot && !b.dead).map(b => b.group);
    const hs = ray.intersectObjects([...others, ...world.solid], true);
    const dist = from.distanceTo(target);
    if (hs.length && hs[0].distance < dist - 0.5) { const ob = world.bots.find(hs[0].object); if (ob) world.bots.hit(ob, w.dmg * (w.pellets || 1) * 0.5, bot); return; }
    damagePlayer(Math.round(w.dmg * (w.pellets ? w.pellets * 0.4 : 1)), bot);
  }
}
function takePickup(p) {
  if (p.kind === 'weapon') { if (!giveWeapon(p.key)) return false; sfx.play(SFX.pickup, { volume: 0.7 }); msg(slotName(p.key).toUpperCase()); }
  else if (p.kind === 'ammo') { const w = curWeapon(); if (!w || w.ammo >= w.def.max) return false; w.ammo = Math.min(w.def.max, w.ammo + w.def.clip * 2); sfx.play(SFX.ammo, { volume: 0.7 }); msg('AMMO'); }
  else if (p.kind === 'health') { if (player.hp >= 100) return false; player.hp = Math.min(100, player.hp + 25); sfx.play(SFX.health, { volume: 0.7 }); msg('HEALTH'); }
  else if (p.kind === 'armour') { if (player.armour >= 100) return false; player.armour = Math.min(100, player.armour + 50); sfx.play(SFX.armour, { volume: 0.7 }); msg('ARMOUR'); }
  updateHud();
  return true;
}
function updateHud() {
  $('#hp').textContent = Math.max(0, player.hp); $('#armour').textContent = player.armour;
  const w = curWeapon();
  $('#wname').textContent = w ? slotName(w.key).toUpperCase() : '';
  $('#clip').textContent = w ? w.clip : 0; $('#ammo').textContent = w ? w.ammo : 0;
  $('#kills').textContent = player.kills; $('#limit').textContent = match.limit;
}
function updateBoard() {
  const rows = [{ name: player.name, kills: player.kills, deaths: player.deaths, me: true }, ...(world.bots ? world.bots.list.map(b => ({ name: b.name, kills: b.kills, deaths: b.deaths })) : [])];
  rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  $('#board').innerHTML = '<table>' + rows.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${r.name}</td><td>${r.deaths}</td><td>${r.kills}</td></tr>`).join('') + '</table>';
}
function endMatch() {
  if (match.over) return;
  match.over = true; firing = false;
  updateBoard();
  const rows = [{ name: player.name, kills: player.kills }, ...world.bots.list.map(b => ({ name: b.name, kills: b.kills }))].sort((a, b) => b.kills - a.kills);
  const win = rows[0].name === player.name;
  $('#end').innerHTML = `${win ? 'YOU WIN' : rows[0].name.toUpperCase() + ' WINS'}<div class="fine">${rows.map(r => `${r.name} ${r.kills}`).join(' &nbsp;·&nbsp; ')}</div><div class="fine">Press Enter for the menu</div>`;
  $('#end').hidden = false; $('#board').hidden = false;
  if (document.exitPointerLock) document.exitPointerLock();
}
addEventListener('keydown', e => { if (e.code === 'Enter' && match.over) { $('#end').hidden = true; $('#board').hidden = true; $('#setup').hidden = false; } });

// ---------- loading ----------
async function enter(levelName) {
  status('Loading…');
  const n = levelName.match(ARENA)[1];
  const [lvlBuf, gunBuf, sndBuf, animBuf, feBuf] = await Promise.all([fileBuf(levelName), fileBuf('gun.pak'), fileBuf('sounds.pak'), fileBuf('anim.pak'), fileBuf('fe_anim.pak')]);
  const pak = new Pak(lvlBuf, levelName);
  world.gun = new Pak(gunBuf, 'gun.pak'); world.gunTex = new TexSource(world.gun);
  if (!sfx.pak) {
    sfx = new Sfx(new Pak(sndBuf, 'sounds.pak'));
    for (const p of sfx.pak.list('sfx/male')) { const nm = p.slice(4, -4); if (/_die\d+$/.test(nm)) dieVoices.push(nm); else if (/22_\d+$/.test(nm)) hurtVoices.push(nm); }
  }
  if (!anims) {
    const ap = new Pak(animBuf, 'anim.pak'), fe = new Pak(feBuf, 'fe_anim.pak');
    anims = new Map();
    const PFX = 'anim/data/ts2/';
    for (const p of ap.list(PFX)) { try { anims.set(p.slice(PFX.length, -4), parseAnim(ap.get(p))); } catch (e) { /* skip */ } }
    try { bind = makeBind(parseAnim(fe.get('anim/data/ts2/human_19_bindpose.raw'))); } catch (e) { console.warn('bind pose failed', e); }
  }
  const texSrc = new TexSource(pak);

  // Clear the previous arena.
  if (world.group) scene.remove(world.group);
  if (world.sky) scene.remove(world.sky);
  if (world.bots) for (const b of world.bots.list) scene.remove(b.group);
  if (world.pickups) for (const p of world.pickups.list) scene.remove(p.group);
  if (world.proj) for (const p of world.proj.list) world.proj.remove(p);
  for (const t of tracers) scene.remove(t); tracers.length = 0;

  const map = parseMap(pak.get(`bg/level${n}/level${n}.raw`));
  const built = mapToGroup(map, texSrc);
  world.group = built.group; world.solid = built.solid;
  scene.add(world.group); world.group.updateMatrixWorld(true);

  const skyName = pak.list('ob/skies/')[0];
  world.sky = null;
  if (skyName) {
    try {
      const sm = parseModel(pak.get(skyName));
      const sky = modelToGroup(sm, texSrc);
      sky.traverse(o => { if (o.isMesh) { o.material.forEach(m => { m.depthWrite = false; m.depthTest = false; }); o.renderOrder = -100; o.frustumCulled = false; } });
      sky.scale.setScalar(sm.scale || 1);
      world.sky = sky; scene.add(sky);
    } catch (e) { console.warn('sky failed', e); }
  }

  const padBytes = pak.tryGet(`pad/data/level${n}.raw`);
  world.pad = padBytes ? parsePad(padBytes) : { nodes: [], links: [] };
  world.nodes = world.pad.nodes.filter(nd => Number.isFinite(nd.pos[0])).map(nd => ({ pos: new THREE.Vector3(...nd.pos) }));
  if (!world.nodes.length) { const box = new THREE.Box3().setFromObject(world.group); const c = box.getCenter(new THREE.Vector3()); c.y = box.max.y - 1; world.nodes.push({ pos: c }); }

  // Projectiles, pickups, bots.
  const protos = {};
  for (const [k, p] of [['missile', 'ob/guns/missile.raw'], ['grenadelauncher', 'ob/guns/missile.raw'], ['tnt', 'ob/guns/tnt_cl.raw'], ['brick', 'ob/guns/brick_cl.raw']]) {
    if (world.gun.has(p)) { const m = parseModel(world.gun.get(p)); const g = modelToGroup(m, world.gunTex, { lit: true }); g.scale.setScalar((m.scale || 1) * (k === 'missile' ? 0.5 : 1)); protos[k] = g; }
  }
  world.proj = new Projectiles({ scene, solid: world.solid, onSplash: splash, sfx, models: protos });
  world.proj.listener = camera.position;
  world.pickups = new Pickups({ scene, pak, gun: world.gun, texSrc, gunTex: world.gunTex, nodes: world.nodes, sfx, roster: BOT_WEAPONS.concat(['minigun', 'homingrocketlauncher', 'sniperrifle', 'flamethrower', 'electrogun', 'tnt']) });
  world.pickups.place(Math.min(24, Math.max(8, Math.floor(world.nodes.length / 6))));
  world.bots = new Bots({ pak, gun: world.gun, texSrc, gunTex: world.gunTex, pad: world.pad, scene, solid: world.solid, anims, bind, onShoot: onBotShoot, onBotKilled, names: BOT_NAMES.slice().sort(() => Math.random() - 0.5) });
  world.bots.spawn(Math.min(parseInt($('#botcount').value) || 4, Math.max(1, world.bots.models.length * 2)));

  match.limit = parseInt($('#killlimit').value) || 10; match.left = match.time; match.over = false;
  player.kills = 0; player.deaths = 0;
  respawn(); updateBoard();
  $('#setup').hidden = true; $('#hud').hidden = false; $('#end').hidden = true;
  status(`${pickedFiles.size || ''} ready.`);
  grabMouse();
  msg(`${(THEME[n] || 'ARENA ' + n).toUpperCase()}  ·  FIRST TO ${match.limit}`, 3000);
  playMusic();
  let tris = 0; world.group.traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  console.log(`arena ${n}: ${map.sections.length} sections, ${tris} tris, ${map.materials.length} materials, ${world.nodes.length} nav nodes, ${world.bots.list.length} bots, ${world.pickups.list.length} pickups, ${anims ? anims.size : 0} clips`);
}

$('#go').addEventListener('click', () => enter($('#level').value).catch(e => { status(e.message); console.error(e); }));
addEventListener('keydown', e => { if (e.code === 'Escape' && world.group && !match.over) { $('#setup').hidden = false; firing = false; } });
$('#setup').addEventListener('click', e => { if (world.group && e.target === $('#setup')) { $('#setup').hidden = true; grabMouse(); } });

// Debug handle for the console; tick() forces frames when the tab is not being painted.
window.sundial = { scene, weaponScene, world, player, camera, match, get weapon() { return weapon; }, fireOnce, giveWeapon, selectWeapon, tick: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) render(dt); } };

// ---------- loop ----------
let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; render(dt); requestAnimationFrame(frame); }
function render(dt) {
  if (playing()) step(dt);
  else if (world.group) { camera.position.copy(player.pos); camera.position.y += player.eye; }
  if (world.sky) world.sky.position.copy(camera.position);
  flash.intensity *= 0.6;
  for (const t of tracers) { t.userData.t += dt; t.material.opacity = Math.max(0, 0.9 - t.userData.t * 8); if (t.userData.t > 0.15) { scene.remove(t); t.userData.done = true; } }
  if (tracers.some(t => t.userData.done)) tracers.splice(0, tracers.length, ...tracers.filter(t => !t.userData.done));
  if (hurt > 0) { hurt -= dt; $('#hud').style.boxShadow = `inset 0 0 ${80 * hurt * 4}px #d00`; } else $('#hud').style.boxShadow = '';
  renderer.autoClear = true;
  renderer.render(scene, camera);
  if (weapon && !player.zoom) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(weaponScene, weaponCam); }
}
requestAnimationFrame(frame);
