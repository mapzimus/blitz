// Hit effects: blood spray when a character is hit, a pool when one dies, dust where bullets land.
// Sprites use the disc's own hit textures (textures/misc/charhitN) when the arena pack has them.
import * as THREE from 'three';
import { decodeTexture } from './texture.js';

const G = 11;

export class Fx {
  constructor({ scene, pak }) {
    this.scene = scene;
    this.list = [];
    this.decals = [];
    this.mats = [];
    const names = pak ? pak.list('textures/misc/').filter(p => /charhit\d+\.raw$/.test(p)) : [];
    for (const p of names.slice(0, 8)) {
      try {
        const dec = decodeTexture(pak.get(p));
        const tex = new THREE.DataTexture(dec.data, dec.width, dec.height, THREE.RGBAFormat);
        tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
        this.mats.push(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xff2020 }));
      } catch (e) { /* skip */ }
    }
    if (!this.mats.length) this.mats.push(new THREE.SpriteMaterial({ color: 0xa00000, transparent: true, depthWrite: false }));
    this.dust = new THREE.SpriteMaterial({ color: 0xc8b89a, transparent: true, depthWrite: false, opacity: 0.6 });
    this.poolGeo = new THREE.CircleGeometry(0.5, 14);
    this.poolMat = new THREE.MeshBasicMaterial({ color: 0x5a0000, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  }

  // Spray from a wound: `dir` is the bullet direction, so most drops carry on past the body.
  blood(pos, dir, amount = 1) {
    const n = Math.round(10 * amount);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.mats[Math.floor(Math.random() * this.mats.length)].clone());
      const size = 0.08 + Math.random() * 0.16 * amount;
      s.scale.setScalar(size);
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3));
      const v = dir ? dir.clone().multiplyScalar(2 + Math.random() * 4) : new THREE.Vector3();
      v.add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
      this.scene.add(s);
      this.list.push({ s, v, t: 0, life: 0.5 + Math.random() * 0.5, kind: 'blood' });
    }
  }

  // Bullet impact on the world.
  puff(pos, normal) {
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(this.dust.clone());
      s.scale.setScalar(0.06 + Math.random() * 0.08);
      s.position.copy(pos).addScaledVector(normal, 0.03);
      const v = normal.clone().multiplyScalar(1 + Math.random() * 1.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5));
      this.scene.add(s);
      this.list.push({ s, v, t: 0, life: 0.25 + Math.random() * 0.2, kind: 'dust' });
    }
  }

  // A pool under a body. `floorY` is where the floor was found.
  pool(pos, floorY, size = 1) {
    const m = new THREE.Mesh(this.poolGeo, this.poolMat.clone());
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, floorY + 0.02, pos.z);
    m.scale.setScalar(0.3);
    this.scene.add(m);
    this.decals.push({ m, t: 0, size });
    if (this.decals.length > 24) { const d = this.decals.shift(); this.scene.remove(d.m); }
  }

  update(dt) {
    for (const p of this.list) {
      p.t += dt;
      p.v.y -= G * dt;
      p.s.position.addScaledVector(p.v, dt);
      const k = 1 - p.t / p.life;
      p.s.material.opacity = Math.max(0, k) * (p.kind === 'dust' ? 0.6 : 1);
      if (p.kind === 'dust') p.s.scale.multiplyScalar(1 + dt * 3);
      if (p.t >= p.life) { this.scene.remove(p.s); p.s.material.dispose(); p.done = true; }
    }
    if (this.list.some(p => p.done)) this.list = this.list.filter(p => !p.done);
    for (const d of this.decals) {
      if (d.t < 1) { d.t = Math.min(1, d.t + dt * 1.5); d.m.scale.setScalar(0.3 + 0.7 * d.size * Math.sqrt(d.t)); }
    }
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.s);
    for (const d of this.decals) this.scene.remove(d.m);
    this.list = []; this.decals = [];
  }
}
