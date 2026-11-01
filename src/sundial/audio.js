// Sound effects from SOUNDS.PAK, decoded from VAG on first use.
import { decodeVag } from './vag.js';

export class Sfx {
  constructor(pak) { this.pak = pak; this.ctx = null; this.buffers = new Map(); this.gain = null; }
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain(); this.gain.gain.value = 0.6; this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  buffer(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    let buf = null;
    const bytes = this.pak && this.pak.tryGet(`sfx/${name}.vag`);
    if (bytes) {
      const { rate, samples } = decodeVag(bytes);
      buf = this.ensure().createBuffer(1, samples.length, rate);
      buf.copyToChannel(samples, 0);
    }
    this.buffers.set(name, buf);
    return buf;
  }
  // Play a sound; `pos` (THREE.Vector3) and `listener` give simple distance attenuation.
  play(name, { volume = 1, pos = null, listener = null, rate = 1 } = {}) {
    const ctx = this.ensure();
    const buf = this.buffer(name);
    if (!buf) return;
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain();
    let v = volume;
    if (pos && listener) { const d = pos.distanceTo(listener); v *= Math.max(0, 1 - d / 40); }
    g.gain.value = v;
    src.connect(g); g.connect(this.gain); src.start();
  }
}
