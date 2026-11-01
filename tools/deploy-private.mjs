// Deploy the committed tree (and nothing else from disk) to the private Cloudflare Pages project.
// Usage: node tools/deploy-private.mjs [project-name]
import { execSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const project = process.argv[2] || 'backroom';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backroom-deploy-'));
const zip = path.join(tmp, 'tree.zip');
execSync(`git archive --format=zip -o "${zip}" HEAD`, { cwd: root, stdio: 'inherit' });
const out = path.join(tmp, 'site'); fs.mkdirSync(out);
if (process.platform === 'win32') execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}'"`, { stdio: 'inherit' });
else execSync(`unzip -q "${zip}" -d "${out}"`, { stdio: 'inherit' });
for (const junk of ['tools', 'docs', '.gitignore']) fs.rmSync(path.join(out, junk), { recursive: true, force: true });
console.log('deploying committed tree from', out);
execSync(`npx wrangler pages deploy "${out}" --project-name ${project} --commit-dirty=true`, { cwd: out, stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
