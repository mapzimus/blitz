// Streaming player for the disc's MIB music: headerless PS2 ADPCM, stereo 44.1 kHz,
// channels interleaved in 0x6740-byte chunks (left chunk, right chunk, ...).
const F = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];
const INTERLEAVE = 0x6740, BLOCK = 16, SPB = 28;

function decodeBlocks(bytes, start, count, st, out, outOff) {
  let n = outOff;
  for (let b = 0; b < count; b++) {
    const p = start + b * BLOCK;
    if (p + BLOCK > bytes.length) break;
    const shift = bytes[p] & 0x0f, filter = Math.min(4, bytes[p] >> 4);
    const f0 = F[filter][0], f1 = F[filter][1];
    for (let i = 0; i < SPB; i++) {
      const byte = bytes[p + 2 + (i >> 1)];
      let nib = (i & 1) ? (byte >> 4) : (byte & 0x0f);
      if (nib > 7) nib -= 16;
      let s = (nib << 12) >> shift;
      s += (st.s1 * f0 + st.s2 * f1 + 32) >> 6;
      s = Math.max(-32768, Math.min(32767, s));
      st.s2 = st.s1; st.s1 = s;
      out[n++] = s / 32768;
    }
  }
  return n;
}

// The stride varies per track. Both channels open with the same silent run, so the second silent run
// after sound starts marks the right channel; the file is always a whole number of chunk pairs.
export function findInterleave(bytes) {
  const zero = p => { for (let i = 2; i < 16; i++) if (bytes[p + i]) return false; return true; };
  let sounded = false;
  const cands = [];
  for (let p = 0; p < Math.min(bytes.length, 1 << 20); p += 16) {
    const z = zero(p);
    if (sounded && z) { cands.push(p); sounded = false; }
    if (!z) sounded = true;
  }
  for (const c of [...cands, 0x6f80, 0x6740, 0x8000]) if (c > 0 && bytes.length % (c * 2) === 0) return c;
  return cands[0] || INTERLEAVE;
}

export class Music {
  constructor(ctx, gainNode) { this.ctx = ctx; this.out = gainNode; this.stop(); }
  stop() {
    for (const s of this.sources || []) { try { s.stop(); } catch (e) { /* already done */ } }
    this.sources = []; this.bytes = null; this.pos = 0; this.next = 0; this.st = [{ s1: 0, s2: 0 }, { s1: 0, s2: 0 }]; this.playing = false;
    if (this.timer) clearInterval(this.timer); this.timer = null;
  }
  play(bytes, { loop = true, volume = 0.5 } = {}) {
    this.stop();
    this.bytes = bytes; this.loop = loop; this.playing = true;
    this.il = findInterleave(bytes);
    this.gain = this.ctx.createGain(); this.gain.gain.value = volume; this.gain.connect(this.out);
    this.next = this.ctx.currentTime + 0.05;
    this.pump(); this.timer = setInterval(() => this.pump(), 250);
  }
  // Keep about two seconds of decoded audio scheduled ahead.
  pump() {
    if (!this.playing) return;
    const IL = this.il;
    while (this.next < this.ctx.currentTime + 2.0) {
      if (this.pos + IL * 2 > this.bytes.length) {
        if (!this.loop) { this.playing = false; return; }
        this.pos = 0; this.st = [{ s1: 0, s2: 0 }, { s1: 0, s2: 0 }];
      }
      const frames = (IL / BLOCK) * SPB;
      const buf = this.ctx.createBuffer(2, frames, 44100);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        decodeBlocks(this.bytes, this.pos + ch * IL, IL / BLOCK, this.st[ch], data, 0);
      }
      this.pos += IL * 2;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.gain);
      src.start(this.next); this.next += frames / 44100;
      this.sources.push(src);
      if (this.sources.length > 8) this.sources.shift();
    }
  }
  setVolume(v) { if (this.gain) this.gain.gain.value = v; }
}
