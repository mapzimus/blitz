// Builds Three.js objects from the disc's RenderWare models: field, stadium, skinned animated players.
// Disc units are inches with Z up and (for the field) length along Y; the game world is yards, Y up,
// length along X, width along Z.
import * as THREE from 'three';
import { FIELD } from '../game/constants.js';
import { geoBounds } from '../assets/dff.js';

const IN = 1 / 36;
// skeleton_hierarchy.dff frame index -> HAnim node id (frame 1 hips, frame 2 ground marker)
export const HANIM_ID = { 1: 1, 2: 2000, 3: 14, 4: 15, 5: 19, 6: 20, 7: 21, 8: 22, 9: 16, 10: 17, 11: 18, 12: 13, 13: 4, 14: 3, 15: 2, 16: 9, 17: 5, 18: 6, 19: 7, 20: 8, 21: 10, 22: 11, 23: 12 };
export const FRAME_OF_ID = Object.fromEntries(Object.entries(HANIM_ID).map(([f, id]) => [id, +f]));
// 2-letter disc codes by abbreviation
export const TEAM_CODE = { ARI: 'ac', ATL: 'af', BAL: 'br', BUF: 'bb', CAR: 'cp', CHI: 'cb', CIN: 'ce', CLE: 'cr', DAL: 'dc', DEN: 'db', DET: 'dl', GB: 'gp', IND: 'ic', JAX: 'jj', KC: 'kc', MIA: 'md', MIN: 'mv', NE: 'np', NO: 'ns', NYG: 'ng', NYJ: 'nj', OAK: 'or', PHI: 'pe', PIT: 'ps', SD: 'sc', SF: 'sf', SEA: 'ss', STL: 'sr', TB: 'tb', TEN: 'tt', WAS: 'wr' };
const FACES = ['joh', 'bub', 'gum', 'cwo', 'wil', 'tar', 'jul', 'vic', 'cha', 'rhe', 'mik'];

const texCache = new Map();
export async function threeTexture(assets, name, hints) {
  const key = name.toLowerCase();
  if (texCache.has(key)) return texCache.get(key);
  const t = await assets.findTexture(name, hints);
  if (!t) console.warn('texture miss', name, hints);
  let tex = null;
  if (t) {
    const c = document.createElement('canvas'); c.width = t.width; c.height = t.height;
    c.getContext('2d').putImageData(new ImageData(t.data, t.width, t.height), 0, 0);
    tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.flipY = false; tex.anisotropy = 8;
  }
  texCache.set(key, tex);
  return tex;
}

