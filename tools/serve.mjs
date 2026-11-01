// Dev server with caching disabled, so edited modules always reload. Usage: node tools/serve.mjs [port]
// Loopback only: rejects foreign Host headers (DNS rebinding), dotfiles, backslashes, and traversal.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const port = +process.argv[2] || 8778;
// optional second arg: a different folder to serve (e.g. the disc's DATA folder for local testing)
const root = path.resolve(process.argv[3] || new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const BACKSLASH = String.fromCharCode(92);
http.createServer((req, res) => {
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { res.writeHead(403); return res.end(); }
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p.includes(BACKSLASH) || p.split('/').some(seg => seg.startsWith('.'))) { res.writeHead(403); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.resolve(root, '.' + p);
  const rel = path.relative(root, f);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); return res.end(); }
  if (req.method === 'HEAD') { return fs.stat(f, (err, st) => { if (err || !st.isFile()) { res.writeHead(404); return res.end(); } const origin = String(req.headers.origin || ''); const h = { 'Content-Length': st.size, 'Accept-Ranges': 'bytes' }; if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges'; } res.writeHead(200, h); res.end(); }); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = types[path.extname(f).toLowerCase()] || 'application/octet-stream';
    const head = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    // allow other loopback dev ports (the game on 8778 reading the disc data served on 8779)
    const origin = String(req.headers.origin || '');
    if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) { head['Access-Control-Allow-Origin'] = origin; head['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges'; head['Vary'] = 'Origin'; }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      let a = range[1] === '' ? Math.max(0, st.size - +range[2]) : +range[1];
      let b = range[1] !== '' && range[2] !== '' ? Math.min(st.size - 1, +range[2]) : st.size - 1;
      if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
      return fs.createReadStream(f, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    fs.createReadStream(f).pipe(res);
  });
}).listen(port, '127.0.0.1', () => console.log('serving', root, 'on http://127.0.0.1:' + port));
