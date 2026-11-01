// Character and animation viewer: ?src=/disc/PAK/ (dev) or cached archives. ?model=chr01&clip=run_m0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Pak } from './pak.js';
import { parseModel } from './model.js';
import { parseAnim } from './anim.js';
import { makeBind, Rig, HUMAN, PARENT, RWRIST, gunGrip } from './skeleton.js';
import { TexSource, modelToGroup, hideFlash } from './build.js';
import { cache } from './store.js';

const $ = s => document.querySelector(s);
const q = new URLSearchParams(location.search);
const SRC = q.get('src');
async function fileBuf(name) {
  if (SRC) { const r = await fetch(SRC + name.toUpperCase()); if (!r.ok) throw new Error(`${r.status} ${name}`); return r.arrayBuffer(); }
  const b = await cache.get(name); if (!b) throw new Error(`${name} not cached: open the game page and pick the PAK folder first`); return b;
}

const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1a2030);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
camera.position.set(2.2, 1.6, 3.0);
const controls = new OrbitControls(camera, canvas); controls.target.set(0, 0.9, 0);
scene.add(new THREE.HemisphereLight(0xdde4ff, 0x443322, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 6, 4); scene.add(sun);
scene.add(new THREE.GridHelper(4, 8, 0x335, 0x224));
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

let chr, anims = new Map(), bind, texSrc, gun, gunTex;
let group = null, rig = null, model = null, bonesHelper = null, gunObj = null;

async function init() {
  const [chrBuf, animBuf, feBuf, gunBuf] = await Promise.all([fileBuf('chr.pak'), fileBuf('anim.pak'), fileBuf('fe_anim.pak'), fileBuf('gun.pak')]);
  chr = new Pak(chrBuf, 'chr.pak'); texSrc = new TexSource(chr);
  gun = new Pak(gunBuf, 'gun.pak'); gunTex = new TexSource(gun);
  const gs = $('#gun');
  for (const p of ['', ...gun.list('ob/guns/').filter(p => p.endsWith('_cl.raw'))]) { const o = document.createElement('option'); o.value = p; o.textContent = p ? p.slice(8, -7) : '(none)'; gs.appendChild(o); }
  gs.value = q.get('gun') ? `ob/guns/${q.get('gun')}_cl.raw` : '';
  gs.addEventListener('change', loadGun);
  const ap = new Pak(animBuf), fe = new Pak(feBuf);
  const PFX = 'anim/data/ts2/';
  for (const p of ap.list(PFX)) { try { anims.set(p.slice(PFX.length, -4), parseAnim(ap.get(p))); } catch (e) { /* skip */ } }
  bind = makeBind(parseAnim(fe.get('anim/data/ts2/human_19_bindpose.raw')));
  const ms = $('#model');
  for (const p of chr.list('ob/chrs/').filter(p => /chr\d+\.raw$/.test(p)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))) {
    const o = document.createElement('option'); o.value = p; o.textContent = p.slice(8, -4); ms.appendChild(o);
  }
  const cs = $('#clip');
  for (const n of [...anims.keys()].sort()) { const o = document.createElement('option'); o.value = n; o.textContent = n; cs.appendChild(o); }
  ms.value = `ob/chrs/${q.get('model') || 'chr01'}.raw`; cs.value = q.get('clip') || 'run_m0';
  ms.addEventListener('change', loadModel); cs.addEventListener('change', loadClip);
  $('#status').textContent = `${ms.options.length} characters, ${anims.size} clips`;
  loadModel();
}
function loadModel() {
  if (group) scene.remove(group);
  model = parseModel(chr.get($('#model').value));
  group = modelToGroup(model, texSrc, { lit: true });
  group.scale.setScalar(model.scale || 1);
  scene.add(group);
  rig = new Rig(group, model, bind);
  loadClip(); loadGun();
  $('#info').textContent = `${$('#model').value}  parts ${model.parts.length}  scale ${model.scale.toFixed(2)}\npart->bone ${rig.partBone.map((b, i) => `${i}:${HUMAN.names[b]}`).join(' ')}`;
}
function loadGun() {
  if (gunObj && rig) rig.detach(gunObj);
  gunObj = null;
  const p = $('#gun').value; if (!p || !rig) return;
  const gm = parseModel(gun.get(p));
  gunObj = modelToGroup(gm, gunTex, { lit: true }); gunObj.scale.setScalar(gm.scale || 1); hideFlash(gunObj);
  rig.attach(gunObj, RWRIST, gunGrip());
}
function loadClip() {
  const c = anims.get($('#clip').value); if (!c) return;
  rig.play(c, { restart: true });
  $('#frame').max = Math.max(1, c.total - 1);
}
$('#wire').addEventListener('change', e => group && group.traverse(o => { if (o.isMesh) o.material.forEach(m => (m.wireframe = e.target.checked)); }));

function drawBones() {
  if (bonesHelper) { scene.remove(bonesHelper); bonesHelper = null; }
  if (!$('#bones').checked || !rig) return;
  const pts = [];
  const s = group.scale.x;
  for (let i = 0; i < 19; i++) {
    if (PARENT[i] < 0) continue;
    const a = new THREE.Vector3().setFromMatrixPosition(rig.world[PARENT[i]]).multiplyScalar(s);
    const b = new THREE.Vector3().setFromMatrixPosition(rig.world[i]).multiplyScalar(s);
    pts.push(a, b);
  }
  bonesHelper = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false }));
  bonesHelper.renderOrder = 999;
  scene.add(bonesHelper);
}

let last = performance.now();
function render(dt) {
  if (rig && rig.clip) {
    if ($('#play').checked) { rig.update(dt); $('#frame').value = Math.floor(rig.time); }
    else { rig.time = +$('#frame').value; rig.update(0); }
    $('#fval').textContent = rig.time.toFixed(1);
  }
  drawBones();
  controls.update();
  renderer.render(scene, camera);
}
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; render(dt); requestAnimationFrame(frame); }
window.viewer = { setFrame: t => { $('#play').checked = false; $('#frame').value = t; render(0); }, tick: (n = 1) => { for (let i = 0; i < n; i++) render(1 / 60); }, get rig() { return rig; }, scene, camera, controls };
init().then(() => requestAnimationFrame(frame)).catch(e => { $('#status').textContent = e.message; console.error(e); });
