// EKAB animation bank decoder (port of tools/ban.py). Clip keys are per HAnim bone id; the root
// track also carries the hips' position in character space (inches, z up).
export class Bank {
  constructor(bytes) {
    const d = this.d = bytes, dv = this.dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const n = dv.getUint32(8, true);
    this.nbones = dv.getUint32(12, true);
    this.entries = [];
    const dec = new TextDecoder('latin1');
    for (let i = 0; i < n; i++) {
      const no = dv.getUint32(0x28 + i * 16, true), nf = dv.getUint32(0x2c + i * 16, true), nb = dv.getUint32(0x30 + i * 16, true), off = dv.getUint32(0x34 + i * 16, true);
      let st = Math.min(no, d.length - 1); while (st > 0 && d[st - 1] !== 0 && no - st < 48) st--;   // offsets land inside the name; back up to its start
      let e = st; while (e < d.length && d[e]) e++;
      this.entries.push({ name: dec.decode(d.subarray(st, e)), frames: nf, bones: nb, off });
    }
    for (let i = 0; i < n; i++) this.entries[i].end = i + 1 < n ? this.entries[i + 1].off : d.length;
    this.byName = new Map(this.entries.map((e, i) => [e.name, i]));
    this.cache = new Map();
  }
  names() { return this.entries.map(e => e.name); }

  tracks(ai) {
    const e = this.entries[ai], d = this.d, dv = this.dv;
    const recs = []; let p = e.off + 12;
    while (p + 16 <= e.end) {
      const t = dv.getUint32(p, true), o = dv.getUint32(p + 8, true), b = dv.getUint32(p + 12, true);
      if (!(t === 4 || t === 6) || o < p || o >= e.end || b > 64) break;
      recs.push({ t, o, b }); p += 16;
    }
    for (let i = 0; i < recs.length; i++) recs[i].end = i + 1 < recs.length ? recs[i + 1].o : e.end;
    return recs;
  }

  // Returns {name, frames, keys, rot: Map(bone -> Float32Array(keys*4)), pos: Float32Array(keys*3) | null, root}
  decode(ai) {
    if (this.cache.has(ai)) return this.cache.get(ai);
    const d = this.d, dv = this.dv, e = this.entries[ai];
    const out = { name: e.name, frames: e.frames, keys: 0, rot: new Map(), pos: null, root: -1 };
    for (const { t, o, b, end } of this.tracks(ai)) {
      if (t === 4) {
        const D = [0, 1, 2, 3].map(k => dv.getFloat32(o + 8 + 4 * k, true)), A = [0, 1, 2, 3].map(k => dv.getFloat32(o + 24 + 4 * k, true));
        const q = [0, 1, 2, 3].map(k => dv.getFloat32(o + 40 + 4 * k, true));
        const nk = Math.max(1, Math.min(e.frames - 2, 1 + Math.max(0, Math.floor((end - o - 56) / 4))));
        const arr = new Float32Array(nk * 4); arr.set(q, 0);
        for (let i = 1; i < nk; i++) {
          const w = o + 56 + 4 * (i - 1);
          for (let k = 0; k < 4; k++) q[k] += D[k] + d[w + k] * A[k];
          const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
          for (let k = 0; k < 4; k++) arr[i * 4 + k] = q[k] / l;
        }
        out.rot.set(b, arr); out.keys = Math.max(out.keys, nk);
      } else {
        const f = []; for (let k = 0; k < 18; k++) f.push(dv.getFloat32(o + 8 + 4 * k, true));
        const Dr = [f[0], f[2], f[4], f[6]], Ar = [f[1], f[3], f[5], f[7]], Dp = [f[8], f[10], f[12]], Ap = [f[9], f[11], f[13]];
        const q = [f[14], f[15], f[16], f[17]];
        const p = [0, 1, 2].map(k => dv.getFloat32(o + 80 + 4 * k, true));
        const nk = Math.max(1, Math.min(e.frames - 2, 1 + Math.max(0, Math.floor((end - o - 92) / 8))));
        const rot = new Float32Array(nk * 4), pos = new Float32Array(nk * 3); rot.set(q, 0); pos.set(p, 0);
        for (let i = 1; i < nk; i++) {
          const w = o + 92 + 8 * (i - 1);
          for (let k = 0; k < 3; k++) p[k] += Dp[k] + d[w + k] * Ap[k];
          for (let k = 0; k < 4; k++) q[k] += Dr[k] + d[w + 4 + k] * Ar[k];
          const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
          for (let k = 0; k < 4; k++) rot[i * 4 + k] = q[k] / l;
          for (let k = 0; k < 3; k++) pos[i * 3 + k] = p[k];
        }
        out.rot.set(b, rot); out.pos = pos; out.root = b; out.keys = Math.max(out.keys, nk);
      }
    }
    this.cache.set(ai, out);
    return out;
  }
  clip(name) { const i = this.byName.get(name); return i === undefined ? null : this.decode(i); }
  // first clip whose name starts with prefix (optionally a random one among matches)
  find(prefix, random = false) {
    const m = []; for (const [n, i] of this.byName) if (n.startsWith(prefix)) m.push(i);
    if (!m.length) return null;
    return this.decode(random ? m[(Math.random() * m.length) | 0] : m[0]);
  }
}
