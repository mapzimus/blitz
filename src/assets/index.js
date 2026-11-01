// The asset service. Opens the player's own BASSETS.ZIP (from the PS2 disc), remembers the file
// handle in IndexedDB so later visits don't need the picker, and decodes on demand with caching.
import { StoredZip } from './zip.js';
import { decodeTxd } from './txd.js';
import { readSoundTable, decodeMss, toAudioBuffer } from './audio.js';
import { parseRoster, parsePlaybook } from './tables.js';
import { readDff } from './dff.js';
import { Bank } from './ban.js';

const DB = 'blitz-assets', STORE = 'kv';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
async function kvSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }

export class Assets {
  constructor() { this.zip = null; this.ready = false; this.texCache = new Map(); this.sndCache = new Map(); this.sndTable = null; this.roster = null; this.playbooks = new Map(); this.modelCache = new Map(); this.bankCache = new Map(); this.texIndex = null; }

  // Try to reopen the archive from a remembered handle. Returns true if assets are available.
  async restore() {
    try {
      const h = await kvGet('bassets-handle');
      if (!h) return false;
      let perm = await h.queryPermission({ mode: 'read' });
      if (perm !== 'granted') perm = await h.requestPermission({ mode: 'read' });
      if (perm !== 'granted') return false;
      await this.openFile(await h.getFile());
      return true;
    } catch (e) { console.warn('assets restore', e); return false; }
  }

  // Ask the player for BASSETS.ZIP (or the whole ISO; we find the zip inside it).
  async pick() {
    if (window.showOpenFilePicker) {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'Blitz 2002 disc data', accept: { 'application/octet-stream': ['.zip', '.ZIP', '.iso', '.ISO'] } }] });
      await this.openFile(await h.getFile());
      try { await kvSet('bassets-handle', h); } catch (e) { /* non-persistable */ }
      return true;
    }
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.zip,.iso';
      inp.onchange = async () => { if (inp.files[0]) { await this.openFile(inp.files[0]); res(true); } else res(false); };
      inp.click();
    });
  }

  // Dev path: open the archive over HTTP with Range requests (no upload; same-machine server).
  async openUrl(url) {
    const head = await fetch(url, { method: 'HEAD' });
    const size = +head.headers.get('content-length');
    if (!size || head.headers.get('accept-ranges') !== 'bytes') throw new Error('server lacks range support');
    const blob = new HttpBlob(url, size, url.split('/').pop());
    this.zip = await StoredZip.open(blob);
    if (!this.zip.has('roster.rst')) throw new Error('not BASSETS.ZIP');
    this.roster = parseRoster(await this.zip.bytes('roster.rst'));
    this.ready = true;
  }

  async openFile(file) {
    let blob = file;
    if (/\.iso$/i.test(file.name)) blob = await findZipInIso(file);
    this.zip = await StoredZip.open(blob);
    if (!this.zip.has('roster.rst')) throw new Error('That archive is not BASSETS.ZIP from NFL Blitz 2002');
    this.roster = parseRoster(await this.zip.bytes('roster.rst'));
    this.ready = true;
  }

  async textures(file) {
    const key = file.toLowerCase();
    if (!this.texCache.has(key)) {
      const list = decodeTxd(await this.zip.bytes(file));
      const m = new Map(); for (const t of list) m.set(t.name.toLowerCase(), t);
      this.texCache.set(key, m);
    }
    return this.texCache.get(key);
  }
  async texture(file, name) { const m = await this.textures(file); return name ? m.get(name.toLowerCase()) : m.values().next().value; }

  async soundTable() {
    if (!this.sndTable) this.sndTable = readSoundTable(await this.zip.slice('mslasset.ms2', 0, 0x2b000));
    return this.sndTable;
  }
  async sound(ctx, name) {
    const key = name.toLowerCase().endsWith('.mss') ? name.toLowerCase() : name.toLowerCase() + '.mss';
    if (this.sndCache.has(key)) return this.sndCache.get(key);
    const t = await this.soundTable(); const e = t.get(key);
    if (!e) return null;
    const buf = toAudioBuffer(ctx, decodeMss(await this.zip.slice('mslasset.ms2', e.off, e.size)));
    this.sndCache.set(key, buf);
    return buf;
  }
  async soundNames(prefix) { const t = await this.soundTable(); return [...t.keys()].filter(k => k.startsWith(prefix.toLowerCase()) && k.endsWith('.mss')); }

  async model(file) {
    const key = file.toLowerCase();
    if (!this.modelCache.has(key)) this.modelCache.set(key, readDff(await this.zip.bytes(file)));
    return this.modelCache.get(key);
  }
  async bank(file) {
    const key = file.toLowerCase();
    if (!this.bankCache.has(key)) this.bankCache.set(key, new Bank(await this.zip.bytes(file)));
    return this.bankCache.get(key);
  }
  // Texture by name. Fast path by naming convention; otherwise scan dictionaries that share a prefix.
  async findTexture(name, hints = []) {
    const n = name.toLowerCase();
    const candidates = [...hints];
    const m = /^([a-z]{2})ih(unih|unia|logh|loga|helm|fnth|herd)$/.exec(n);
    if (m) candidates.push(`${m[1]}_p_${m[2] === 'unia' || m[2] === 'loga' ? 'a' : 'h'}.rtd`, 'teams1.rtd', 'teams2.rtd', 'teams3.rtd', 'teams4.rtd');
    if (/^plih/.test(n)) candidates.push('skin.rtd');
    if (/^eq|^equipment$/.test(n)) candidates.push('equip.rtd');
    if (/^fl(sid|num|gra|yel|lin)/.test(n)) candidates.push('fl_fnmaf.rtd');
    if (/^ball/.test(n)) candidates.push('ball.rtd');
    const ob = /^([a-z]{2})objs?_?(\d+)$/.exec(n);
    if (ob) candidates.push(`${ob[1]}_snmAF.rtd`, `${ob[1]}_snmDU.rtd`, `${ob[1]}_snmNI.rtd`, `${ob[1]}_snmOV.rtd`);
    for (const c of candidates) {
      if (!this.zip.has(c)) continue;
      const t = await this.texture(c, n);
      if (t) return t;
    }
    return null;
  }

  async playbook(code) {
    if (!this.playbooks.has(code)) this.playbooks.set(code, parsePlaybook(await this.zip.bytes(code + '.rsc')));
    return this.playbooks.get(code);
  }
}

