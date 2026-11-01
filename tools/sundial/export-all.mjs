// Export every decodable asset on the disc into open formats.
//   node tools/sundial/export-all.mjs <disc folder> <out folder> [--no-music] [--only <pak name substring>]
// Writes, per archive: textures/*.png, models/*.glb (textured, parts as nodes), levels/*.glb (sections as nodes),
// pads/*.json (nav graphs), anims/*.json (bone tracks), sounds/*.wav. Plus text/*.json (all languages) and
// music/*.opus (via ffmpeg). Needs node_modules/three only for nothing: this file is pure Node.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { Pak } from '../../src/sundial/pak.js';
import { decodeTexture } from '../../src/sundial/texture.js';
import { parseModel } from '../../src/sundial/model.js';
import { parseMap } from '../../src/sundial/map.js';
import { parsePad } from '../../src/sundial/pad.js';
import { parseAnim } from '../../src/sundial/anim.js';
import { decodeVag } from '../../src/sundial/vag.js';
import { texPath } from '../../src/sundial/pak.js';

const [disc, out] = process.argv.slice(2);
if (!disc || !out) { console.error('usage: export-all.mjs <disc> <out>'); process.exit(1); }
const NO_MUSIC = process.argv.includes('--no-music');
const MUSIC_ONLY = process.argv.includes('--music-only');
const FFMPEG = process.argv.includes('--ffmpeg') ? process.argv[process.argv.indexOf('--ffmpeg') + 1] : 'ffmpeg';
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const load = p => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const ensure = d => { mkdirSync(d, { recursive: true }); return d; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- PNG ----------
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- WAV ----------
function wav(samples, rate, channels = 1) {
  const n = samples.length; const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * channels * 2, 28); buf.writeUInt16LE(channels * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

// ---------- glTF ----------
class Glb {
  constructor() { this.json = { asset: { version: '2.0', generator: 'sundial export' }, scenes: [{ nodes: [] }], scene: 0, nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }, { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] }; this.parts = []; this.len = 0; this.texCache = new Map(); }
  view(buf, target) { while (this.len % 4) { this.parts.push(Buffer.alloc(1)); this.len++; } const v = { buffer: 0, byteOffset: this.len, byteLength: buf.length }; if (target) v.target = target; this.parts.push(buf); this.len += buf.length; this.json.bufferViews.push(v); return this.json.bufferViews.length - 1; }
  accessor(arr, type, comp, count, target, minmax) { const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const a = { bufferView: this.view(buf, target), componentType: comp, count, type }; if (minmax) { a.min = minmax[0]; a.max = minmax[1]; } this.json.accessors.push(a); return this.json.accessors.length - 1; }
  image(key, pngBuf) { if (this.texCache.has(key)) return this.texCache.get(key); const bv = this.view(pngBuf); this.json.images.push({ bufferView: bv, mimeType: 'image/png' }); const idx = this.json.images.length - 1; this.texCache.set(key, idx); return idx; }
  material(name, imageIdx, wrapRepeat, blend, hasAlpha) {
    const m = { name, doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 }, alphaMode: blend ? 'BLEND' : hasAlpha ? 'MASK' : 'OPAQUE' };
    if (hasAlpha && !blend) m.alphaCutoff = 0.3;
    if (imageIdx !== null) { this.json.textures.push({ source: imageIdx, sampler: wrapRepeat ? 0 : 1 }); m.pbrMetallicRoughness.baseColorTexture = { index: this.json.textures.length - 1 }; }
    this.json.materials.push(m); return this.json.materials.length - 1;
  }
  mesh(name, stream, matIndexFor, extras) {
    const n = stream.count;
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = stream.positions[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    const pos = this.accessor(stream.positions, 'VEC3', 5126, n, 34962, [mn, mx]);
    const uv = this.accessor(stream.uvs, 'VEC2', 5126, n, 34962);
    let col = null;
    if (stream.colors) { const c = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) c[i] = Math.min(1, stream.colors[i] * 2 / 255); col = this.accessor(c, 'VEC4', 5126, n, 34962); }
    let nrm = null;
    if (stream.normals) nrm = this.accessor(stream.normals, 'VEC3', 5126, n, 34962);
    const prims = [];
    for (const g of stream.groups) {
      const idx = stream.index.slice(g.start, g.start + g.count);
      const comp = idx instanceof Uint32Array ? 5125 : 5123;
      const ia = this.accessor(idx, 'SCALAR', comp, idx.length, 34963);
      const attributes = { POSITION: pos, TEXCOORD_0: uv }; if (col !== null) attributes.COLOR_0 = col; if (nrm !== null) attributes.NORMAL = nrm;
      prims.push({ attributes, indices: ia, material: matIndexFor(g.mat), mode: 4 });
    }
    this.json.meshes.push({ name, primitives: prims, extras }); return this.json.meshes.length - 1;
  }
  node(name, mesh, extras, parent) { const nd = { name }; if (mesh !== null && mesh !== undefined) nd.mesh = mesh; if (extras) nd.extras = extras; this.json.nodes.push(nd); const i = this.json.nodes.length - 1; if (parent === undefined) this.json.scenes[0].nodes.push(i); else (this.json.nodes[parent].children ||= []).push(i); return i; }
  write(path) {
    this.json.buffers[0].byteLength = this.len;
    const bin = Buffer.concat(this.parts); const binPad = Buffer.alloc((4 - bin.length % 4) % 4);
    let js = Buffer.from(JSON.stringify(this.json)); const jsPad = Buffer.alloc((4 - js.length % 4) % 4, 0x20);
    const total = 12 + 8 + js.length + jsPad.length + 8 + bin.length + binPad.length;
    const h = Buffer.alloc(12); h.write('glTF', 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length + jsPad.length, 0); jh.write('JSON', 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length + binPad.length, 0); bh.write('BIN\0', 4);
    writeFileSync(path, Buffer.concat([h, jh, js, jsPad, bh, bin, binPad]));
  }
}

