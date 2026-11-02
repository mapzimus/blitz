// SUNDIAL: browser runtime for a PS2 arena shooter, fed from the player's own disc copy or asset pack.
import * as THREE from 'three';
import { Pak } from './pak.js';
import { parseMap } from './map.js';
import { parsePad } from './pad.js';
import { parseModel } from './model.js';
import { parseAnim } from './anim.js';
import { makeBind } from './skeleton.js';
import { TexSource, mapToGroup, modelToGroup, hideFlash } from './build.js';
import { LEAGUE, loadProgress, record, medalFor, unlocked, findMatch } from './league.js';
import { touch, initTouch } from './touch.js';
import { cache } from './store.js';
import { Bots } from './bots.js';
import { Sfx } from './audio.js';
import { WEAPONS, ORDER, BOT_WEAPONS, SFX, slotName, setText } from './weapons.js';
import { TextTable, ARENA_TEXT, STORY_TEXT } from './text.js';
import { Projectiles } from './projectiles.js';
import { Pickups } from './pickups.js';
import { Music } from './music.js';
import { Fx } from './fx.js';
import { Story, placed } from './story.js';
import { MISSIONS, loadMission } from './missions/index.js';

const $ = s => document.querySelector(s);
const status = t => { $('#dirstatus').textContent = t; };
const msg = (t, ms = 2000) => { const el = $('#msg'); el.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => (el.textContent = ''), ms); };
const pick = a => a[Math.floor(Math.random() * a.length)];
let text = new TextTable(null); // the disc's own UI strings, once the front-end pack is available
const arenaName = (id, kind) => text.get(kind === 'st' ? STORY_TEXT[id] : ARENA_TEXT[id], `${kind === 'st' ? 'Map' : 'Arena'} ${id}`);

// ---------- file acquisition ----------
let pickedFiles = new Map(); // lowercase name -> File
const NEEDED = ['gun.pak', 'sounds.pak', 'anim.pak', 'fe_anim.pak'];
const ARENA = /^l_(\d+)_(ar|st)\.pak$/;
const ARENA_IDS = [10, 11, 13, 21, 29, 32, 33, 34, 35, 36, 42, 43, 45, 46, 47, 48, 50, 55, 56, 64, 65];
const STORY_IDS = [10, 11, 20, 31, 32, 34, 35, 38, 39, 40, 41, 45, 46, 47, 48];
const FRONTEND = 'l_103.pak'; // front-end pack: holds the UI text table
// Only this site or a loopback dev server may feed archives; anything else in the URL is ignored.
const okOrigin = s => { try { const u = new URL(s, location.href); return u.origin === location.origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u.origin); } catch (e) { return false; } };
const Q = new URLSearchParams(location.search);
const SRC = okOrigin(Q.get('src') || '') ? Q.get('src') : null; // dev: fetch archives from a local server
const PACK_URL = okOrigin(Q.get('pack') || '') ? Q.get('pack') : null; // one-time asset pack download
const NAME_OK = /^(gun|sounds|anim|fe_anim|chr|l_103)\.pak$|^l_\d+_(ar|st)\.pak$|^\d{4}\.mib$|^story\/level\d+\.json$/;
const MUSIC_TRACKS = [...Array(30)].map((_, i) => 1030 + i); // MUSIC1 folder, 1030-1059
// Private site: the archives sit on this origin under /pack/sundial/<name>, served with ranges by a
// Pages Function from a private bucket behind the login gate. Detected once at boot.
const SITE_ROOT = location.pathname.replace(/games\/sundial\/.*$/, '');
let SITE_PACK = null;