// ISO9660 is awkward to walk; BASSETS.ZIP is stored contiguously, so locate its local header by
// scanning for the zip signature followed by the first entry name, then size it from the EOCD.
async function findZipInIso(file) {
  const CH = 8 << 20;
  const sig = [0x50, 0x4b, 0x03, 0x04];
  let start = -1;
  for (let off = 0; off < file.size && start < 0; off += CH) {
    const a = new Uint8Array(await file.slice(off, Math.min(file.size, off + CH + 64)).arrayBuffer());
    for (let i = 0; i + 40 < a.length; i++) {
      if (a[i] === sig[0] && a[i + 1] === sig[1] && a[i + 2] === sig[2] && a[i + 3] === sig[3]) {
        const nlen = a[i + 26] | (a[i + 27] << 8);
        const nm = new TextDecoder('latin1').decode(a.subarray(i + 30, i + 30 + nlen));
        if (/\.(asd|rtd|dff|rsc)$/i.test(nm)) { start = off + i; break; }
      }
    }
  }
  if (start < 0) throw new Error('BASSETS.ZIP not found inside this ISO');
  // find EOCD after start
  let end = -1;
  for (let off = start; off < file.size && end < 0; off += CH) {
    const a = new Uint8Array(await file.slice(off, Math.min(file.size, off + CH + 64)).arrayBuffer());
    for (let i = 0; i + 22 <= a.length; i++) if (a[i] === 0x50 && a[i + 1] === 0x4b && a[i + 2] === 0x05 && a[i + 3] === 0x06) { const clen = a[i + 20] | (a[i + 21] << 8); end = off + i + 22 + clen; break; }
  }
  if (end < 0) throw new Error('zip end record not found in ISO');
  return file.slice(start, end);
}

// Blob-like over HTTP byte ranges.
class HttpBlob {
  constructor(url, size, name, start = 0) { this.url = url; this.size = size; this.name = name; this.start = start; }
  slice(a, b) { return new HttpBlob(this.url, Math.max(0, Math.min(this.size, b) - a), this.name, this.start + a); }
  async arrayBuffer() {
    if (this.size === 0) return new ArrayBuffer(0);
    const r = await fetch(this.url, { headers: { Range: `bytes=${this.start}-${this.start + this.size - 1}` } });
    if (r.status !== 206) throw new Error('range request failed ' + r.status);
    return r.arrayBuffer();
  }
}

export const assets = new Assets();