// Texture lookup for one archive: material -> {png, hasAlpha}
function texFor(pak, mat, embedded, cache) {
  const key = mat.id;
  if (cache.has(key)) return cache.get(key);
  let r = null;
  try { const dec = embedded && embedded.get(mat.id) || decodeTexture(pak.get(texPath(mat.id))); r = { png: png(dec.width, dec.height, dec.data), hasAlpha: dec.hasAlpha }; } catch (e) { r = null; }
  cache.set(key, r); return r;
}
function buildModelGlb(pak, model, name, texCache) {
  const g = new Glb();
  const matIdx = new Map();
  const matFor = mi => {
    if (matIdx.has(mi)) return matIdx.get(mi);
    const m = model.materials[mi] || { id: -1, wrapX: 0, wrapY: 0, flags: 0 };
    const t = texFor(pak, m, model.embedded, texCache);
    const idx = g.material(`mat${mi}_${m.id}`, t ? g.image(m.id, t.png) : null, m.wrapX === 0, false, !!(t && t.hasAlpha));
    matIdx.set(mi, idx); return idx;
  };
  const root = g.node(name, null, { scale: model.scale });
  model.parts.forEach((part, pi) => {
    const info = model.infos[pi];
    const pn = g.node(`part${pi}`, null, { isBone: info.isBone, parent: info.parent, child: info.child, unk2: info.unk2, unk4: info.unk4, unk5: info.unk5 }, root);
    part.forEach((st, si) => { if (!st || !st.groups.length) return; const mi = g.mesh(`part${pi}_s${si}`, st, matFor, { stream: si }); g.node(`part${pi}_s${si}`, mi, null, pn); });
  });
  return g;
}
function buildMapGlb(pak, map, name, texCache) {
  const g = new Glb();
  const matIdx = new Map();
  const matFor = mi => {
    if (matIdx.has(mi)) return matIdx.get(mi);
    const m = map.materials[mi] || { id: -1, wrapX: 0, wrapY: 0, flags: 0 };
    const t = texFor(pak, m, null, texCache);
    const idx = g.material(`mat${mi}_${m.id}`, t ? g.image(m.id, t.png) : null, m.wrapX === 0, false, !!(t && t.hasAlpha));
    matIdx.set(mi, idx); return idx;
  };
  const root = g.node(name, null, { portals: map.portals, doors: map.doors });
  for (const sec of map.sections) {
    const sn = g.node(`section${sec.id}`, null, null, root);
    sec.streams.forEach((st, si) => { if (!st || !st.groups.length) return; const mi = g.mesh(`section${sec.id}_s${si}`, st, matFor, { stream: si, blend: si >= 1 }); if (si >= 1) g.json.meshes[mi].primitives.forEach(p => (g.json.materials[p.material].alphaMode = 'BLEND')); g.node(`section${sec.id}_s${si}`, mi, null, sn); });
  }
  return g;
}

