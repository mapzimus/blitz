// SUNDIAL: browser runtime for a PS2 arena shooter, fed from the player's own disc copy.
import * as THREE from 'three';
import { Pak } from './pak.js';
import { parseMap } from './map.js';
import { parsePad } from './pad.js';
import { parseModel } from './model.js';
import { TexSource, mapToGroup, modelToGroup } from './build.js';
import { cache } from './store.js';
import { Bots } from './bots.js';
import { Sfx } from './audio.js';

const $ = s => document.querySelector(s);
const status = t => { $('#dirstatus').textContent = t; };
const msg = (t, ms = 2000) => { const el = $('#msg'); el.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => (el.textContent = ''), ms); };

// ---------- file acquisition ----------
let pickedFiles = new Map(); // lowercase name -> File
const NEEDED = ['gun.pak', 'sounds.pak'];
let sfx = new Sfx(null);
const hurtVoices = [], dieVoices = [];
const pick = a => a[Math.floor(Math.random() * a.length)];
const ARENA = /^l_(\d+)_ar\.pak$/;

// Dev mode: ?src=/disc/PAK/ fetches archives from a local server instead of the folder picker.
const SRC = new URLSearchParams(location.search).get('src');

async function fileBuf(name) {
  name = name.toLowerCase();
  if (SRC) {
    const sub = ARENA.test(name) ? 'ARCADE/' : '';
    const r = await fetch(SRC + sub + name.toUpperCase());
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
  if (SRC) for (const n of [10, 11, 13, 21, 29, 32, 33, 34, 35, 36, 42, 43, 45, 46, 47, 48, 50, 55, 56, 64, 65, 100, 101, 102, 103, 104, 105, 106]) pickedFiles.set(`l_${n}_ar.pak`, true);
  if (SRC) { pickedFiles.set('gun.pak', true); pickedFiles.set('sounds.pak', true); }
  const names = new Set([...cached, ...pickedFiles.keys()].filter(n => ARENA.test(n)));
  const sel = $('#level');
  sel.innerHTML = '';
  const sorted = [...names].sort((a, b) => parseInt(a.match(ARENA)[1]) - parseInt(b.match(ARENA)[1]));
  for (const n of sorted) {
    const o = document.createElement('option');
    o.value = n; o.textContent = `Arena ${n.match(ARENA)[1]}${cached.has(n) ? ' (cached)' : ''}`;
    sel.appendChild(o);
  }
  const haveGun = NEEDED.every(n => cached.has(n) || pickedFiles.has(n));
  $('#levelrow').hidden = !(sorted.length && haveGun);
  $('#cachenote').textContent = cached.size ? `${cached.size} archive(s) kept in this browser. Nothing is uploaded anywhere.` : '';
  if (sorted.length && haveGun) status(`${sorted.length} arenas available.`);
  else if (sorted.length) status('Found arenas but not GUN.PAK / SOUNDS.PAK. Pick the PAK folder itself.');
}

$('#dir').addEventListener('change', e => {
  pickedFiles = new Map();
  for (const f of e.target.files) if (/\.pak$/i.test(f.name)) pickedFiles.set(f.name.toLowerCase(), f);
  status(pickedFiles.size ? `Found ${pickedFiles.size} archives.` : 'No .PAK files in that folder. Pick the PAK directory from the disc copy.');
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
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  weaponCam.aspect = w / h; weaponCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const world = { group: null, solid: [], pad: null, spawn: new THREE.Vector3(0, 2, 0), targets: [], bots: null };
scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x3a3328, 1.6));
const sun = new THREE.DirectionalLight(0xfff0dd, 1.2); sun.position.set(3, 10, 4); scene.add(sun);
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  eye: 1.5, radius: 0.35, grounded: false, hp: 100, ammo: 40, kills: 0,
};
const keys = new Set();
addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.code));
// Pointer lock when the browser allows it; otherwise hold the mouse button to look (embedded browsers).
let locked = false, noLock = false, dragging = false;
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
async function grabMouse() {
  if (noLock || locked) return;
  try { await canvas.requestPointerLock(); } catch (e) { noLock = true; msg('HOLD MOUSE BUTTON TO LOOK', 3000); }
}
const playing = () => world.group && $('#setup').hidden;
canvas.addEventListener('mousedown', e => { if (!playing()) return; if (!locked && !noLock) grabMouse(); else if (locked) fire(); else dragging = true; });
canvas.addEventListener('mouseup', () => { dragging = false; });
canvas.addEventListener('click', () => { if (playing() && noLock && !dragging) fire(); });
addEventListener('mousemove', e => {
  if (!playing() || !(locked || dragging)) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - e.movementY * 0.0022));
});

