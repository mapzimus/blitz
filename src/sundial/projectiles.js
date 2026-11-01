// Rockets, grenades, thrown objects and explosions.
import * as THREE from 'three';

const G = 14;

export class Projectiles {
  // damage(pos, radius, dmg, owner) applies splash damage; explodeFx(pos, big) draws it; solid: level meshes
  constructor({ scene, solid, onSplash, sfx, models }) {
    this.scene = scene; this.solid = solid; this.onSplash = onSplash; this.sfx = sfx; this.models = models || {};
    this.list = []; this.fx = [];
    this.ray = new THREE.Raycaster();
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sphere = new THREE.SphereGeometry(1, 12, 10);
  }
  fire(w, from, dir, owner, target) {
    const p = { w, pos: from.clone(), vel: dir.clone().multiplyScalar(w.speed || 20), owner, life: 0, mesh: null, target: target || null, bounced: 0 };
    if (w.kind === 'grenade') p.vel.y += (w.throwUp || 0.15) * (w.speed || 20);
    const proto = this.models[w.kind === 'rocket' ? 'missile' : w.key] || this.models.missile;
    if (proto) {
      p.mesh = proto.clone();
      p.mesh.position.copy(from);
      this.scene.add(p.mesh);
    }
    this.list.push(p);
    return p;
  }
  explode(p) {
    const w = p.w;
    if (w.radius > 0) { this.onSplash(p.mesh ? p.mesh.position : p.pos, w.radius, w.dmg, p.owner); this.fxAt(p.pos, w.radius); this.sfx.play(w.radius > 3.6 ? 'fe_explosion22_01' : 'mini_explode22_01', { pos: p.pos, listener: this.listener, volume: 1 }); }
    else if (w.hitSfx) this.sfx.play(w.hitSfx, { pos: p.pos, listener: this.listener, volume: 0.7 });
    this.remove(p);
  }
  remove(p) { if (p.mesh) this.scene.remove(p.mesh); p.dead = true; }
  fxAt(pos, radius) {
    const m = new THREE.Mesh(this.sphere, this.flashMat.clone());
    m.position.copy(pos); m.scale.setScalar(0.2); m.userData.r = radius; m.userData.t = 0;
    this.scene.add(m); this.fx.push(m);
    const l = new THREE.PointLight(0xffa040, 40, radius * 4); l.position.copy(pos); l.userData.t = 0; this.scene.add(l); this.fx.push(l);
  }
  update(dt, hitTest) {
    for (const p of this.list) {
      if (p.dead) continue;
      p.life += dt;
      if (p.life > 8) { this.explode(p); continue; }
      const w = p.w;
      if (w.kind === 'grenade') p.vel.y -= G * dt;
      if (w.homing && p.target) {
        const want = p.target.clone().sub(p.pos).normalize().multiplyScalar(w.speed);
        p.vel.lerp(want, Math.min(1, dt * 2.5));
      }
      const step = p.vel.clone().multiplyScalar(dt);
      const len = step.length();
      if (len > 0) {
        this.ray.set(p.pos, step.clone().normalize()); this.ray.far = len + 0.15;
        const hits = this.ray.intersectObjects(this.solid, false);
        // characters along the path
        const hit = hitTest ? hitTest(p) : null;
        if (hit) { p.pos.add(step); this.explode(p); if (w.radius === 0) this.onSplash(p.pos, 0.5, w.dmg, p.owner, hit); continue; }
        if (hits.length) {
          const h = hits[0];
          if (w.kind === 'grenade' && w.fuse > 0 && p.life < w.fuse) {
            const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
            p.pos.copy(h.point).addScaledVector(n, 0.1);
            p.vel.reflect(n).multiplyScalar(0.45); p.bounced++;
            continue;
          }
          p.pos.copy(h.point).addScaledVector(step.clone().normalize(), -0.1);
          this.explode(p); continue;
        }
      }
      p.pos.add(step);
      if (w.kind === 'grenade' && w.fuse > 0 && p.life >= w.fuse) { this.explode(p); continue; }
      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        if (p.vel.lengthSq() > 0.01) p.mesh.lookAt(p.pos.clone().add(p.vel));
        if (w.kind === 'grenade') p.mesh.rotateX(dt * 6);
      }
    }
    this.list = this.list.filter(p => !p.dead);
    for (const f of this.fx) {
      f.userData.t += dt;
      const t = f.userData.t;
      if (f.isMesh) { f.scale.setScalar(0.2 + f.userData.r * Math.min(1, t * 5)); f.material.opacity = Math.max(0, 0.9 - t * 2.2); }
      else f.intensity = Math.max(0, 40 * (1 - t * 3));
      if (t > 0.5) { this.scene.remove(f); f.userData.done = true; }
    }
    this.fx = this.fx.filter(f => !f.userData.done);
  }
}