async function fileBuf(name) {
  name = name.toLowerCase();
  if (!NAME_OK.test(name)) throw new Error(`Unexpected archive name ${name}`);
  if (SITE_PACK) {
    const hit = await cache.get(name);
    if (hit) return hit;
    status(`Fetching ${name} from this site…`);
    const r = await fetch(SITE_PACK + name);
    if (!r.ok) throw new Error(`${r.status} fetching ${name}`);
    const buf = await r.arrayBuffer();
    try { await cache.put(name, buf); } catch (e) { /* storage full: still play from memory */ }
    return buf;
  }
  if (SRC) {
    let path = name.toUpperCase(), base = SRC;
    if (name.startsWith('story/')) { path = name; base = SRC.replace(/PAK\/?$/i, ''); } // story data sits beside the PAK folder
    else if (ARENA.test(name)) path = (name.endsWith('_st.pak') ? 'STORY/' : 'ARCADE/') + path;
    else if (name === FRONTEND) path = 'ARCADE/' + path;
    else if (/^\d{4}\.mib$/.test(name)) { const id = parseInt(name); path = `../MUSIC/MUSIC${id < 1030 ? 0 : id < 1060 ? 1 : 2}/${path}`; }
    const r = await fetch(base + path);
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
  if (SRC || SITE_PACK) {
    for (const n of ARENA_IDS) pickedFiles.set(`l_${n}_ar.pak`, true);
    for (const n of STORY_IDS) pickedFiles.set(`l_${n}_st.pak`, true);
    for (const n of NEEDED) pickedFiles.set(n, true);
    for (const n of MUSIC_TRACKS) pickedFiles.set(`${n}.mib`, true);
    pickedFiles.set(FRONTEND, true);
  }
  // UI strings from the player's own front-end pack, when present.
  if (!text.size && (cached.has(FRONTEND) || pickedFiles.has(FRONTEND))) {
    try {
      const fe = new Pak(await fileBuf(FRONTEND), FRONTEND);
      const strName = fe.list('boss/').find(p => /_e\.str$/.test(p)) || fe.list('boss/').find(p => p.endsWith('.str'));
      if (strName) { text = new TextTable(fe.get(strName)); setText(text); renderLeague(); renderMissions(); }
    } catch (e) { console.warn('text table', e.message); }
  }
  const names = new Set([...cached, ...pickedFiles.keys()].filter(n => ARENA.test(n)));
  const sel = $('#level');
  sel.innerHTML = '';
  const sorted = [...names].sort((a, b) => (a.endsWith('_st.pak') - b.endsWith('_st.pak')) || parseInt(a.match(ARENA)[1]) - parseInt(b.match(ARENA)[1]));
  for (const n of sorted) {
    const o = document.createElement('option');
    const [, id, kind] = n.match(ARENA);
    o.value = n; o.textContent = kind === 'st' ? `Story map: ${arenaName(id, 'st')}` : `${arenaName(id, 'ar')} (${id})${cached.has(n) ? ' ·cached' : ''}`;
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

// ---------- asset pack: 'SNDL' u32 count, then per file u16 nameLen, name, u32 size; bodies follow ----------
async function importPack(buf, onProgress) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'SNDL') throw new Error('Not an asset pack.');
  const count = dv.getUint32(4, true);
  if (count > 256) throw new Error('Pack header is not sane.');
  const dec = new TextDecoder();
  const entries = []; let p = 8;
  for (let i = 0; i < count; i++) {
    if (p + 6 > buf.byteLength) throw new Error('Pack is truncated.');
    const nl = dv.getUint16(p, true); const name = dec.decode(u8.subarray(p + 2, p + 2 + nl)).toLowerCase(); p += 2 + nl;
    const size = dv.getUint32(p, true); p += 4;
    if (!NAME_OK.test(name)) throw new Error(`Pack holds an unexpected file: ${name}`);
    entries.push({ name, size });
  }
  if (entries.reduce((s, e) => s + e.size, 0) + p > buf.byteLength) throw new Error('Pack is truncated.');
  for (const e of entries) {
    await cache.put(e.name, buf.slice(p, p + e.size));
    p += e.size;
    if (onProgress) onProgress(e.name);
  }
  return entries.length;
}
$('#packfile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  status(`Reading ${f.name} (${(f.size / 1e6).toFixed(0)} MB)…`);
  try { const n = await importPack(await f.arrayBuffer(), name => status(`Stored ${name}`)); status(`${n} files kept in this browser. You will not need the pack again here.`); }
  catch (err) { status(err.message); }
  pickedFiles = new Map();
  refreshLevelList();
});
async function fetchPack(url) {
  status('Downloading asset pack…');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} fetching the pack`);
  const total = +r.headers.get('content-length') || 0;
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; status(`Downloading asset pack… ${(got / 1e6).toFixed(0)}${total ? ' / ' + (total / 1e6).toFixed(0) : ''} MB`); }
  const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  const n = await importPack(buf.buffer, name => status(`Stored ${name}`));
  status(`${n} files kept in this browser.`);
  history.replaceState(null, '', location.pathname);
}
(async () => {
  if (!SRC) {
    // Private site: archives on this origin. A HEAD on the gun pack says whether they are there.
    try {
      const base = SITE_ROOT + 'pack/sundial/';
      const r = await fetch(base + 'gun.pak', { method: 'HEAD' });
      if (r.ok) { SITE_PACK = base; status('Archives found on this site.'); $('#pickrow').hidden = true; $('#setup .panel > p').textContent = 'The archives load from this site. Pick a mode and arena, then ENTER.'; }
    } catch (e) { /* not on the private site */ }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  if (PACK_URL && !SRC && !SITE_PACK) { try { const ks = await cache.keys(); if (!ks.includes('gun.pak')) await fetchPack(PACK_URL); } catch (e) { status(e.message); } }
  refreshLevelList();
})();

// ---------- engine ----------
const canvas = $('#gl');
initTouch(Q.get('touch') === '1');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Phones render at up to 1.5x density: their 3x screens would otherwise draw four times the pixels for little visible gain.
renderer.setPixelRatio(Math.min(devicePixelRatio, touch.active ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 400);
const weaponCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
const weaponScene = new THREE.Scene();
const skyScene = new THREE.Scene(); // drawn first, rotation only, so clouds never overdraw the level
const skyCam = new THREE.PerspectiveCamera(80, 1, 0.1, 1000);
weaponScene.add(new THREE.AmbientLight(0xffffff, 1));
scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x3a3328, 1.6));
const sun = new THREE.DirectionalLight(0xfff0dd, 1.2); sun.position.set(3, 10, 4); scene.add(sun);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  weaponCam.aspect = w / h; weaponCam.updateProjectionMatrix();
  skyCam.aspect = w / h; skyCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const world = { group: null, solid: [], pad: null, nodes: [], spawn: new THREE.Vector3(0, 2, 0), bots: null, proj: null, pickups: null, gun: null, gunTex: null, sky: null, story: null, fx: null };
const match = { mode: 'dm', limit: 10, time: 300, left: 300, over: false, started: 0, lives: 3, bag: null, holder: null, bagLimit: 60 };
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  eye: 1.5, radius: 0.35, grounded: false, hp: 100, armour: 0, kills: 0, deaths: 0, dead: false, respawnIn: 0, lives: 3, bagTime: 0, out: false,
  weapons: [], cur: 0, cool: 0, reloading: 0, zoom: false, name: 'YOU',
  lookVel: { x: 0, y: 0 }, sens: 1,
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

let locked = false, noLock = false, dragging = false, dragMoved = 0;
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; if (!locked && playing() && !touch.active && !noLock) msg('CLICK TO AIM', 2500); });
// Browsers only grant the mouse lock inside a click. A request made after a level finishes loading is
// refused, so that is not treated as "no lock available": the next click on the game asks again.
// Only a refusal during a real click (embedded frames, locked-down browsers) switches to hold-to-look.
async function grabMouse(fromClick = false) {
  if (noLock || locked || touch.active || !canvas.requestPointerLock) { if (!canvas.requestPointerLock) noLock = true; return; }
  try { await canvas.requestPointerLock(); }
  catch (e) { if (fromClick) { noLock = true; msg('HOLD MOUSE BUTTON TO LOOK', 3000); } else msg('CLICK TO AIM', 3000); }
}
const playing = () => world.group && $('#setup').hidden && !match.over;
canvas.addEventListener('mousedown', e => {
  if (!playing()) return;
  if (e.button === 2) { player.zoom = true; return; }
  if (locked) { firing = true; fireOnce(); return; } // fire on press for every weapon; automatics keep going in step()
  if (!noLock) { grabMouse(true); return; }        // first click takes the mouse, it does not shoot
  dragging = true; dragMoved = 0;
});
canvas.addEventListener('mouseup', e => { if (e.button === 2) player.zoom = false; else { firing = false; dragging = false; } });
// Hold-to-look fallback: a click that did not turn the view is a shot.
canvas.addEventListener('click', () => { if (playing() && noLock && dragMoved < 6) fireOnce(); });
// Raw look input is gathered here and applied once per frame in step(), so turning speed does not
// depend on how often the browser delivers mouse events. Mouse right turns right, mouse up looks up.
const lookAcc = { x: 0, y: 0 };
addEventListener('mousemove', e => {
  if (!playing() || !(locked || dragging)) return;
  lookAcc.x += e.movementX; lookAcc.y += e.movementY;
  if (dragging) dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
});
function applyLook(dt, dx, dy) {
  const k = (player.zoom ? 0.0009 : 0.0024) * (player.sens || 1);
  // Light smoothing: most of the input lands this frame, the rest next frame, so micro-jitter is
  // damped without the sluggish feel of a long filter. Time-corrected so 30 and 144 Hz feel alike.
  const a = 1 - Math.pow(0.35, dt * 60);
  player.lookVel.x += (dx - player.lookVel.x) * a; player.lookVel.y += (dy - player.lookVel.y) * a;
  player.yaw -= player.lookVel.x * k;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - player.lookVel.y * k));
}

// ---------- collision ----------
const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
function castDown(from, maxDist) { ray.set(from, DOWN); ray.far = maxDist; const h = ray.intersectObjects(world.solid, false); return h.length ? h[0] : null; }
function castDir(from, dir, maxDist) { ray.set(from, dir); ray.far = maxDist; const h = ray.intersectObjects(world.solid, false); return h.length ? h[0] : null; }

// ---- player collision: a 0.35 m cylinder probed at knee, waist and head height ----
const _sph = new THREE.Sphere();
// Only meshes whose bounds come near the player are tested, so the many props cost nothing far away.
function nearSolid(pos, r) {
  const out = [];
  for (const m of world.solid) {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    _sph.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
    if (_sph.distanceToPoint(pos) < r + 1.5) out.push(m);
  }
  return out;
}
const PROBE = [0.35, 0.9, 1.4];
// Nearest wall-like hit (not floor, ceiling or a step) along dir from any probe height.
function wallHit(pos, dir, dist, list) {
  let best = null;
  for (const h of PROBE) {
    ray.set(_v1.copy(pos).setY(pos.y + h), dir); ray.far = dist;
    for (const hit of ray.intersectObjects(list, false)) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (Math.abs(n.y) > 0.7) continue; // floors, ramps and ceilings are handled by the ground check
      if (n.dot(dir) > 0) n.negate();
      n.y = 0; n.normalize();
      if (!best || hit.distance < best.distance) best = { distance: hit.distance, n };
      break;
    }
  }
  return best;
}
const _v1 = new THREE.Vector3();
// Move up to the first wall, slide the rest along it, repeat for up to three walls (corners).
function slideMove(move, list) {
  for (let i = 0; i < 3; i++) {
    const len = move.length(); if (len < 1e-5) return;
    const dir = move.clone().divideScalar(len);
    const hit = wallHit(player.pos, dir, len + player.radius, list);
    if (!hit) { player.pos.add(move); return; }
    const advance = Math.max(0, hit.distance - player.radius);
    player.pos.addScaledVector(dir, Math.min(advance, len));
    move.multiplyScalar(Math.max(0, 1 - advance / len));
    move.addScaledVector(hit.n, -move.dot(hit.n)); // keep only the part along the wall
  }
}
// Push out of anything closer than the radius in eight directions, so seams and corners cannot be squeezed through.
const RING = [...Array(8)].map((_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 4), 0, Math.sin(i * Math.PI / 4)));
function depenetrate(list) {
  for (const dir of RING) {
    const hit = wallHit(player.pos, dir, player.radius, list);
    if (hit) player.pos.addScaledVector(hit.n, player.radius - hit.distance + 0.005);
  }
}

const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
function step(dt) {
  if (!world.group) return;
  if (player.dead) {
    player.respawnIn -= dt;
    if (!player.out && player.respawnIn <= 0 && (firing || keys.has('Space') || player.respawnIn < -4)) respawn();
  } else {
    // Look first, so this frame's movement uses the turned heading. Touch drags count as 2.2 mouse pixels each.
    applyLook(dt, lookAcc.x + touch.look.dx * 2.2, lookAcc.y + touch.look.dy * 2.2);
    lookAcc.x = lookAcc.y = 0; touch.look.dx = touch.look.dy = 0;
    fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    right.set(-fwd.z, 0, fwd.x); // fwd x up: +X when facing -Z, so D strafes right
    const crouch = keys.has('ControlLeft') || keys.has('KeyC') || touch.held.has('crouch');
    player.eye += ((crouch ? 0.9 : 1.5) - player.eye) * Math.min(1, dt * 12);
    const speed = crouch ? 2.6 : keys.has('ShiftLeft') ? 3.2 : 5.5;
    tmp.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) tmp.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) tmp.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) tmp.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) tmp.sub(right);
    if (touch.active) { tmp.addScaledVector(fwd, touch.move.y).addScaledVector(right, touch.move.x); }
    if (tmp.lengthSq() > 1) tmp.normalize();
    tmp.multiplyScalar(speed);
    // Accelerate toward the wanted velocity instead of snapping to it: quick on the ground, floaty in the air.
    const accel = player.grounded ? 14 : 3;
    player.vel.x += (tmp.x - player.vel.x) * Math.min(1, dt * accel);
    player.vel.z += (tmp.z - player.vel.z) * Math.min(1, dt * accel);
    player.vel.y -= 16 * dt;
    if (player.grounded && (keys.has('Space') || touch.held.has('jump'))) { player.vel.y = 6; player.grounded = false; }
    if (touch.active) {
      for (const k of touch.taps.splice(0)) { if (k === 'next') selectWeapon(player.cur + 1); if (k === 'reload') reload(); if (k === 'board') { if (world.story) $('#objectives').hidden = !$('#objectives').hidden; else $('#board').hidden = !$('#board').hidden; } if (k === 'fire') fireOnce(); }
    }
    const move = new THREE.Vector3(player.vel.x, 0, player.vel.z).multiplyScalar(dt);
    const before = player.pos.clone();
    const near = nearSolid(player.pos, 3 + move.length());
    if (move.lengthSq() > 0) slideMove(move, near);
    depenetrate(near);
    // Never walk off the edge of the world: if there is no floor anywhere below, undo the step.
    if (player.grounded && !castDown(player.pos.clone().setY(player.pos.y + 1), 60)) { player.pos.x = before.x; player.pos.z = before.z; player.vel.x = player.vel.z = 0; }
    player.pos.y += player.vel.y * dt;
    const from = player.pos.clone(); from.y += 1.0;
    const hit = castDown(from, 1.3);
    if (hit && player.vel.y <= 0) { player.pos.y = hit.point.y; player.vel.y = 0; player.grounded = true; } else player.grounded = false;
    if (player.pos.y < -60) die(null);

    // weapons
    player.cool -= dt;
    if (player.reloading > 0) { player.reloading -= dt; if (player.reloading <= 0) finishReload(); }
    const w = curWeapon();
    if ((firing || touch.held.has('fire')) && w && w.def.auto) fireOnce();
  }

  camera.position.copy(player.pos); camera.position.y += player.eye;
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  if (player.dead) {
    // Death camera: sink to the floor and roll over.
    const t = Math.min(1, (1.5 - player.respawnIn) / 1.2);
    camera.position.y = player.pos.y + 1.5 - 1.2 * t;
    camera.rotation.z = 0.9 * t; camera.rotation.x = player.pitch * (1 - t) + 0.3 * t;
  }
  const wdef = curWeapon() && curWeapon().def;
  const fovWant = player.zoom && wdef && wdef.zoom ? 80 / wdef.zoom : 80;
  if (Math.abs(camera.fov - fovWant) > 0.1) { camera.fov += (fovWant - camera.fov) * 0.3; camera.updateProjectionMatrix(); }

  if (world.bots) world.bots.update(dt, player);
  if (world.proj) world.proj.update(dt, projectileHit);
  if (world.pickups) world.pickups.update(dt, player.dead ? { pos: new THREE.Vector3(0, 9999, 0) } : player, takePickup, world.bots);
  if (world.story) {
    world.story.update(dt, player);
    if (!match.over) {
      const sec = Math.floor(world.story.time);
      if (sec !== world.story.hudSec) { world.story.hudSec = sec; updateHud(); $('#clock').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
    }
  }
  modeTick(dt);

  // match clock
  if (!match.over && !world.story) {
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
  g.flash = hideFlash(g);
  // View models differ in native size; scale each so its length along the barrel is about the same.
  const box = new THREE.Box3();
  g.traverse(o => { if (o.isMesh && o.visible) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); } });
  const len = Math.max(0.3, box.max.z - box.min.z) * (gm.scale || 1);
  g.scale.setScalar(0.14 * (gm.scale || 1) / Math.max(0.8, len));
  g.rotation.set(0, Math.PI, 0);
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
  if (world.bots) world.bots.hearShot(camera.position, d.quiet ? 6 : 30); // story guards come to the noise
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
      hitscan(origin, dd, range, d.dmg, w.key, d.tracer, d.head);
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
function hitscan(origin, dir, range, dmg, key, tracer, headDmg) {
  ray.set(origin, dir); ray.far = range;
  const botGroups = world.bots ? world.bots.groups : [];
  const hits = ray.intersectObjects([...botGroups, ...world.solid], true);
  let end = origin.clone().addScaledVector(dir, range);
  if (hits.length) {
    end = hits[0].point;
    const bot = world.bots && world.bots.find(hits[0].object);
    if (bot) {
      const head = world.bots.isHead(bot, hits[0].object);
      const d = head ? Math.max(dmg, headDmg || dmg) * 1.5 : dmg;
      if (world.fx) world.fx.blood(end, dir, head ? 1.8 : Math.min(1.5, 0.5 + d / 40));
      if (world.bots.hit(bot, d, 'player')) { if (head) msg(`HEADSHOT  ${bot.name.toUpperCase()}`); }
      else if (d >= 15 && hurtVoices.length) sfx.play(pick(hurtVoices), { pos: bot.group.position, listener: camera.position, volume: 0.6 });
    } else {
      if (world.fx && hits[0].face) world.fx.puff(end, hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld));
      const scripted = world.story && world.story.damage(hits[0].object, dmg, end);
      if (!scripted && Math.random() < 0.25) sfx.play(pick(SFX.ricochet), { pos: end, listener: camera.position, volume: 0.5 });
    }
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
    if (world.fx) for (const b of world.bots.list) { if (!b.dead && b.group.position.distanceTo(pos) < radius + 0.5) world.fx.blood(b.group.position.clone().setY(b.group.position.y + 1), null, 1.3); }
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

// ---------- game modes ----------
// dm: first to N kills. elim: N lives each, last one standing. bag: hold the bag; first to N seconds.
function modeTick(dt) {
  if (match.over || match.mode !== 'bag' || !match.bag) return;
  const bag = match.bag;
  const t = performance.now() / 1000;
  if (!match.holder) {
    bag.visible = true; bag.rotation.y = t * 2; bag.position.y = bag.userData.y + Math.sin(t * 2) * 0.1;
    // whoever reaches it first
    if (!player.dead && player.pos.distanceTo(bag.position) < 1.1) grabBag('player');
    else for (const b of world.bots.list) if (!b.dead && b.group.position.distanceTo(bag.position) < 1.1) { grabBag(b); break; }
    for (const b of world.bots.list) b.goal = world.bots.nearestNode(bag.position);
  } else {
    bag.visible = false;
    if (match.holder === 'player') { player.bagTime += dt; if (player.bagTime >= match.bagLimit) endMatch(); }
    else { match.holder.bagTime = (match.holder.bagTime || 0) + dt; if (match.holder.bagTime >= match.bagLimit) endMatch(); }
    // everyone else chases the holder
    const hp = match.holder === 'player' ? player.pos : match.holder.group.position;
    for (const b of world.bots.list) b.goal = b === match.holder ? null : world.bots.nearestNode(hp);
  }
  updateHud();
}
function grabBag(who) {
  match.holder = who;
  const name = who === 'player' ? 'YOU HAVE' : `${who.name.toUpperCase()} HAS`;
  msg(`${name} THE BAG`, 2000);
  sfx.play(SFX.armour, { volume: 0.7 });
}
function dropBag(pos) {
  if (!match.bag || !match.holder) return;
  match.holder = null;
  match.bag.position.copy(pos); match.bag.position.y += 0.5; match.bag.userData.y = match.bag.position.y;
  msg('THE BAG IS LOOSE', 1500);
}
function bagScore(who) { return who === 'player' ? player.bagTime : (who.bagTime || 0); }

// ---------- damage, death, score ----------
function damagePlayer(dmg, by) {
  if (player.dead || dmg <= 0 || player.god) return;
  const absorbed = Math.min(player.armour, Math.round(dmg * 0.66));
  player.armour -= absorbed; player.hp -= dmg - absorbed; hurt = 0.3;
  const hud = $('#hud'); hud.classList.add('blood'); clearTimeout(damagePlayer.t); damagePlayer.t = setTimeout(() => hud.classList.remove('blood'), 450);
  if (hurtVoices.length) sfx.play(pick(hurtVoices), { volume: 0.5 });
  if (player.hp <= 0) die(by);
  updateHud();
}
function die(by) {
  player.dead = true; player.deaths++; player.respawnIn = 1.5; player.hp = 0;
  if (by && by.kills !== undefined) { by.kills++; }
  if (dieVoices.length) sfx.play(pick(dieVoices), { volume: 0.7 });
  if (world.story) { player.out = true; updateHud(); setTimeout(() => world.story && world.story.playerDied(), 1500); return; }
  msg(by && by.name ? `SPLIT BY ${by.name.toUpperCase()}` : 'YOU WERE SPLIT', 2500);
  if (match.mode === 'bag' && match.holder === 'player') dropBag(player.pos);
  if (match.mode === 'elim') { player.lives--; if (player.lives <= 0) { player.out = true; msg('ELIMINATED', 3000); } }
  updateHud(); updateBoard();
  if (match.mode === 'dm' && by && by.kills >= match.limit) endMatch();
  if (match.mode === 'elim') checkElimination();
}
function checkElimination() {
  const alive = world.bots.list.filter(b => !b.out).length + (player.out ? 0 : 1);
  if (alive <= 1) endMatch();
}
function respawn() {
  if (world.story) {
    // First start point of this difficulty that has a floor under it (some sit on lifts or ledges the
    // collision mesh does not cover); then any nav node with a floor.
    const S = world.story;
    const cands = (S.data.starts || []).filter(s => placed(s.cond, S.diff)).map(s => S.node(s.node)).filter(Boolean).map(nd => ({ pos: nd.pos, yaw: nd.yaw * Math.PI / 180 }));
    let st = null;
    for (const c of cands.concat(S.start ? [S.start] : [])) { const h = castDown(c.pos.clone().setY(c.pos.y + 1.5), 4); if (h) { st = { pos: c.pos.clone().setY(h.point.y), yaw: c.yaw }; break; } }
    if (!st) { for (const n of world.nodes) { const h = castDown(n.pos.clone().setY(n.pos.y + 1.5), 4); if (h) { st = { pos: n.pos.clone().setY(h.point.y), yaw: 0 }; break; } } }
    if (st) { world.spawn.set(st.pos.x, st.pos.y + 0.2, st.pos.z); player.yaw = st.yaw + Math.PI; player.pitch = 0; } // models face +Z at yaw 0, the camera faces -Z
    else { const s = pick(world.nodes); world.spawn.set(s.pos.x, s.pos.y + 0.2, s.pos.z); }
    player.pos.copy(world.spawn); player.vel.set(0, 0, 0); player.hp = 100; player.armour = 0; player.dead = false; player.out = false;
    player.weapons = [];
    // Start with the level's first sidearm; the mission script may hand out more.
    const set = (world.story.data.weaponSet || []).map(w => (w.model || '').split('/').pop().replace('_cl.raw', ''));
    const starter = set.find(k => WEAPONS[k] && /pistol|luger|magnum|scifihandgun/.test(k)) || set.find(k => WEAPONS[k]);
    if (starter) giveWeapon(starter);
    updateHud();
    return;
  }
  const nodes = world.spawns || world.nodes;
  if (nodes.length) { const s = pick(nodes); world.spawn.set(s.pos.x, s.pos.y + 0.2, s.pos.z); }
  player.pos.copy(world.spawn); player.vel.set(0, 0, 0); player.hp = 100; player.armour = 0; player.dead = false;
  player.weapons = []; giveWeapon('luger');
  const starter = pick(['uzi', 'tommygun', 'scifihandgun', 'doublebarrelshotgun']);
  giveWeapon(starter);
  updateHud();
}
function onBotKilled(bot, by) {
  if (world.fx) {
    const from = bot.group.position.clone(); from.y += 1;
    const h = castDown(from, 3);
    world.fx.blood(bot.group.position.clone().setY(bot.group.position.y + 1), null, 1.5);
    world.fx.pool(bot.group.position, h ? h.point.y : bot.group.position.y, 0.8 + Math.random() * 0.6);
  }
  if (by === 'player') { player.kills++; msg(`SPLIT  ${bot.name.toUpperCase()}`); if (dieVoices.length) sfx.play(pick(dieVoices), { pos: bot.group.position, listener: camera.position }); }
  else if (by && by.kills !== undefined) by.kills++;
  if (world.story) { world.story.botKilled(bot, by); updateHud(); return; }
  if (match.mode === 'bag' && match.holder === bot) dropBag(bot.group.position);
  if (match.mode === 'elim') { bot.lives = (bot.lives ?? match.lives) - 1; if (bot.lives <= 0) bot.out = true; checkElimination(); }
  if (match.mode === 'dm') { if (by === 'player' && player.kills >= match.limit) endMatch(); else if (by && by.kills >= match.limit) endMatch(); }
  updateHud(); updateBoard();
}
function onBotShoot(bot, w, from, target, hits, who) {
  sfx.play(w.sfx, { pos: from, listener: camera.position, volume: w.quiet ? 0.3 : 0.55, rate: 0.95 + Math.random() * 0.1 });
  const dir = target.clone().sub(from).normalize();
  if (w.kind === 'rocket' || w.kind === 'grenade') { world.proj.fire({ ...w, key: bot.weapon }, from, dir, bot, target.clone()); return; }
  if (w.tracer) {
    const g = new THREE.BufferGeometry().setFromPoints([from, target]);
    const l = new THREE.Line(g, tracerMat.clone()); l.material.color.set(w.tracer); l.userData.t = 0; scene.add(l); tracers.push(l);
  }
  if (hits) {
    const dmg = Math.round(w.dmg * (w.pellets ? w.pellets * 0.4 : 1));
    // Whoever stands in the way takes it first.
    ray.set(from, dir); ray.far = 60;
    const others = world.bots.list.filter(b => b !== bot && !b.dead).map(b => b.group);
    const hs = ray.intersectObjects([...others, ...world.solid], true);
    const dist = from.distanceTo(target);
    if (hs.length && hs[0].distance < dist - 0.5) {
      const ob = world.bots.find(hs[0].object);
      if (ob) { if (world.fx) world.fx.blood(hs[0].point, dir, 0.8); world.bots.hit(ob, Math.round(dmg * 0.6), bot); }
      else if (world.fx && hs[0].face) world.fx.puff(hs[0].point, hs[0].face.normal.clone().transformDirection(hs[0].object.matrixWorld));
      return;
    }
    if (who === 'player') damagePlayer(dmg, bot);
    else if (who) { if (world.fx) world.fx.blood(target, dir, 0.8); world.bots.hit(who, Math.round(dmg * 0.6), bot); }
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
  if (match.mode === 'story') { $('#kills').textContent = player.kills; $('#limit').textContent = world.bots ? `${world.bots.list.filter(b => b.story && !b.dead).length} LEFT` : ''; }
  else if (match.mode === 'bag') { $('#kills').textContent = Math.floor(player.bagTime); $('#limit').textContent = match.bagLimit + 's'; }
  else if (match.mode === 'elim') { $('#kills').textContent = `${player.lives} LIVES`; $('#limit').textContent = `${world.bots ? world.bots.list.filter(b => !b.out).length + (player.out ? 0 : 1) : 0} LEFT`; }
  else { $('#kills').textContent = player.kills; $('#limit').textContent = match.limit; }
}
// Score rows for the board and the end screen, by mode.
function standings() {
  const me = { name: player.name, kills: player.kills, deaths: player.deaths, me: true, lives: player.lives, out: player.out, bag: player.bagTime };
  const rows = [me, ...(world.bots ? world.bots.list.map(b => ({ name: b.name, kills: b.kills, deaths: b.deaths, lives: b.lives ?? match.lives, out: !!b.out, bag: b.bagTime || 0 })) : [])];
  if (match.mode === 'bag') { rows.forEach(r => (r.score = Math.floor(r.bag) + 's')); rows.sort((a, b) => b.bag - a.bag); }
  else if (match.mode === 'elim') { rows.forEach(r => (r.score = r.out ? 'out' : `${r.lives} lives`)); rows.sort((a, b) => (b.out ? -1 : b.lives) - (a.out ? -1 : a.lives) || b.kills - a.kills); }
  else { rows.forEach(r => (r.score = r.kills)); rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths); }
  return rows;
}
// Names come from the disc's text table, so they are escaped before any HTML.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function updateBoard() {
  const rows = standings();
  $('#board').innerHTML = '<table>' + rows.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${esc(r.name)}</td><td>${r.deaths}</td><td>${esc(r.score)}</td></tr>`).join('') + '</table>';
}
function endMatch() {
  if (match.over) return;
  match.over = true; firing = false;
  updateBoard();
  const rows = standings();
  const win = rows[0].me;
  let medalLine = '';
  if (match.preset) {
    const medal = medalFor(match.preset, win, match.time - match.left);
    if (medal) { record(progress, match.preset.id, medal); medalLine = `<div class="medal ${medal}">${medal.toUpperCase()} MEDAL</div>`; }
    else medalLine = '<div class="fine">No medal this time.</div>';
    renderLeague();
  }
  $('#end').innerHTML = `${win ? 'YOU WIN' : esc(rows[0].name.toUpperCase()) + ' WINS'}${medalLine}<div class="fine">${rows.map(r => `${esc(r.name)} ${esc(r.score)}`).join(' &nbsp;·&nbsp; ')}</div><div class="fine">Press Enter for the menu</div>`;
  $('#end').hidden = false; $('#board').hidden = true;
  if (document.exitPointerLock) document.exitPointerLock();
}
addEventListener('keydown', e => { if (e.code === 'Enter' && match.over) { $('#end').hidden = true; $('#board').hidden = true; $('#setup').hidden = false; } });