function partGeometry(part) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
  if (part.uv) g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
  if (part.col) { const c = new Float32Array(part.col.length / 4 * 3); for (let i = 0, j = 0; i < part.col.length; i += 4, j += 3) { c[j] = Math.min(1, part.col[i] / 128); c[j + 1] = Math.min(1, part.col[i + 1] / 128); c[j + 2] = Math.min(1, part.col[i + 2] / 128); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
  g.setIndex(new THREE.BufferAttribute(part.index, 1));
  if (part.nrm && part.nrm.some(v => v !== 0)) g.setAttribute('normal', new THREE.BufferAttribute(part.nrm, 3)); else g.computeVertexNormals();
  return g;
}

async function materialFor(assets, mat, opts = {}) {
  const name = opts.rename ? opts.rename(mat.texture) : mat.texture;
  const map = name ? await threeTexture(assets, name, opts.hints) : null;
  const Mat = opts.unlit ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
  const m = new Mat({ map: map || null, color: map ? 0xffffff : 0x8a8a8a, vertexColors: !!opts.vertexColors, side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide, transparent: !!opts.transparent, alphaTest: opts.transparent ? 0.3 : 0 });
  if (opts.depthWrite === false) { m.depthWrite = false; m.depthTest = false; }
  return m;
}

// Disc model (x, y, z-up, inches) -> world (x -> z width, y -> x length, z -> y up) in yards, centered on the field.
export function fieldFrame() {
  const g = new THREE.Group();
  g.scale.setScalar(IN);
  g.rotation.set(-Math.PI / 2, 0, Math.PI / 2);     // z-up -> y-up, model +y -> world +x
  g.position.set(50, 0, FIELD.mid);
  return g;
}

export async function buildStatic(assets, file, opts = {}) {
  const model = await assets.model(file);
  const group = new THREE.Group();
  for (const a of model.atomics.length ? model.atomics : model.geometries.map((g, i) => ({ geometry: i, frame: 0 }))) {
    const geo = model.geometries[a.geometry];
    if (opts.pick && !opts.pick(a.geometry, geo)) continue;
    for (const part of geo.parts) {
      const mat = await materialFor(assets, geo.materials[part.material] || {}, { ...opts, vertexColors: !!part.col, unlit: true });
      const mesh = new THREE.Mesh(partGeometry(part), mat);
      mesh.receiveShadow = true; mesh.castShadow = !!opts.castShadow;
      group.add(mesh);
    }
  }
  return group;
}

export async function buildField(assets) {
  const g = fieldFrame();
  // grass is a separate tiled texture under the line/number overlay model
  const grass = await threeTexture(assets, 'flgra_1b', ['fl_fnmaf.rtd']);
  if (grass) {
    grass.repeat.set(24, 40);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2700, 4500), new THREE.MeshBasicMaterial({ map: grass, color: 0xb8b8b8 }));
    plane.position.z = -0.6; plane.receiveShadow = true; g.add(plane);
  }
  const lines = await buildStatic(assets, 'fl_nnmaf.dff', { hints: ['fl_fnmaf.rtd'], transparent: true, doubleSide: true });
  lines.traverse(o => { if (o.material) { o.material.polygonOffset = true; o.material.polygonOffsetFactor = -1; o.material.depthWrite = false; } });
  g.add(lines);
  return g;
}

export async function buildStadium(assets, teamCode) {
  // small_stadiums.dff holds one complete bowl per team, textured from small_stadiums.rtd
  const g = fieldFrame();
  const model = await assets.model('small_stadiums.dff');
  const want = `${teamCode}_small`;
  let ai = model.atomics.findIndex(a => model.geometries[a.geometry].materials.some(m => m.texture === want));
  if (ai < 0) ai = 0;
  const geo = model.geometries[model.atomics[ai].geometry];
  for (const part of geo.parts) {
    const mat = await materialFor(assets, geo.materials[part.material] || {}, { hints: ['small_stadiums.rtd'], vertexColors: !!part.col, doubleSide: true, unlit: true });
    const mesh = new THREE.Mesh(partGeometry(part), mat); mesh.receiveShadow = true; g.add(mesh);
  }
  return g;
}

// Sky dome, both end zones, centre logo and goal posts from the disc.
export async function buildExtras(assets, homeCode, awayCode, sky = 1) {
  const g = fieldFrame();
  const add = async (file, opts) => { try { g.add(await buildStatic(assets, file, { unlit: true, doubleSide: true, ...opts })); } catch (e) { console.warn(file, e); } };
  await add(`sk_af_0${sky}.DFF`, { hints: [`sk_af_0${sky}.rtd`], depthWrite: false });
  g.children.forEach(c => c.traverse(o => { if (o.isMesh && o.material.depthTest === false) o.renderOrder = -10; }));
  await add('gp_af_a.DFF', { hints: ['_gp_gpost.rtd'], transparent: true });
  await add('gp_af_b.DFF', { hints: ['_gp_gpost.rtd'], transparent: true });
  // end zones: the model covers the -y end; the other end is the same model turned around
  const ez = async (code, flip) => {
    const file = `${code}_enmaf.dff`; if (!assets.zip.has(file)) return;
    const m = await buildStatic(assets, file, { hints: [`${code}_enmAF.rtd`], unlit: true, transparent: true });
    m.position.z = 0.4; if (flip) m.rotation.z = Math.PI; g.add(m);
  };
  await ez(homeCode, false); await ez(awayCode || homeCode, true);
  // centre logo quad
  if (assets.zip.has('clogo_af.DFF')) {
    const m = await buildStatic(assets, 'clogo_af.DFF', { hints: [`${homeCode}_clogo.rtd`], rename: t => t === 'xx_clogo' ? `${homeCode}_clogo` : t, unlit: true, transparent: true });
    m.position.z = 0.5; g.add(m);
  }
  return g;
}

