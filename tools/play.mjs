// One-command local launcher: serves the game and your disc data, opens the browser, no import needed.
// Usage: node tools/play.mjs ["<folder with BASSETS.ZIP>" | "<path to BASSETS.ZIP>"]   (the path is remembered)
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const memo = path.join(os.homedir(), '.blitz-pack-path');
let arg = process.argv[2] || (fs.existsSync(memo) ? fs.readFileSync(memo, 'utf8').trim() : '');
if (!arg) {
  console.error('Tell me where the disc data is, once:');
  console.error('  node tools/play.mjs "C:\\path\\to\\DATA"   (the folder holding BASSETS.ZIP)');
  process.exit(1);
}
let dir = arg, file = 'BASSETS.ZIP';
if (fs.existsSync(arg) && fs.statSync(arg).isFile()) { dir = path.dirname(arg); file = path.basename(arg); }
if (!fs.existsSync(path.join(dir, file))) { console.error('No', file, 'in', dir); process.exit(1); }
fs.writeFileSync(memo, dir);
const node = process.execPath, serve = path.join(here, 'serve.mjs');
const a = spawn(node, [serve, '8778'], { stdio: 'inherit' });
const b = spawn(node, [serve, '8779', dir], { stdio: 'inherit' });
const url = 'http://127.0.0.1:8778/games/kodiak/index.html?pack=' + encodeURIComponent('http://127.0.0.1:8779/' + file);
setTimeout(() => {
  console.log('\nOpen:', url, '\n(Ctrl+C here stops the servers)');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
}, 700);
const stop = () => { a.kill(); b.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