// ---------- loading ----------
async function enter(levelName, opts = {}) {
  status('Loading…');
  const n = levelName.match(ARENA)[1];
  const storyMode = !!opts.story;
  const [lvlBuf, gunBuf, sndBuf, animBuf, feBuf, storyBuf, script] = await Promise.all([fileBuf(levelName), fileBuf('gun.pak'), fileBuf('sounds.pak'), fileBuf('anim.pak'), fileBuf('fe_anim.pak'),
    storyMode ? fileBuf(`story/level${n}.json`) : null, storyMode ? loadMission(parseInt(n)) : null]);
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
  if (world.sky) skyScene.remove(world.sky);
  if (world.bots) for (const b of world.bots.list) scene.remove(b.group);
  if (world.pickups) for (const p of world.pickups.list) scene.remove(p.group);
  if (world.proj) for (const p of world.proj.list) world.proj.remove(p);
  for (const t of tracers) scene.remove(t); tracers.length = 0;
  if (world.fx) world.fx.clear();
  world.fx = new Fx({ scene, pak });

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
      sky.traverse(o => { if (o.isMesh) { o.material.forEach(m => { m.depthWrite = false; }); o.frustumCulled = false; } });
      sky.scale.setScalar(sm.scale || 1);
      world.sky = sky; skyScene.add(sky);
    } catch (e) { console.warn('sky failed', e); }
  }

  const padBytes = pak.tryGet(`pad/data/level${n}.raw`);
  world.pad = padBytes ? parsePad(padBytes) : { nodes: [], links: [] };
  world.nodes = world.pad.nodes.filter(nd => Number.isFinite(nd.pos[0])).map(nd => ({ pos: new THREE.Vector3(...nd.pos) }));
  if (!world.nodes.length) { const box = new THREE.Box3().setFromObject(world.group); const c = box.getCenter(new THREE.Vector3()); c.y = box.max.y - 1; world.nodes.push({ pos: c }); }
  // The game's own placed points, when the pack has them: type 1 = spawn spots, type 0 = item spots.
  const extra = (world.pad.extra || []).filter(x => Number.isFinite(x.pos[0]));
  world.spawns = extra.filter(x => x.type === 1).map(x => ({ pos: new THREE.Vector3(...x.pos) }));
  world.itemSpots = extra.filter(x => x.type === 0).map(x => ({ pos: new THREE.Vector3(...x.pos) }));
  if (world.spawns.length < 2) world.spawns = world.nodes;

  // Projectiles, pickups, bots.
  const protos = {};
  for (const [k, p] of [['missile', 'ob/guns/missile.raw'], ['grenadelauncher', 'ob/guns/missile.raw'], ['tnt', 'ob/guns/tnt_cl.raw'], ['brick', 'ob/guns/brick_cl.raw']]) {
    if (world.gun.has(p)) { const m = parseModel(world.gun.get(p)); const g = modelToGroup(m, world.gunTex, { lit: true }); g.scale.setScalar((m.scale || 1) * (k === 'missile' ? 0.5 : 1)); protos[k] = g; }
  }
  world.proj = new Projectiles({ scene, solid: world.solid, onSplash: splash, sfx, models: protos });
  world.proj.listener = camera.position;
  const spots = world.itemSpots.length >= 6 ? world.itemSpots : world.nodes;
  world.pickups = new Pickups({ scene, pak, gun: world.gun, texSrc, gunTex: world.gunTex, nodes: spots, sfx, roster: BOT_WEAPONS.concat(['minigun', 'homingrocketlauncher', 'sniperrifle', 'flamethrower', 'electrogun', 'tnt']) });
  world.pickups.place(spots === world.itemSpots ? spots.length : Math.min(24, Math.max(8, Math.floor(world.nodes.length / 6))));
  world.bots = new Bots({ pak, gun: world.gun, texSrc, gunTex: world.gunTex, pad: world.pad, scene, solid: world.solid, anims, bind, onShoot: onBotShoot, onBotKilled, names: [], text });
  if (world.story) { world.story.dispose(); world.story = null; }
  if (storyMode) {
    // Story: the level's own placements replace the arena pickups and the random bots.
    for (const p of world.pickups.list) scene.remove(p.group); world.pickups.list = [];
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(storyBuf)));
    world.bots.skill = [0.7, 1, 1.35][opts.diff] || 1;
    world.story = new Story({ data, diff: opts.diff ?? 1, scene, pak, texSrc, gun: world.gun, gunTex: world.gunTex, world, bots: world.bots, text, hooks: storyHooks });
    world.story.level = parseInt(n);
    world.story.useScript(script);
    match.mode = 'story'; match.limit = 0; match.time = 0; match.left = 0; match.over = false; match.lives = 1; match.holder = null; match.preset = null;
    if (match.bag) { scene.remove(match.bag); match.bag = null; }
    player.kills = 0; player.deaths = 0; player.lives = 1; player.bagTime = 0; player.out = false;
    respawn(); updateBoard(); renderObjectives();
    $('#setup').hidden = true; $('#hud').hidden = false; $('#hud').classList.add('story'); $('#end').hidden = true; $('#objectives').hidden = touch.active; // phones: TAB button shows the list
    status('Mission loaded.');
    grabMouse();
    msg(arenaName(n, 'st').toUpperCase(), 3000);
    playMusic();
    world.story.update(0, player);
    console.log(`mission ${n}: ${world.story.props.length} props, ${world.story.doors.length} doors, ${world.story.pickups.length} pickups, ${world.story.spawners.length} spawners, ${world.story.cameras.length} cameras, ${world.story.switches.length} switches, ${world.story.objectives.length} objectives`);
    return;
  }
  world.bots.spawn(Math.min(parseInt($('#botcount').value) || 4, Math.max(1, world.bots.models.length * 2)));
  world.bots.skill = parseFloat($('#skill').value) || 1;
  world.bots.pickups = world.pickups;

  match.mode = $('#mode').value; match.limit = parseInt($('#killlimit').value) || 10; match.time = match.preset ? match.preset.time : 300; match.left = match.time; match.over = false;
  match.lives = match.mode === 'elim' ? Math.max(1, Math.min(9, Math.round(match.limit / 3))) : 3;
  match.bagLimit = match.mode === 'bag' ? match.limit * 6 : 60;
  match.holder = null; if (match.bag) { scene.remove(match.bag); match.bag = null; }
  if (match.mode === 'bag') {
    const bagName = pak.list('ob/bag1/')[0] || pak.list('ob/pickups/')[0];
    const bm = bagName ? parseModel(pak.get(bagName)) : null;
    const bag = bm ? modelToGroup(bm, texSrc, { lit: true }) : new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0xffb03b }));
    if (bm) bag.scale.setScalar(bm.scale || 1);
    const spot = pick(world.itemSpots.length ? world.itemSpots : world.nodes);
    bag.position.copy(spot.pos); bag.position.y += 0.5; bag.userData.y = bag.position.y;
    scene.add(bag); match.bag = bag;
  }
  player.kills = 0; player.deaths = 0; player.lives = match.lives; player.bagTime = 0; player.out = false;
  for (const b of world.bots.list) { b.lives = match.lives; b.bagTime = 0; b.out = false; b.goal = null; }
  respawn(); updateBoard();
  $('#setup').hidden = true; $('#hud').hidden = false; $('#hud').classList.remove('story'); $('#end').hidden = true; $('#objectives').hidden = true;
  status(`${pickedFiles.size || ''} ready.`);
  grabMouse();
  msg(`${arenaName(n, levelName.endsWith('_st.pak') ? 'st' : 'ar').toUpperCase()}  ·  FIRST TO ${match.limit}`, 3000);
  playMusic();
  let tris = 0; world.group.traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  console.log(`arena ${n}: ${map.sections.length} sections, ${tris} tris, ${map.materials.length} materials, ${world.nodes.length} nav nodes, ${world.bots.list.length} bots, ${world.pickups.list.length} pickups, ${anims ? anims.size : 0} clips`);
}

