// The 19-bone humanoid skeleton used by every character, and a rig that drives a
// part-based character model with it. Parts are rigid; each follows one bone.
import * as THREE from 'three';

export const HUMAN = {
  names: ['Root', 'Hips', 'Waist', 'Neck', 'Head', 'RShoulder1', 'RShoulder2', 'RElbow', 'RWrist',
    'LShoulder1', 'LShoulder2', 'LElbow', 'LWrist', 'RHip', 'RKnee', 'RFoot', 'LHip', 'LKnee', 'LFoot'],
  // children of bone i, as bone indices
  children: [[1, 13, 16], [2], [3, 5, 9], [4], [], [6], [7], [8], [], [10], [11], [12], [], [14], [15], [], [17], [18], []],
};
export const PARENT = (() => { const p = new Array(19).fill(-1); HUMAN.children.forEach((cs, i) => cs.forEach(c => (p[c] = i))); return p; })();

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);

// World matrices for a set of per-bone local transforms ({pos:[3], rot:[4]}[]).
export function worldMatrices(locals, out) {
  out = out || Array.from({ length: 19 }, () => new THREE.Matrix4());
  for (let i = 0; i < 19; i++) {
    const l = locals[i];
    _m.compose(_v.set(l.pos[0], l.pos[1], l.pos[2]), _q.set(l.rot[0], l.rot[1], l.rot[2], l.rot[3]), _s);
    if (PARENT[i] < 0) out[i].copy(_m); else out[i].multiplyMatrices(out[PARENT[i]], _m);
  }
  return out;
}

// Bind pose from the human_19_bindpose animation: locals plus world and inverse-world matrices.
export function makeBind(bindAnim) {
  const locals = bindAnim.bones.map(bn => ({ pos: bn.pos, rot: bn.rot }));
  const world = worldMatrices(locals);
  const inv = world.map(m => m.clone().invert());
  const joints = world.map(m => new THREE.Vector3().setFromMatrixPosition(m));
  return { locals, world, inv, joints };
}

// Assign each model part to the bone whose segment (joint -> child joints) is nearest the part's centroid.
export function assignParts(model, bind) {
  // Each bone owns the stretch from a little past its own joint up to and a little beyond its child's joint,
  // so a piece sitting on a joint goes with the parent bone (the elbow piece moves with the upper arm).
  const segs = [];
  for (let i = 0; i < 19; i++) {
    const a = bind.joints[i];
    const kids = HUMAN.children[i];
    if (kids.length) {
      for (const c of kids) {
        const b = bind.joints[c];
        const d = b.clone().sub(a);
        segs.push({ bone: i, a: a.clone().addScaledVector(d, 0.2), b: b.clone().addScaledVector(d, 0.25) });
      }
    } else {
      segs.push({ bone: i, a, b: a.clone().add(new THREE.Vector3(0, i === 4 ? 0.3 : -0.1, 0)) });
    }
  }
  const map = model.parts.map((part, pi) => {
    const st = part[0] || part[1] || part[2];
    if (!st || !st.count) return 0;
    const c = new THREE.Vector3();
    for (let k = 0; k < st.count; k++) c.x += st.positions[k * 3], c.y += st.positions[k * 3 + 1], c.z += st.positions[k * 3 + 2];
    c.multiplyScalar(1 / st.count);
    let best = 0, bd = Infinity;
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for (const s of segs) {
      ab.subVectors(s.b, s.a); ac.subVectors(c, s.a);
      const t = Math.max(0, Math.min(1, ab.lengthSq() ? ac.dot(ab) / ab.lengthSq() : 0));
      const d = ac.sub(ab.multiplyScalar(t)).length();
      // Keep sides honest: a part clearly on one side never joins the other side's limb.
      const side = (s.bone >= 5 && s.bone <= 8) || (s.bone >= 13 && s.bone <= 15) ? -1 : (s.bone >= 9 && s.bone <= 12) || (s.bone >= 16 && s.bone <= 18) ? 1 : 0;
      const pen = side && Math.sign(c.x) === -side && Math.abs(c.x) > 0.06 ? 1 : 0;
      if (d + pen < bd) { bd = d + pen; best = s.bone; }
    }
    return best;
  });
  return map;
}

