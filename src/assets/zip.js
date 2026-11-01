// Minimal reader for a STORED (uncompressed) zip held in a File/Blob. Entries are sliced lazily,
// so a 360 MB archive costs nothing until a specific file is requested.
export class StoredZip {
  constructor(file) { this.file = file; this.entries = new Map(); }

  static async open(file) {
    const z = new StoredZip(file);
    await z.readDirectory();
    return z;
  }

  async readDirectory() {
    const size = this.file.size;
    const tailLen = Math.min(size, 66000);
    const tail = new DataView(await this.file.slice(size - tailLen, size).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip file (no end-of-directory record)');
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOff = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await this.file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder('latin1');
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cdSize; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      const csize = cd.getUint32(p + 20, true);
      const usize = cd.getUint32(p + 24, true);
      const nlen = cd.getUint16(p + 28, true), elen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
      const lho = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      this.entries.set(name.toLowerCase(), { name, method, csize, usize, lho, dataStart: -1 });
      p += 46 + nlen + elen + clen;
    }
  }

  has(name) { return this.entries.has(name.toLowerCase()); }
  list(pred) { return [...this.entries.values()].filter(e => !pred || pred(e.name)); }

  async blob(name) {
    const e = this.entries.get(name.toLowerCase());
    if (!e) throw new Error('zip: missing ' + name);
    if (e.method !== 0) throw new Error('zip: compressed entry not supported: ' + name);
    if (e.dataStart < 0) {
      const lh = new DataView(await this.file.slice(e.lho, e.lho + 30).arrayBuffer());
      const nlen = lh.getUint16(26, true), elen = lh.getUint16(28, true);
      e.dataStart = e.lho + 30 + nlen + elen;
    }
    return this.file.slice(e.dataStart, e.dataStart + e.usize);
  }
  async bytes(name) { return new Uint8Array(await (await this.blob(name)).arrayBuffer()); }
  async slice(name, off, len) {
    const b = await this.blob(name);
    return new Uint8Array(await b.slice(off, off + len).arrayBuffer());
  }
}