$('#go').addEventListener('click', () => { match.preset = null; enter($('#level').value).catch(e => { status(e.message); console.error(e); }); });

// ---------- story missions ----------
const STORY_KEY = 'sundial.story';
let storyProgress = (() => { try { return JSON.parse(localStorage.getItem(STORY_KEY) || '{}'); } catch (e) { return {}; } })();
function saveStory() { try { localStorage.setItem(STORY_KEY, JSON.stringify(storyProgress)); } catch (e) { /* no storage */ } }
const useKey = { held: false };
addEventListener('keydown', e => { if (e.code === 'KeyE' || e.code === 'KeyF') useKey.held = true; });
addEventListener('keyup', e => { if (e.code === 'KeyE' || e.code === 'KeyF') useKey.held = false; });
const storyHooks = {
  msg: (t, ms) => msg(t, ms),
  hud: () => renderObjectives(),
  sfx: name => { const map = { objective: SFX.armour, door: 'door_metal_slide16_01', switch: 'door_filing_cabinet16_01', alarm: 'gangster_alarm_loop22_02' }; const k = map[name] || name; if (k) sfx.play(k, { volume: 0.6 }); },
  end: (win, why) => missionEnd(win, why),
  player: () => player,
  useHeld: () => useKey.held || touch.held.has('use'),
  give: key => giveWeapon(key),
  take: key => { player.weapons = player.weapons.filter(w => w.key !== key); selectWeapon(0); },
  pickup: p => storyPickup(p),
  turretFire: (c, from, to) => {
    sfx.play(WEAPONS.minigun ? WEAPONS.minigun.sfx : 'uzi', { pos: from, listener: camera.position, volume: 0.5 });
    const dir = to.clone().sub(from).normalize();
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const l = new THREE.Line(g, tracerMat.clone()); l.material.color.set('#ff5030'); l.userData.t = 0; scene.add(l); tracers.push(l);
    if (Math.random() < 0.45) damagePlayer(8, null);
  },
  explode: (pos, big) => { if (big) { splash(pos, 4, 60, 'world'); world.proj && world.proj.boom && world.proj.boom(pos); sfx.play(SFX.explode || 'explosion1', { pos, listener: camera.position, volume: 0.9 }); } else sfx.play(pick(SFX.ricochet), { pos, listener: camera.position, volume: 0.5 }); },
};
function storyPickup(p) {
  if (p.kind === 'weapon') { const key = p.weapon; if (!WEAPONS[key]) { msg((text.get(p.rec.text) || 'ITEM').toUpperCase()); return true; } const had = player.weapons.some(w => w.key === key); if (!giveWeapon(key) && had) return false; sfx.play(SFX.pickup, { volume: 0.7 }); msg(slotName(key).toUpperCase()); return true; }
  if (p.kind === 'ammo') { const key = p.weapon; const w = player.weapons.find(x => x.key === key) || curWeapon(); if (!w || w.ammo >= w.def.max) return false; w.ammo = Math.min(w.def.max, w.ammo + w.def.clip * 2); sfx.play(SFX.ammo, { volume: 0.7 }); msg('AMMO'); updateHud(); return true; }
  if (p.kind === 'health') { if (player.hp >= 100) return false; player.hp = Math.min(100, player.hp + 25); sfx.play(SFX.health, { volume: 0.7 }); msg('HEALTH'); updateHud(); return true; }
  if (p.kind === 'armour') { if (player.armour >= 100) return false; player.armour = Math.min(100, player.armour + (/armour2|big/.test(p.model || '') ? 100 : 50)); sfx.play(SFX.armour, { volume: 0.7 }); msg('ARMOUR'); updateHud(); return true; }
  if (p.kind === 'item' || p.kind === 'key' || p.kind === 'bag') { sfx.play(SFX.armour, { volume: 0.7 }); const nm = (p.model || '').split('/').pop().replace('.raw', '').toUpperCase(); msg(/crystal/i.test(nm) ? 'TIME CRYSTAL RECOVERED' : nm, 2500); return true; }
  return true;
}
function renderObjectives() {
  const el = $('#objectives'); const S = world.story;
  if (!el || !S) return;
  const groups = [[], [], []];
  for (const o of S.objectives) if (o.state !== 'absent' && o.state !== 'hidden') groups[o.cat].push(o);
  const titles = [text.get(1316) || 'MAIN OBJECTIVES', text.get(1318) || 'SECONDARY OBJECTIVES', text.get(1320) || 'BONUS OBJECTIVES'];
  el.innerHTML = groups.map((g, i) => g.length ? `<h4>${esc(titles[i])}</h4>` + g.map(o => `<div class="${o.state}">${esc(text.get(o.text, `Objective ${o.i}`).replace(/\n/g, ' '))}${o.need ? ` (${o.count}/${o.need})` : ''}</div>`).join('') : '').join('');
  el.hidden = !el.innerHTML;
}
function missionEnd(win, why) {
  if (match.over) return;
  match.over = true; firing = false;
  const S = world.story; const lvl = S.level, diff = S.diff;
  if (win) {
    const rec = storyProgress[lvl] || {}; const t = Math.round(S.time);
    storyProgress[lvl] = { done: Math.max(rec.done || 0, diff + 1), best: Math.min(rec.best || 1e9, t) };
    saveStory(); renderMissions();
  }
  const idx = MISSIONS.indexOf(lvl); const next = idx >= 0 ? MISSIONS[idx + 1] : null;
  const mins = Math.floor(S.time / 60), secs = String(Math.floor(S.time % 60)).padStart(2, '0');
  $('#end').innerHTML = `${win ? 'MISSION COMPLETE' : (esc(why || 'MISSION FAILED'))}<div class="fine">${esc(arenaName(lvl, 'st'))} · ${['Easy', 'Normal', 'Hard'][diff]} · ${mins}:${secs}</div>` +
    `<div class="row" style="justify-content:center"><button class="btn" id="retry">${win ? 'REPLAY' : 'RETRY'}</button>${win && next ? `<button class="btn" id="nextm">NEXT MISSION</button>` : ''}<button class="btn" id="tomenu">MENU</button></div>`;
  $('#end').hidden = false; $('#board').hidden = true;
  $('#retry').onclick = () => { $('#end').hidden = true; startMission(lvl, diff); };
  if ($('#nextm')) $('#nextm').onclick = () => { $('#end').hidden = true; startMission(next, diff); };
  $('#tomenu').onclick = () => { $('#end').hidden = true; $('#setup').hidden = false; };
  if (document.exitPointerLock) document.exitPointerLock();
}
function renderMissions() {
  const el = $('#missions'); if (!el) return;
  const box = $('#storybox');
  const have = MISSIONS.filter(l => pickedFiles.has(`l_${l}_st.pak`) || (SRC || SITE_PACK));
  box.hidden = !have.length;
  el.innerHTML = MISSIONS.map((l, i) => {
    const rec = storyProgress[l]; const prev = i === 0 || storyProgress[MISSIONS[i - 1]] || Q.get('unlock') === '1';
    const stars = rec ? '★'.repeat(rec.done) : '';
    return `<button class="match" data-level="${l}" ${prev ? '' : 'disabled'}><span>${i + 1}.</span>${esc(arenaName(l, 'st'))} <small>${rec ? `done · ${stars}` : prev ? '' : 'locked'}</small></button>`;
  }).join('');
  el.querySelectorAll('.match').forEach(b => b.addEventListener('click', () => showBriefing(parseInt(b.dataset.level))));
}
// Mission briefings are the game's own text; the start button sits under them.
const BRIEF_TEXT = { 35: 1053, 20: 1054, 34: 1055, 41: 1057, 38: 1056, 48: 1059, 31: 1058, 32: 1060, 40: 1061, 39: 1049 };
function showBriefing(level) {
  const el = $('#brief'); if (!el) return;
  const t = text.get(BRIEF_TEXT[level], '') || `${arenaName(level, 'st')}\n\nRetrieve the time crystal and escape through the portal.`;
  el.innerHTML = `${esc(t)}<div class="row" style="margin-top:10px"><button class="btn" id="startm">START MISSION</button><span class="fine">${esc(arenaName(level, 'st'))} · ${['Easy', 'Normal', 'Hard'][parseInt($('#sdiff').value) || 0]}</span></div>`;
  el.hidden = false;
  $('#startm').onclick = () => startMission(level, parseInt($('#sdiff').value) || 0);
  el.scrollIntoView({ block: 'nearest' });
}
function startMission(level, diff) {
  match.preset = null;
  enter(`l_${level}_st.pak`, { story: true, diff }).catch(e => { status(e.message); console.error(e); });
}
renderMissions();

