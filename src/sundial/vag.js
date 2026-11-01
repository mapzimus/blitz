// Sony VAG (PS2 ADPCM) decoder. 48-byte big-endian header ("VAGp", version, 0, dataSize, sampleRate, ..., name),
// then 16-byte blocks: byte0 = shift (low nibble) | filter (high nibble), byte1 = flags, 14 bytes of 4-bit samples.
const F = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];

export function decodeVag(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 22050, start = 0;
  if (bytes.length >= 48 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'VAGp') {
    rate = dv.getUint32(16, false) || 22050;
    start = 48;
  }
  const blocks = Math.floor((bytes.length - start) / 16);
  const out = new Float32Array(blocks * 28);
  let s1 = 0, s2 = 0, n = 0;
  for (let b = 0; b < blocks; b++) {
    const p = start + b * 16;
    const shift = bytes[p] & 0x0f, filter = Math.min(4, bytes[p] >> 4), flags = bytes[p + 1];
    if (flags === 7) break; // end marker
    const f0 = F[filter][0], f1 = F[filter][1];
    for (let i = 0; i < 28; i++) {
      const byte = bytes[p + 2 + (i >> 1)];
      let nib = (i & 1) ? (byte >> 4) : (byte & 0x0f);
      if (nib > 7) nib -= 16;
      let s = (nib << 12) >> shift;
      s += (s1 * f0 + s2 * f1 + 32) >> 6;
      s = Math.max(-32768, Math.min(32767, s));
      s2 = s1; s1 = s;
      out[n++] = s / 32768;
    }
  }
  return { rate, samples: out.subarray(0, n) };
}
