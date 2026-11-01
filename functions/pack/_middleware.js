// Fail-closed guard for the archive route (runs for everything under /pack/ because it lives in that
// folder, on the same routing decision as the handler): served only to a request carrying a valid
// Cloudflare Access JWT for this application and the allowed email. Static pages are left alone
// (Access gates them at the edge); this is defense in depth for the copyrighted data.
// Env (Pages settings): ACCESS_TEAM_DOMAIN (e.g. myteam.cloudflareaccess.com), ACCESS_AUD, ALLOWED_EMAIL.
const certCache = { keys: null, at: 0 };

async function jwks(team) {
  if (certCache.keys && Date.now() - certCache.at < 3600e3) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs');
  const { keys } = await r.json();
  certCache.keys = keys; certCache.at = Date.now();
  return keys;
}
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));

async function verify(token, env) {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  const keys = await jwks(env.ACCESS_TEAM_DOMAIN);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  return payload;
}

export async function onRequest(ctx) {
  const { env } = ctx;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ALLOWED_EMAIL) return new Response('archive locked: Access not configured', { status: 403 });
  const token = ctx.request.headers.get('Cf-Access-Jwt-Assertion') || (ctx.request.headers.get('cookie') || '').match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) return new Response('login required', { status: 401 });
  let claims = null;
  try { claims = await verify(token, env); } catch (e) { claims = null; }
  if (!claims || String(claims.email || '').toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return new Response('forbidden', { status: 403 });
  return ctx.next();
}
