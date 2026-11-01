// P4CK archive reader (PS2).
//   0x00 'P4CK'   0x04 u32 dirOffset   0x08 u32 dirSize   0x0C u32 0
//   directory entries, 60 bytes each: char[48] path, u32 offset, u32 size, u32 0
import { Bin } from './bin.js';

export class Pak {
  constructor(buf, name = 'pak') {
    this.name = name;
    this.buf = buf;
    const b = new Bin(buf);
    if (b.str(4) !== 'P4CK') throw new Error(`${name}: not a P4CK archive`);
    const dirOff = b.u32(), dirSize = b.u32();
    this.entries = new Map();
    b.seek(dirOff);
    const n = Math.floor(dirSize / 60);
    for (let i = 0; i < n; i++) {
      const path = b.str(48).toLowerCase();
      const off = b.u32(), size = b.u32();
      b.u32();
      if (path) this.entries.set(path, { path, off, size });
    }
  }
  has(path) { return this.entries.has(path.toLowerCase()); }
  list(prefix = '') { return [...this.entries.keys()].filter(p => p.startsWith(prefix)); }
  // Returns a Uint8Array view (no copy) of one file inside the archive.
  get(path) {
    const e = this.entries.get(path.toLowerCase());
    if (!e) throw new Error(`${this.name}: missing ${path}`);
    return new Uint8Array(this.buf, e.off, e.size);
  }
  tryGet(path) { return this.has(path) ? this.get(path) : null; }
}

// Texture file name for a material ID, e.g. 42 -> textures/0042.raw
export const texPath = id => `textures/${String(id).padStart(4, '0')}.raw`;
