// Turn parsed disc data into three.js objects.
import * as THREE from 'three';
import { decodeTexture } from './texture.js';
import { texPath } from './pak.js';

const MISSING = (() => {
  const d = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) { const m = ((i & 1) ^ (i >> 2 & 1)) ? 255 : 40; d.set([m, 0, m, 255], i * 4); }
  const t = new THREE.DataTexture(d, 4, 4); t.needsUpdate = true; return t;
})();

// Texture cache per archive: id -> THREE.DataTexture
export class TexSource {
  constructor(pak) { this.pak = pak; this.cache = new Map(); }
  get(mat, embedded) {
    const key = mat.id;
    if (this.cache.has(key)) return this.cache.get(key);
    let tex = null;
    try {
      const dec = embedded && embedded.get(mat.id) || decodeTexture(this.pak.get(texPath(mat.id)));
      tex = new THREE.DataTexture(dec.data, dec.width, dec.height, THREE.RGBAFormat);
      tex.hasAlpha = dec.hasAlpha;
    } catch (e) {
      tex = MISSING; tex.hasAlpha = false;
    }
    tex.wrapS = mat.wrapX === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapT = mat.wrapY === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.cache.set(key, tex);
    return tex;
  }
}

// One stream -> one Mesh with per-material groups.
// `materials` is the model/map material list; `texSrc` resolves textures; `opts.colorScale` scales baked vertex colors.
export function streamToMesh(stream, materials, texSrc, opts = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(stream.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(stream.uvs, 2));
  if (stream.normals) g.setAttribute('normal', new THREE.BufferAttribute(stream.normals, 3));
  if (stream.colors && opts.vertexColors !== false) {
    const c = new Float32Array(stream.count * 3);
    const k = (opts.colorScale ?? 2) / 255; // PS2 0x80 == 1.0
    for (let i = 0; i < stream.count; i++) {
      c[i * 3] = Math.min(1.5, stream.colors[i * 4] * k);
      c[i * 3 + 1] = Math.min(1.5, stream.colors[i * 4 + 1] * k);
      c[i * 3 + 2] = Math.min(1.5, stream.colors[i * 4 + 2] * k);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  g.setIndex(new THREE.BufferAttribute(stream.index, 1));
  const mats = [];
  const matIndex = new Map();
  for (const grp of stream.groups) {
    const m = materials[grp.mat] || { id: 0xffffffff, wrapX: 0, wrapY: 0, flags: 0 };
    let mi = matIndex.get(grp.mat);
    if (mi === undefined) {
      const tex = texSrc.get(m, opts.embedded);
      const Mat = opts.lit ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial;
      const mat = new Mat({
        map: tex,
        vertexColors: !!g.getAttribute('color'),
        side: THREE.DoubleSide,
        transparent: !!(opts.transparent || tex.hasAlpha),
        alphaTest: tex.hasAlpha && !opts.transparent ? 0.3 : 0,
        depthWrite: !opts.transparent,
      });
      if (opts.tint) mat.color.copy(opts.tint);
      mi = mats.length; mats.push(mat); matIndex.set(grp.mat, mi);
    }
    g.addGroup(grp.start, grp.count, mi);
  }
  if (!stream.normals) g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, mats);
  if (opts.transparent) mesh.renderOrder = 10;
  return mesh;
}

// Whole model (all parts, all streams) as one Group. Parts of rigid props are already in object space.
export function modelToGroup(model, texSrc, opts = {}) {
  const grp = new THREE.Group();
  model.parts.forEach((part, pi) => {
    part.forEach((st, si) => {
      if (!st || !st.groups.length) return;
      const mesh = streamToMesh(st, model.materials, texSrc, { ...opts, embedded: model.embedded, transparent: si === 2, vertexColors: false });
      mesh.userData.part = pi; mesh.userData.stream = si;
      grp.add(mesh);
    });
  });
  return grp;
}

// Gun models carry their muzzle flash as big alpha-textured quads. Returns those meshes (hidden).
export function hideFlash(group) {
  const flash = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    const alpha = o.material.every(m => m.map && m.map.hasAlpha);
    if (o.userData.stream === 2 || (alpha && o.geometry.boundingSphere.radius > 0.25)) { o.visible = false; flash.push(o); }
  });
  return flash;
}

export function mapToGroup(map, texSrc) {
  const grp = new THREE.Group();
  const solid = [];
  for (const sec of map.sections) {
    sec.streams.forEach((st, si) => {
      if (!st || !st.groups.length) return;
      // Stream 1 is the overlay layer (light pools, frost, decals) and stream 2 the transparent one; both blend.
      const mesh = streamToMesh(st, map.materials, texSrc, { transparent: si >= 1 });
      mesh.userData.section = sec.id;
      grp.add(mesh);
      if (si === 0) solid.push(mesh);
    });
  }
  return { group: grp, solid };
}
