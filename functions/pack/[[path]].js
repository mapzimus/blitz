// Cloudflare Pages Function: serves the player's archive from a private R2 bucket with HTTP ranges.
// Bind the bucket as PACK (wrangler.toml or Pages settings). Put Cloudflare Access in front of the
// whole site so only the allowed login can reach this path.
export async function onRequest({ request, env, params }) {
  if (!env.PACK) return new Response('no bucket bound', { status: 503 });
  const key = (params.path || []).join('/');
  if (!key || key.includes('..')) return new Response('bad key', { status: 400 });
  const head = await env.PACK.head(key);
  if (!head) return new Response('not found', { status: 404 });
  const size = head.size;
  const common = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'Content-Type': 'application/octet-stream' };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...common, 'Content-Length': String(size) } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (m) {
    const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    const end = m[1] !== '' && m[2] !== '' ? Math.min(size - 1, Number(m[2])) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const obj = await env.PACK.get(key, { range: { offset: start, length: end - start + 1 } });
    return new Response(obj.body, { status: 206, headers: { ...common, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
  }
  const obj = await env.PACK.get(key);
  return new Response(obj.body, { status: 200, headers: { ...common, 'Content-Length': String(size) } });
}
