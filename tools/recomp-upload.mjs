// Uploads a disc image to the private R2 bucket in 64 MiB parts plus a manifest, for functions/pack.
// A single wrangler upload stops at 300 MiB; the pack function stitches the parts back together.
// Usage: node tools/recomp-upload.mjs disc "<game.iso>" recomp/<code>/disc.iso
//        node tools/recomp-upload.mjs file "<local file>" recomp/<code>/<name>
// Never point this at anything public: recompiled game files and discs stay behind the login.
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [mode, src, key] = process.argv.slice(2);
if (!/^(disc|file)$/.test(mode || '') || !src || !/^recomp\/[\w./-]+$/.test(key || '')) { console.error('usage: disc|file <path> recomp/<code>/<name>'); process.exit(1); }
const BUCKET = 'backroom-pack', PART = 64 * 1024 * 1024;
const put = (k, file) => {
  for (let tries = 1; ; tries++) {
    try { execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${k}`, '--file', file, '--remote'], { stdio: 'pipe', shell: process.platform === 'win32' }); console.log('put', k); return; }
    catch (e) { if (tries >= 8) throw e; console.log("retry", k, tries); execFileSync(process.execPath, ["-e", `setTimeout(()=>{},${tries * 5000})`]); }
  }
};
if (mode === 'file') { put(key, src); process.exit(0); }
const size = fs.statSync(src).size, parts = Math.ceil(size / PART);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recomp-'));
const fd = fs.openSync(src, 'r'), buf = Buffer.alloc(PART);
try {
  for (let i = 0; i < parts; i++) {
    const n = fs.readSync(fd, buf, 0, PART, i * PART);
    const f = path.join(tmp, `part${i}`); fs.writeFileSync(f, buf.subarray(0, n));
    put(`${key}.part${String(i).padStart(3, '0')}`, f); fs.rmSync(f);
  }
  const m = path.join(tmp, 'manifest'); fs.writeFileSync(m, JSON.stringify({ size, partSize: PART, parts }));
  put(`${key}.manifest`, m);   // last, so a half-finished upload is never served as a whole disc
} finally { fs.closeSync(fd); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('disc uploaded:', parts, 'parts,', size, 'bytes');