// ---------- per archive ----------
function exportPak(path, outDir) {
  const name = basename(path).replace(/\.pak$/i, '').toLowerCase();
  const pak = new Pak(load(path), name);
  const dir = ensure(join(outDir, name));
  const texCache = new Map();
  let nTex = 0, nMod = 0, nMap = 0, nPad = 0, nAnim = 0, nSnd = 0, nOther = 0;
  const manifest = [];
  for (const p of [...pak.entries.keys()].sort()) {
    const bytes = pak.get(p);
    const safe = p.replace(/[\\/]/g, '__');
    try {
      if (p.startsWith('textures/') && p.endsWith('.raw')) {
        const d = decodeTexture(bytes); writeFileSync(join(ensure(join(dir, 'textures')), safe.replace(/\.raw$/, '.png')), png(d.width, d.height, d.data)); nTex++;
      } else if (p.startsWith('bg/') && p.endsWith('.raw') && !p.includes('ambient')) {
        const map = parseMap(bytes); buildMapGlb(pak, map, p, texCache).write(join(ensure(join(dir, 'levels')), safe.replace(/\.raw$/, '.glb'))); nMap++;
      } else if (p.startsWith('ob/') && p.endsWith('.raw')) {
        const m = parseModel(bytes); buildModelGlb(pak, m, p, texCache).write(join(ensure(join(dir, 'models')), safe.replace(/\.raw$/, '.glb'))); nMod++;
      } else if (p.startsWith('pad/') && p.endsWith('.raw')) {
        writeFileSync(join(ensure(join(dir, 'pads')), safe.replace(/\.raw$/, '.json')), JSON.stringify(parsePad(bytes))); nPad++;
      } else if (p.startsWith('anim/') && p.endsWith('.raw')) {
        if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'ANR1') {
          const a = parseAnim(bytes); writeFileSync(join(ensure(join(dir, 'anims')), safe.replace(/\.raw$/, '.json')), JSON.stringify({ total: a.total, keys: Array.from(a.keys), bones: a.bones })); nAnim++;
        } else {
          // cutscene props and characters are plain models filed under anim/
          const m = parseModel(bytes); buildModelGlb(pak, m, p, texCache).write(join(ensure(join(dir, 'models')), safe.replace(/\.raw$/, '.glb'))); nMod++;
        }
      } else if (p.endsWith('.vag')) {
        const { rate, samples } = decodeVag(bytes); writeFileSync(join(ensure(join(dir, 'sounds')), safe.replace(/\.vag$/, '.wav')), wav(samples, rate)); nSnd++;
      } else if (p.endsWith('.str')) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const n = dv.getUint32(0, true) / 4; const strs = []; const dec = new TextDecoder('latin1');
        for (let i = 0; i < n; i++) { const o = dv.getUint32(i * 4, true); let e = o; while (e < bytes.length && bytes[e]) e++; strs.push(dec.decode(bytes.subarray(o, e))); }
        writeFileSync(join(ensure(join(dir, 'text')), safe.replace(/\.str$/, '.json')), JSON.stringify(strs, null, 0)); nOther++;
      } else {
        writeFileSync(join(ensure(join(dir, 'other')), safe), bytes); nOther++;
      }
      manifest.push(p);
    } catch (e) { manifest.push(`${p}  FAILED: ${e.message}`); try { writeFileSync(join(ensure(join(dir, 'failed')), safe), bytes); } catch (e2) { /* ignore */ } }
  }
  writeFileSync(join(dir, 'manifest.txt'), manifest.join('\n'));
  log(`${name}: ${nTex} textures, ${nMod} models, ${nMap} levels, ${nPad} pads, ${nAnim} anims, ${nSnd} sounds, ${nOther} other`);
}