export async function buildBall(assets) {
  const model = await assets.model('ball.dff');
  const geo = model.geometries[0];
  const grp = new THREE.Group();
  const inner = new THREE.Group(); inner.scale.setScalar(IN); inner.rotation.set(-Math.PI / 2, 0, Math.PI / 2); grp.add(inner);   // model +y (long axis) -> world +x
  for (const part of geo.parts) {
    const mat = await materialFor(assets, geo.materials[part.material] || {}, { hints: ['ball.rtd'] });
    const mesh = new THREE.Mesh(partGeometry(part), mat); mesh.castShadow = true; inner.add(mesh);
  }
  return grp;
}

// ---------- players ----------
export class PlayerKit {
  constructor(assets) { this.assets = assets; this.ready = false; }
  async load() {
    const a = this.assets;
    [this.skel, this.uniform, this.skin, this.helmet, this.equip, this.hand, this.bank] = await Promise.all([
      a.model('skeleton_hierarchy.dff'), a.model('uniform.dff'), a.model('skin.dff'), a.model('helmet.dff'), a.model('equipment.dff'), a.model('hand.dff'), a.bank('genbank.ban')]);
    this.frames = this.skel.frames;
    this.table = this.frames[1].hanimTable;            // skin bone table index -> HAnim id
    // Resolve table index -> skeleton frame from the data: each inverse-bind translation is minus the
    // bone's rest world position (rest rotations are identity).
    const world = restWorld(this.frames);
    this.restPos = world;
    const skinAtom = this.uniform.atomics.find(a => a.skin);
    this.tableToFrame = this.table.map(() => 1);
    this.frameOfId = {};
    for (const blk of skinAtom.skin.bones) {
      const tx = -blk.inverseBind[12], ty = -blk.inverseBind[13], tz = -blk.inverseBind[14];
      let best = 1, bd = 1e9;
      world.forEach((w, fi) => { if (fi === 0) return; const d = (w[0] - tx) ** 2 + (w[1] - ty) ** 2 + (w[2] - tz) ** 2; if (d < bd) { bd = d; best = fi; } });
      this.tableToFrame[blk.index] = best;
      const id = this.table[blk.index]?.id; if (id !== undefined) this.frameOfId[id] = best;
    }
    this.frameOfId[2000] = undefined;
    // choose the highest-detail geometry of each part group
    this.parts = {
      torso: pickBest(this.uniform, g => g.max[2] > 20 && g.min[2] < -20),
      legs: pickBest(this.uniform, g => g.max[2] < -20),
      arms: pickBest(this.skin, (b, geo) => b.max[0] > 30 && b.max[0] < 35 && geo.materials[0].texture === 'plihjoh'),
      hands: pickBest(this.hand, (b, geo) => geo.materials[0].texture === 'plihjoh' && b.max[2] < 30),
      shoes: pickBest(this.equip, b => b.max[2] < -30),
      helmet: pickBest(this.helmet, b => b.max[2] <= 6 && b.min[2] <= -2),
    };
    this.heads = {}; for (const f of FACES) this.heads[f] = pickBest(this.skin, (b, geo) => geo.materials[0].texture === 'plih' + f && b.max[2] > 28);
    this.clips = this.bank.names();
    this.ready = true;
    return this;
  }

