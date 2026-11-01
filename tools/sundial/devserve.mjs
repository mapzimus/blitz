// Dev server: serves the repo at / and a local disc copy at /disc/ (with CORS), so the
// sundial page can be opened as  /games/sundial/?src=/disc/PAK/  without the folder picker.
//   node tools/sundial/devserve.mjs <disc folder> [port]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname, normalize, resolve, relative, isAbsolute } from 'node:path';

const disc = resolve(process.argv[2] || 'C:/disc');
const port = Number(process.argv[3] || 8766);
const repo = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.pak': 'application/octet-stream' };

createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  let root = repo;
  if (url.startsWith('/disc/')) { root = disc; url = url.slice(5); }
  let p = normalize(join(root, url));
  const rel = relative(root, p);
  if (rel.startsWith('..') || isAbsolute(rel) || /(^|[\\/])\./.test(rel)) { res.writeHead(403); return res.end(); }
  try {
    let st = statSync(p);
    if (st.isDirectory()) { p = join(p, 'index.html'); st = statSync(p); }
    res.writeHead(200, { 'Content-Type': MIME[extname(p).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    createReadStream(p).pipe(res);
  } catch (e) { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`repo ${repo} on http://localhost:${port}/  disc ${disc} at /disc/ (loopback only)`));
