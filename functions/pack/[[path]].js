// Cloudflare Pages Function: serves the player's archive from a private R2 bucket with HTTP ranges.
// Bind the bucket as PACK (wrangler.toml or Pages settings). Put Cloudflare Access in front of the
// whole site so only the allowed login can reach this path.
//
// Under recomp/ it also hosts a recompiled game (never in the public repo):
// - pages need cross-origin isolation for SharedArrayBuffer, so those responses carry COOP/COEP
// - <file>.gz is served as <file> with Content-Encoding: gzip
// - a disc too big for one upload lives as <key>.part000.. with a <key>.manifest JSON
//   ({ size, partSize, parts }) and is stitched back together here for range reads
const manifests = new Map();   // disc manifests, kept for this worker's lifetime: disc reads come in the thousands
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', wasm: 'application/wasm', json: 'application/json' };

function headersFor(key) {
  const h = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'Content-Type': 'application/octet-stream' };
  if (key.startsWith('recomp/')) {
    h['Content-Type'] = TYPES[key.split('.').pop()] || 'application/octet-stream';
    h['Cross-Origin-Opener-Policy'] = 'same-origin';
    h['Cross-Origin-Embedder-Policy'] = 'require-corp';
    h['Cross-Origin-Resource-Policy'] = 'same-origin';
    h['X-Robots-Tag'] = 'noindex';
    if (!key.endsWith('.iso')) h['Cache-Control'] = 'private, no-cache';
  }
  return h;
}

function parseRange(request, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!m) return null;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] !== '' && m[2] !== '' ? Math.min(size - 1, Number(m[2])) : size - 1;
  return { start, end };
}

async function servePartitioned(request, env, key, manifest) {
  const { size, partSize } = manifest;
  const common = { ...headersFor(key), 'Content-Length': String(size) };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: common });
  const r = parseRange(request, size) || { start: 0, end: size - 1 };
  if (r.start > r.end || r.start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const partName = i => `${key}.part${String(i).padStart(3, '0')}`;
  const first = Math.floor(r.start / partSize), last = Math.floor(r.end / partSize);
  const headers = { ...common, 'Content-Range': `bytes ${r.start}-${r.end}/${size}`, 'Content-Length': String(r.end - r.start + 1) };
  const read = i => {
    const base = i * partSize, from = Math.max(r.start, base), to = Math.min(r.end, base + partSize - 1);
    return env.PACK.get(partName(i), { range: { offset: from - base, length: to - from + 1 } });
  };
  if (first === last) return new Response((await read(first)).body, { status: 206, headers });
  // A read that crosses a part boundary: pass the pieces through one after the other.
  const { readable, writable } = new FixedLengthStream(r.end - r.start + 1);
  (async () => {
    const w = writable.getWriter();
    for (let i = first; i <= last; i++) {
      const o = await read(i); const rd = o.body.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; await w.write(value); }
    }
    await w.close();
  })().catch(() => writable.abort());
  return new Response(readable, { status: 206, headers });
}

export async function onRequest({ request, env, params }) {
  if (!env.PACK) return new Response('no bucket bound', { status: 503 });
  const key = (params.path || []).join('/');
  if (!key || key.includes('..')) return new Response('bad key', { status: 400 });
  if (key.startsWith('recomp/')) {
    if (key.endsWith('.iso')) {
      if (!manifests.has(key)) { const man = await env.PACK.get(key + '.manifest'); if (man) manifests.set(key, await man.json()); }
      if (manifests.has(key)) return servePartitioned(request, env, key, manifests.get(key));
    } else {
      const gz = await env.PACK.get(key + '.gz');
      if (gz) return new Response(gz.body, { status: 200, encodeBody: 'manual', headers: { ...headersFor(key), 'Content-Encoding': 'gzip', 'Content-Length': String(gz.size), Vary: 'Accept-Encoding' } });
    }
  }
  const head = await env.PACK.head(key);
  if (!head) return new Response('not found', { status: 404 });
  const size = head.size;
  const common = headersFor(key);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...common, 'Content-Length': String(size) } });
  const r = parseRange(request, size);
  if (r) {
    if (r.start > r.end || r.start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const obj = await env.PACK.get(key, { range: { offset: r.start, length: r.end - r.start + 1 } });
    return new Response(obj.body, { status: 206, headers: { ...common, 'Content-Range': `bytes ${r.start}-${r.end}/${size}`, 'Content-Length': String(r.end - r.start + 1) } });
  }
  const obj = await env.PACK.get(key);
  return new Response(obj.body, { status: 200, headers: { ...common, 'Content-Length': String(size) } });
}