  // Build a player for a team (2-letter code), home/away, face name.
  async build(teamCode, home, face) {
    const root = new THREE.Group();                     // placed/rotated by the scene
    const body = new THREE.Group(); body.rotation.x = -Math.PI / 2; body.scale.setScalar(IN); root.add(body);
    // bones from the skeleton frames
    const bones = this.frames.map((f, i) => { const b = new THREE.Bone(); b.name = 'f' + i; setRest(b, f); return b; });
    this.frames.forEach((f, i) => { if (f.parent >= 0) bones[f.parent].add(bones[i]); else body.add(bones[i]); });
    const rename = t => {
      if (!t) return t;
      if (t === 'mdihunih') return `${teamCode}ihuni${home ? 'h' : 'a'}`;
      if (t === 'mdihhelm') return `${teamCode}ihhelm`;
      return t;
    };
    const faceName = FACES.includes(face) ? face : FACES[0];
    const items = [
      [this.uniform, this.parts.torso], [this.uniform, this.parts.legs], [this.skin, this.parts.arms],
      [this.equip, this.parts.shoes], [this.helmet, this.parts.helmet], [this.skin, this.heads[faceName]], [this.hand, this.parts.hands],
    ];
    const meshes = [];
    for (const [model, ai] of items) {
      if (ai === null || ai === undefined) continue;
      const atom = model.atomics[ai]; const geo = model.geometries[atom.geometry];
      for (const part of geo.parts) {
        const bg = partGeometry(part);
        const mat = await materialFor(this.assets, geo.materials[part.material] || {}, { rename, hints: [`${teamCode}_p_${home ? 'h' : 'a'}.rtd`, 'teams1.rtd', 'teams2.rtd', 'teams3.rtd', 'teams4.rtd'] });
        if (atom.skin) {
          const nv = geo.nvert; const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
          const idx = atom.skin.indices, w = atom.skin.weights;
          for (let v = 0; v < nv; v++) {
            const src = v === 0 && nv > 1 ? 1 : v;                                 // vertex 0's binding is corrupt on disc; borrow its neighbour's
            for (let k = 0; k < 3; k++) {
              let bi = idx[src * 4 + k]; const wt = w[src * 4 + k + 1] || 0;  // weights sit one slot later than indices
              if (bi >= this.table.length) bi = idx[v * 4 + 1] < this.table.length ? idx[v * 4 + 1] : 0;
              si[v * 4 + k] = this.tableToFrame[bi] ?? 1; sw[v * 4 + k] = wt;
            }
            si[v * 4 + 3] = 0; sw[v * 4 + 3] = 0;
            // data glitch guard: a vertex bound to a bone on the far side of the body when its mirror bone is right there
            const px = part.pos[v * 3], py = part.pos[v * 3 + 1], pz = part.pos[v * 3 + 2];
            for (let k = 0; k < 3; k++) {
              if (!(sw[v * 4 + k] > 0)) continue;
              const w0 = this.restPos[si[v * 4 + k]]; if (!w0) continue;
              const d0 = Math.hypot(px - w0[0], py - w0[1], pz - w0[2]);
              if (d0 > 18) {
                let bestF = -1, bestD = d0;
                this.restPos.forEach((w, fi) => { if (fi < 1 || fi === 2) return; const dd = Math.hypot(px - w[0], py - w[1], pz - w[2]); if (dd < bestD) { bestD = dd; bestF = fi; } });
                if (bestF >= 0 && bestD < d0 * 0.5) si[v * 4 + k] = bestF;
              }
            }
            let s = sw[v * 4] + sw[v * 4 + 1] + sw[v * 4 + 2]; if (s <= 0) { sw[v * 4] = 1; s = 1; }
            for (let k = 0; k < 3; k++) sw[v * 4 + k] /= s;
          }
          bg.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); bg.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
          const mesh = new THREE.SkinnedMesh(bg, mat);
          const inverses = bones.map((b, i) => new THREE.Matrix4());
          for (const blk of atom.skin.bones) { const fi = this.tableToFrame[blk.index]; if (fi !== undefined) inverses[fi].fromArray(blk.inverseBind); }
          mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
          mesh.castShadow = true; mesh.frustumCulled = false; body.add(mesh); meshes.push(mesh);
        } else {
          const mesh = new THREE.Mesh(bg, mat); mesh.castShadow = true;
          bones[this.frameOfId[2] ?? 15].add(mesh);      // rigid pieces modelled around the head (HAnim id 2)
          meshes.push(mesh);
        }
      }
    }
    return new PlayerRig(this, root, bones, meshes);
  }
}