// ---------- arcade league ----------
let progress = loadProgress();
function renderLeague() {
  const el = $('#league'); if (!el) return;
  const MEDAL = { gold: '🥇', silver: '🥈', bronze: '🥉' };
  el.innerHTML = LEAGUE.map((l, i) => {
    const open = unlocked(progress, i);
    return `<div class="lg ${open ? '' : 'locked'}"><h3>${l.name}${open ? '' : ' · locked'}</h3>` + l.matches.map(m =>
      `<button class="match" data-id="${m.id}" ${open ? '' : 'disabled'}><span>${MEDAL[progress[m.id]] || '·'}</span> ${m.name} <small>${{ dm: 'Deathmatch', elim: 'Elimination', bag: 'Bag Tag' }[m.mode]} · ${m.bots} bots</small></button>`).join('') + '</div>';
  }).join('');
  el.querySelectorAll('.match').forEach(b => b.addEventListener('click', () => startPreset(b.dataset.id)));
}
function startPreset(id) {
  const m = findMatch(id); if (!m) return;
  if (!pickedFiles.has(m.level) && !SRC) { cache.keys().then(ks => { if (!ks.includes(m.level)) status(`That match needs ${m.level.toUpperCase()} from your disc folder.`); }); }
  $('#mode').value = m.mode; $('#level').value = m.level; $('#botcount').value = String(m.bots);
  $('#skill').value = String(m.skill); $('#killlimit').value = String(m.limit);
  match.preset = m;
  enter(m.level).catch(e => { status(e.message); console.error(e); });
}
renderLeague();
addEventListener('keydown', e => { if (e.code === 'Escape' && world.group && !match.over) { $('#setup').hidden = false; firing = false; } });
$('#setup').addEventListener('click', e => { if (world.group && e.target === $('#setup')) { $('#setup').hidden = true; grabMouse(); } });