const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
function castDown(from, maxDist) {
  ray.set(from, DOWN); ray.far = maxDist;
  const hits = ray.intersectObjects(world.solid, false);
  return hits.length ? hits[0] : null;
}
function castDir(from, dir, maxDist) {
  ray.set(from, dir); ray.far = maxDist;
  const hits = ray.intersectObjects(world.solid, false);
  return hits.length ? hits[0] : null;
}

const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
function step(dt) {
  if (!world.group) return;
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

  // Walls: probe along the move direction at knee and chest height.
  const move = tmp.clone().multiplyScalar(dt);
  if (move.lengthSq() > 0) {
    const dir = move.clone().normalize();
    for (const h of [0.4, 1.2]) {
      const from = player.pos.clone(); from.y += h;
      const hit = castDir(from, dir, move.length() + player.radius);
      if (hit) {
        // Slide along the wall.
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

  // Floor: ray from waist down.
  const from = player.pos.clone(); from.y += 1.0;
  const hit = castDown(from, 1.0 + 0.3);
  if (hit && player.vel.y <= 0) {
    player.pos.y = hit.point.y; player.vel.y = 0; player.grounded = true;
  } else player.grounded = false;
  if (player.pos.y < -60) { respawn(); }

  camera.position.copy(player.pos); camera.position.y += player.eye;
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;

  if (world.bots) world.bots.update(dt, player);
  // targets bob + spin
  const t = performance.now() / 1000;
  for (const tg of world.targets) if (tg.visible) { tg.rotation.y = t * 1.5; tg.position.y = tg.userData.y + Math.sin(t * 2 + tg.userData.y) * 0.1; }
  if (weapon) {
    weapon.position.lerp(weaponRest.clone().add(new THREE.Vector3(Math.sin(t * 7) * 0.004 * (tmp.lengthSq() ? 1 : 0), Math.abs(Math.cos(t * 7)) * 0.006 * (tmp.lengthSq() ? 1 : 0) - recoil, 0)), 0.3);
    recoil *= 0.75;
    for (const f of weapon.flash || []) f.visible = recoil > 0.012;
  }
}

function respawn() {
  const nodes = world.pad ? world.pad.nodes.filter(nd => Number.isFinite(nd.pos[0])) : [];
  if (nodes.length) { const s = nodes[Math.floor(Math.random() * nodes.length)]; world.spawn.set(s.pos[0], s.pos[1] + 0.2, s.pos[2]); }
  player.pos.copy(world.spawn); player.vel.set(0, 0, 0); player.hp = 100; player.ammo = Math.max(player.ammo, 40);
  $('#hp').textContent = player.hp; $('#ammo').textContent = player.ammo;
}
let hurt = 0;
function playerHit(bot, dmg) {
  sfx.play('gun_laser02_me_22', { pos: bot.group.position, listener: camera.position, volume: 0.5, rate: 0.9 + Math.random() * 0.2 });
  if (!dmg) return;
  player.hp -= dmg; hurt = 0.25;
  if (hurtVoices.length) sfx.play(pick(hurtVoices), { volume: 0.5 });
  $('#hp').textContent = Math.max(0, player.hp);
  if (player.hp <= 0) { player.deaths = (player.deaths || 0) + 1; msg('YOU WERE SPLIT', 2000); respawn(); }
}

// ---------- weapon ----------
let weapon = null, recoil = 0;
const weaponRest = new THREE.Vector3(0.18, -0.2, -0.38);
const flash = new THREE.PointLight(0xffc070, 0, 6);
scene.add(flash);
function fire() {
  if (!world.group) return;
  if (player.ammo <= 0) { msg('OUT OF AMMO'); return; }
  player.ammo--; $('#ammo').textContent = player.ammo;
  recoil = 0.03; flash.intensity = 30; flash.position.copy(camera.position);
  sfx.play('gun_laser01b_me_22', { volume: 0.8 });
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  ray.set(camera.position, dir); ray.far = 200;
  const botGroups = world.bots ? world.bots.groups : [];
  const hits = ray.intersectObjects([...botGroups, ...world.targets.filter(t => t.visible), ...world.solid], true);
  if (hits.length) {
    const bot = world.bots && world.bots.find(hits[0].object);
    if (bot) {
      if (world.bots.hit(bot, 34)) { player.kills++; msg(`SPLIT  ${player.kills}`); if (dieVoices.length) sfx.play(pick(dieVoices), { pos: bot.group.position, listener: camera.position }); }
      else if (hurtVoices.length) sfx.play(pick(hurtVoices), { pos: bot.group.position, listener: camera.position, volume: 0.7 });
      return;
    }
    let o = hits[0].object; while (o.parent && !o.userData.target) o = o.parent;
    if (o.userData.target) { o.visible = false; player.ammo = Math.min(99, player.ammo + 20); $('#ammo').textContent = player.ammo; msg('+20 AMMO'); sfx.play('getammo22_03'); }
  }
}

// ---------- loading ----------
async function enter(levelName) {
  status('Loading…');
  const n = levelName.match(ARENA)[1];
  const [lvlBuf, gunBuf, sndBuf] = await Promise.all([fileBuf(levelName), fileBuf('gun.pak'), fileBuf('sounds.pak')]);
  const pak = new Pak(lvlBuf, levelName);
  const gun = new Pak(gunBuf, 'gun.pak');
  if (!sfx.pak) {
    sfx = new Sfx(new Pak(sndBuf, 'sounds.pak'));
    for (const p of sfx.pak.list('sfx/male')) {
      const n = p.slice(4, -4);
      if (/_die\d+$/.test(n)) dieVoices.push(n); else if (/22_\d+$/.test(n)) hurtVoices.push(n);
    }
  }
  const texSrc = new TexSource(pak);

  if (world.group) scene.remove(world.group);
  for (const t of world.targets) scene.remove(t);
  world.targets = [];

  const map = parseMap(pak.get(`bg/level${n}/level${n}.raw`));
  const built = mapToGroup(map, texSrc);
  world.group = built.group; world.solid = built.solid;
  scene.add(world.group);
  world.group.updateMatrixWorld(true);

  // Sky: a model drawn around the camera, if the arena ships one.
  const skyName = pak.list('ob/skies/')[0];
  if (skyName) {
    try {
      const sky = modelToGroup(parseModel(pak.get(skyName)), texSrc);
      sky.traverse(o => { if (o.isMesh) { o.material.forEach(m => { m.depthWrite = false; m.depthTest = false; }); o.renderOrder = -100; o.frustumCulled = false; } });
      sky.scale.setScalar(parseModel(pak.get(skyName)).scale || 1);
      world.sky = sky; scene.add(sky);
    } catch (e) { console.warn('sky failed', e); }
  }

  // Spawn + targets from the nav graph.
  const padBytes = pak.tryGet(`pad/data/level${n}.raw`);
  world.pad = padBytes ? parsePad(padBytes) : { nodes: [] };
  const nodes = world.pad.nodes.filter(nd => Number.isFinite(nd.pos[0]));
  if (nodes.length) {
    const s = nodes[0]; world.spawn.set(s.pos[0], s.pos[1] + 0.2, s.pos[2]);
  } else {
    const box = new THREE.Box3().setFromObject(world.group); box.getCenter(world.spawn); world.spawn.y = box.max.y - 1;
  }
  // Targets: the arena's own pickup props placed on nav nodes.
  const pickups = pak.list('ob/pickups/').concat(pak.list('ob/armour/'), pak.list('ob/health1/'));
  if (pickups.length) {
    const stride = Math.max(1, Math.floor(nodes.length / 12));
    const models = pickups.map(p => { try { return parseModel(pak.get(p)); } catch (e) { return null; } }).filter(Boolean);
    for (let i = stride, k = 0; i < nodes.length && k < 12; i += stride, k++) {
      const m = models[k % models.length];
      const g = modelToGroup(m, texSrc);
      g.scale.setScalar(m.scale || 1);
      g.position.set(nodes[i].pos[0], nodes[i].pos[1] + 0.6, nodes[i].pos[2]);
      g.userData = { target: true, y: g.position.y };
      scene.add(g); world.targets.push(g);
    }
  }

  // Weapon view model.
  weaponScene.clear();
  const gunName = ['ob/guns/laser_ph.raw', 'ob/guns/plasmamachinegun_ph.raw'].find(p => gun.has(p)) || gun.list('ob/guns/').find(p => p.endsWith('_ph.raw'));
  if (gunName) {
    const gm = parseModel(gun.get(gunName));
    weapon = modelToGroup(gm, new TexSource(gun));
    weapon.scale.setScalar(0.12 * (gm.scale || 1));
    weapon.position.copy(weaponRest);
    weapon.rotation.set(0, Math.PI, 0);
    // Gun models carry their muzzle flash as big alpha-textured quads; only show those while firing.
    weapon.flash = [];
    weapon.traverse(o => {
      if (!o.isMesh) return;
      const alpha = o.material.every(m => m.map && m.map.hasAlpha);
      if (o.userData.stream === 2 || (alpha && o.geometry.boundingSphere.radius > 0.25)) { o.visible = false; weapon.flash.push(o); }
    });
    weaponScene.add(weapon);
    weaponScene.add(new THREE.AmbientLight(0xffffff, 1));
  }

  // Bots: the arena's own roster, patrolling its nav graph.
  if (world.bots) for (const b of world.bots.list) scene.remove(b.group);
  world.bots = new Bots({ pak, texSrc, pad: world.pad, scene, solid: world.solid, onPlayerHit: playerHit, onBotKilled: () => {} });
  world.bots.spawn(Math.min(4, Math.max(1, world.bots.models.length)));

  player.kills = 0; player.ammo = 40; $('#ammo').textContent = player.ammo;
  respawn();
  $('#setup').hidden = true; $('#hud').hidden = false;
  status(`${pickedFiles.size || ''} ready.`);
  grabMouse();
  msg(`ARENA ${n}`, 2500);
  // Report what we drew, handy while tuning.
  let tris = 0; world.group.traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  console.log(`arena ${n}: ${map.sections.length} sections, ${tris} tris, ${map.materials.length} materials, ${nodes.length} nav nodes, ${world.targets.length} targets`);
}

$('#go').addEventListener('click', () => enter($('#level').value).catch(e => { status(e.message); console.error(e); }));
addEventListener('keydown', e => { if (e.code === 'Escape' && world.group) { $('#setup').hidden = false; } });
$('#setup').addEventListener('click', e => { if (world.group && e.target === $('#setup')) { $('#setup').hidden = true; grabMouse(); } });

// Debug handle for the console; tick() forces frames when the tab is not being painted.
window.sundial = { scene, weaponScene, world, player, camera, get weapon() { return weapon; }, tick: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) render(dt); } };

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  render(dt);
  requestAnimationFrame(frame);
}
function render(dt) {
  if (playing()) step(dt);
  else if (world.group) { camera.position.copy(player.pos); camera.position.y += player.eye; }
  if (world.sky) world.sky.position.copy(camera.position);
  flash.intensity *= 0.6;
  if (hurt > 0) { hurt -= dt; $('#hud').style.boxShadow = `inset 0 0 ${80 * hurt * 4}px #d00`; } else $('#hud').style.boxShadow = '';
  renderer.autoClear = true;
  renderer.render(scene, camera);
  if (weapon) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(weaponScene, weaponCam); }
}
requestAnimationFrame(frame);