function pickBest(model, pred) {
  let best = null, bn = -1;
  model.atomics.forEach((a, ai) => { const geo = model.geometries[a.geometry]; const b = geoBounds(geo); if (pred(b, geo) && geo.nvert > bn) { bn = geo.nvert; best = ai; } });
  return best;
}
function setRest(bone, f) {
  const r = f.rot;
  const m = new THREE.Matrix4().set(r[0], r[3], r[6], f.pos[0], r[1], r[4], r[7], f.pos[1], r[2], r[5], r[8], f.pos[2], 0, 0, 0, 1);
  m.decompose(bone.position, bone.quaternion, bone.scale);
  bone.userData.restQ = bone.quaternion.clone(); bone.userData.restP = bone.position.clone();
}
function restWorld(frames) {
  const out = [];
  frames.forEach((f, i) => {
    const r = f.rot; const m = new THREE.Matrix4().set(r[0], r[3], r[6], f.pos[0], r[1], r[4], r[7], f.pos[1], r[2], r[5], r[8], f.pos[2], 0, 0, 0, 1);
    const w = f.parent >= 0 ? out[f.parent].clone().multiply(m) : m;
    out.push(w);
  });
  return out.map(m => [m.elements[12], m.elements[13], m.elements[14]]);
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
export class PlayerRig {
  constructor(kit, root, bones, meshes) { this.kit = kit; this.root = root; this.bones = bones; this.meshes = meshes; this.clip = null; this.t = 0; this.fps = 30; this.loop = true; this.speed = 1; this.rootMotion = false; }
  play(name, { loop = true, speed = 1, random = false, restart = false } = {}) {
    const c = typeof name === 'string' ? (this.kit.bank.clip(name) || this.kit.bank.find(name, random)) : name;
    if (!c) return false;
    if (this.clip === c && !restart) { this.loop = loop; this.speed = speed; return true; }
    this.clip = c; this.t = 0; this.loop = loop; this.speed = speed; return true;
  }
  get finished() { return !!this.clip && !this.loop && this.t * this.fps >= this.clip.keys - 1; }
  update(dt) {
    const c = this.clip; if (!c) return;
    this.t += dt * this.speed;
    const n = c.keys; let k = this.t * this.fps;
    if (this.loop) k = ((k % (n - 1)) + (n - 1)) % (n - 1); else k = Math.min(k, n - 1);
    const k0 = Math.floor(k), k1 = Math.min(n - 1, k0 + 1), f = k - k0;
    for (const [id, arr] of c.rot) {
      const fi = this.kit.frameOfId[id]; if (fi === undefined) continue;
      const b = this.bones[fi];
      _qa.set(arr[k0 * 4], arr[k0 * 4 + 1], arr[k0 * 4 + 2], arr[k0 * 4 + 3]); _qb.set(arr[k1 * 4], arr[k1 * 4 + 1], arr[k1 * 4 + 2], arr[k1 * 4 + 3]);
      b.quaternion.copy(_qa).slerp(_qb, f);
    }
    if (c.pos) {
      const p = c.pos; const hips = this.bones[this.kit.frameOfId[1] ?? 1];
      hips.position.set(0, 0, p[k0 * 3 + 2] * (1 - f) + p[k1 * 3 + 2] * f);          // keep height; horizontal root motion comes from the sim
      if (this.rootMotion) { hips.position.x = p[k0 * 3] * (1 - f) + p[k1 * 3] * f; hips.position.y = p[k0 * 3 + 1] * (1 - f) + p[k1 * 3 + 1] * f; }
    }
  }
}