// Debug handle for the console; tick() forces frames when the tab is not being painted.
window.sundial = { scene, weaponScene, world, player, camera, match, input: { get locked() { return locked; }, set locked(v) { locked = v; }, get noLock() { return noLock; } }, get weapon() { return weapon; }, get music() { return music; }, fireOnce, giveWeapon, selectWeapon, playMusic, tick: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) render(dt); } };

// ---------- loop ----------
let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; render(dt); requestAnimationFrame(frame); }
function render(dt) {
  if (playing()) step(dt);
  else if (world.group) { camera.position.copy(player.pos); camera.position.y += player.eye; }
  flash.intensity *= 0.6;
  if (world.fx) world.fx.update(dt);
  for (const t of tracers) { t.userData.t += dt; t.material.opacity = Math.max(0, 0.9 - t.userData.t * 8); if (t.userData.t > 0.15) { scene.remove(t); t.userData.done = true; } }
  if (tracers.some(t => t.userData.done)) tracers.splice(0, tracers.length, ...tracers.filter(t => !t.userData.done));
  if (hurt > 0) { hurt -= dt; $('#hud').style.boxShadow = `inset 0 0 ${80 * hurt * 4}px #d00`; } else $('#hud').style.boxShadow = '';
  // The on-screen controls only exist while a match is running; otherwise they would sit over the menu.
  if (touch.active) { const t = $('#touch'); const on = playing(); if (t && t.hidden === on) t.hidden = !on; }
  renderer.autoClear = true;
  if (world.sky) {
    skyCam.quaternion.copy(camera.quaternion); skyCam.fov = camera.fov; skyCam.updateProjectionMatrix();
    renderer.render(skyScene, skyCam);
    renderer.autoClear = false; renderer.clearDepth();
  }
  renderer.render(scene, camera);
  if (weapon && !player.zoom) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(weaponScene, weaponCam); }
}
requestAnimationFrame(frame);
