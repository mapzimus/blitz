// Dev server with caching disabled, so edited modules always reload. Usage: node tools/serve.mjs [port]
// Loopback only: rejects foreign Host headers (DNS rebinding), dotfiles, backslashes, and traversal.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const port = +process.argv[2] || 8778;
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
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('serving', root, 'on http://127.0.0.1:' + port));