// Drives a THREE.Group built by modelToGroup (children carry userData.part) with animations.
export class Rig {
  constructor(group, model, bind) {
    this.group = group; this.bind = bind;
    this.partBone = assignParts(model, bind);
    this.world = Array.from({ length: 19 }, () => new THREE.Matrix4());
    this.locals = bind.locals.map(l => ({ pos: l.pos.slice(), rot: l.rot.slice() }));
    this.clip = null; this.time = 0; this.loop = true; this.speed = 1; this.done = false;
    this.next = null; this.blend = 0;
    this.rootOffset = new THREE.Vector3();
    this.attachments = []; // { obj, bone, offset: Matrix4 }
    for (const o of group.children) if (o.isMesh) o.matrixAutoUpdate = false;
  }
  // Hang an object (a held gun, a hat) off a bone. `offset` is in bone space.
  attach(obj, bone, offset) {
    obj.matrixAutoUpdate = false;
    this.group.add(obj);
    this.attachments.push({ obj, bone, offset: offset || new THREE.Matrix4() });
  }
  detach(obj) { this.attachments = this.attachments.filter(a => a.obj !== obj); this.group.remove(obj); }
  bonePosition(bone, out) { return (out || new THREE.Vector3()).setFromMatrixPosition(this.world[bone]).multiplyScalar(this.group.scale.x).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y).add(this.group.position); }
  play(clip, { loop = true, speed = 1, restart = false } = {}) {
    if (this.clip === clip && !restart) { this.loop = loop; this.speed = speed; return; }
    this.clip = clip; this.loop = loop; this.speed = speed; this.time = 0; this.done = false;
  }
  // Sample bone b at the clip's time t (frames) into out {pos, rot}.
  sample(bone, b, t, out) {
    const keys = this.clip.keys, n = keys.length;
    let k = 0;
    while (k < n - 1 && keys[k + 1] <= t) k++;
    const k2 = Math.min(n - 1, k + 1);
    const span = keys[k2] - keys[k];
    const f = span > 0 ? Math.max(0, Math.min(1, (t - keys[k]) / span)) : 0;
    const ra = bone.rot[k], rb = bone.rot[k2];
    _q.set(ra[0], ra[1], ra[2], ra[3]);
    const qb = new THREE.Quaternion(rb[0], rb[1], rb[2], rb[3]);
    _q.slerp(qb, f).normalize();
    out.rot[0] = _q.x; out.rot[1] = _q.y; out.rot[2] = _q.z; out.rot[3] = _q.w;
    if (bone.kind === 'root') {
      const pa = bone.pos[k], pb = bone.pos[k2], p0 = bone.pos[0];
      // Root motion stays with the game object: keep the first key's x/z, animate y only.
      out.pos[0] = p0[0]; out.pos[2] = p0[2];
      out.pos[1] = pa[1] + (pb[1] - pa[1]) * f;
    } else { out.pos[0] = bone.pos[0]; out.pos[1] = bone.pos[1]; out.pos[2] = bone.pos[2]; }
  }
  update(dt) {
    if (!this.clip) return;
    const total = Math.max(1, this.clip.total);
    this.time += dt * 60 * this.speed;
    if (this.time >= total) {
      if (this.loop) this.time %= total; else { this.time = total - 0.001; this.done = true; }
    }
    const c = this.clip;
    for (let i = 0; i < 19; i++) {
      const bn = c.bones[i];
      if (!bn || bn.kind === 'unknown') continue;
      if (bn.kind === 'bind') { this.locals[i].pos = bn.pos; this.locals[i].rot = bn.rot; continue; }
      this.sample(bn, i, this.time, this.locals[i]);
    }
    worldMatrices(this.locals, this.world);
    for (const o of this.group.children) {
      if (!o.isMesh || o.userData.part === undefined) continue;
      const b = this.partBone[o.userData.part] || 0;
      o.matrix.multiplyMatrices(this.world[b], this.bind.inv[b]);
    }
    for (const a of this.attachments) a.obj.matrix.multiplyMatrices(this.world[a.bone], a.offset);
  }
}

// Grip for a held gun (ob/guns/*_cl): barrel +Z turned onto the wrist bone's +X, nudged into the palm.
export const RWRIST = 8, LWRIST = 12, HEAD = 4;
export function gunGrip() {
  return new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0.06, -0.02, 0.02));
}
