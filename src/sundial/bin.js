// Tiny little-endian binary reader over an ArrayBuffer. Pure JS, works in Node and browsers.
export class Bin {
  constructor(buf, byteOffset = 0, byteLength) {
    this.buf = buf;
    this.dv = new DataView(buf, byteOffset, byteLength);
    this.u8 = new Uint8Array(buf, byteOffset, byteLength);
    this.pos = 0;
  }
  static of(bytes) { return new Bin(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  get length() { return this.dv.byteLength; }
  seek(p) { this.pos = p; return this; }
  skip(n) { this.pos += n; return this; }
  u8at(p) { return this.dv.getUint8(p); }
  u16at(p) { return this.dv.getUint16(p, true); }
  u32at(p) { return this.dv.getUint32(p, true); }
  f32at(p) { return this.dv.getFloat32(p, true); }
  u8r() { const v = this.dv.getUint8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  bytes(n) { const v = this.u8.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  // NUL-padded fixed-width string
  str(n) {
    const b = this.bytes(n);
    let e = b.indexOf(0); if (e < 0) e = n;
    let s = '';
    for (let i = 0; i < e; i++) s += String.fromCharCode(b[i]);
    return s;
  }
}
