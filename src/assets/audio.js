// MSLASSET.MS2 (Midway sound library) directory + PS2 ADPCM sample decoding.
const F1 = [0, 60 / 64, 115 / 64, 98 / 64, 122 / 64];
const F2 = [0, 0, -52 / 64, -55 / 64, -60 / 64];

export function decodeAdpcm(data) {
  const n = (data.length / 16) | 0;
  const out = new Float32Array(n * 28);
  let h1 = 0, h2 = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    const shift = data[o] & 0x0f; let filt = (data[o] >> 4) & 0x0f; if (filt > 4) filt = 0;
    const flag = data[o + 1];
    if (flag === 7) break;
    for (let j = 0; j < 14; j++) {
      const b = data[o + 2 + j];
      for (let q = 0; q < 2; q++) {
        let s = (q ? (b >> 4) : (b & 0xf)) << 12;
        if (s & 0x8000) s -= 0x10000;
        s = shift <= 12 ? s >> shift : 0;
        const v = s + h1 * F1[filt] + h2 * F2[filt];
        h2 = h1; h1 = v;
        out[k++] = Math.max(-1, Math.min(1, v / 32768));
      }
    }
    if (flag === 1) break;
  }
  return out.subarray(0, k);
}

// Returns Map name -> {off, size} for every .mss/.msb inside the container.
export function readSoundTable(head) {
  const dec = new TextDecoder('latin1');
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const map = new Map();
  let p = 0x11;
  for (;;) {
    let e = p; while (e < head.length && head[e] !== 0) e++;
    if (e + 9 > head.length) break;
    const name = dec.decode(head.subarray(p, e));
    if (!name.endsWith('.mss') && !name.endsWith('.msb')) break;
    map.set(name.toLowerCase(), { off: dv.getUint32(e + 1, true), size: dv.getUint32(e + 5, true) });
    p = e + 9;
  }
  return map;
}

// blob = one .mss record. Returns {rate, channels, samples:[Float32Array...]}
export function decodeMss(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ch = dv.getUint32(8, true), rate = dv.getUint32(12, true), dsize = dv.getUint32(16, true);
  const hdr = 0x14 + 16 * ch;
  const data = bytes.subarray(hdr, hdr + dsize);
  if (ch === 1) return { rate, channels: 1, samples: [decodeAdpcm(data)] };
  const L = new Uint8Array((data.length / 2) | 0), R = new Uint8Array((data.length / 2) | 0);
  for (let i = 0, j = 0; i + 32 <= data.length; i += 32, j += 16) { L.set(data.subarray(i, i + 16), j); R.set(data.subarray(i + 16, i + 32), j); }
  return { rate, channels: 2, samples: [decodeAdpcm(L), decodeAdpcm(R)] };
}

export function toAudioBuffer(ctx, s) {
  const len = Math.min(...s.samples.map(a => a.length));
  const buf = ctx.createBuffer(s.channels, Math.max(1, len), s.rate);
  for (let c = 0; c < s.channels; c++) buf.copyToChannel(s.samples[c].subarray(0, len), c);
  return buf;
}