// ---------- music ----------
function exportMusic(outDir) {
  const dir = ensure(join(outDir, 'music'));
  const F = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];
  const ff = spawnSync(FFMPEG, ['-version']); if (ff.status !== 0) { log('ffmpeg not found; skipping music'); return; }
  for (const sub of ['MUSIC0', 'MUSIC1', 'MUSIC2']) {
    const d = join(disc, 'MUSIC', sub); if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter(f => /\.mib$/i.test(f)).sort()) {
      const outFile = join(dir, f.replace(/\.mib$/i, '.opus')); if (existsSync(outFile)) continue;
      const bytes = new Uint8Array(readFileSync(join(d, f)));
      // stride: first silent block after sound, must divide the file into whole chunk pairs
      const zero = p => { for (let i = 2; i < 16; i++) if (bytes[p + i]) return false; return true; };
      let sounded = false; const cands = [];
      for (let p = 0; p < Math.min(bytes.length, 1 << 20); p += 16) { const z = zero(p); if (sounded && z) { cands.push(p); sounded = false; } if (!z) sounded = true; }
      let IL = [...cands, 0x6f80, 0x6740].find(c => c > 0 && bytes.length % (c * 2) === 0) || cands[0] || 0x6740;
      const frames = Math.floor(bytes.length / (IL * 2)) * (IL / 16) * 28;
      const pcm = Buffer.alloc(frames * 4); let fi = 0;
      const st = [{ s1: 0, s2: 0 }, { s1: 0, s2: 0 }];
      for (let pos = 0; pos + IL * 2 <= bytes.length; pos += IL * 2) {
        const chunkFrames = (IL / 16) * 28; const l = new Int16Array(chunkFrames), r = new Int16Array(chunkFrames);
        for (let ch = 0; ch < 2; ch++) { const o = ch === 0 ? l : r; const s = st[ch]; let n = 0; for (let b = 0; b < IL / 16; b++) { const p = pos + ch * IL + b * 16; const shift = bytes[p] & 15, fl = Math.min(4, bytes[p] >> 4); for (let i = 0; i < 28; i++) { const by = bytes[p + 2 + (i >> 1)]; let nib = (i & 1) ? (by >> 4) : (by & 15); if (nib > 7) nib -= 16; let v = (nib << 12) >> shift; v += (s.s1 * F[fl][0] + s.s2 * F[fl][1] + 32) >> 6; v = Math.max(-32768, Math.min(32767, v)); s.s2 = s.s1; s.s1 = v; o[n++] = v; } } }
        for (let i = 0; i < chunkFrames; i++) { pcm.writeInt16LE(l[i], fi * 4); pcm.writeInt16LE(r[i], fi * 4 + 2); fi++; }
      }
      const res = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '128k', outFile], { input: pcm.subarray(0, fi * 4), maxBuffer: 1 << 30 });
      log(`music ${f} stride ${IL.toString(16)} -> ${basename(outFile)} ${res.status === 0 ? 'ok' : 'FAILED ' + res.stderr}`);
    }
  }
}

// ---------- run ----------
const pakDir = join(disc, 'PAK');
const paks = [];
for (const f of readdirSync(pakDir)) { const p = join(pakDir, f); if (statSync(p).isDirectory()) { for (const g of readdirSync(p)) if (/\.pak$/i.test(g)) paks.push(join(p, g)); } else if (/\.pak$/i.test(f)) paks.push(p); }
if (!MUSIC_ONLY) for (const p of paks.sort()) { if (ONLY && !basename(p).toLowerCase().includes(ONLY.toLowerCase())) continue; exportPak(p, out); }
if (!NO_MUSIC && (MUSIC_ONLY || !ONLY)) exportMusic(out);
log('done');
