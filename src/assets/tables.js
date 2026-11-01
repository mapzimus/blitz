// roster.rst and <team>.rsc (playbook) parsers.
const dec = new TextDecoder('latin1');
const cstr = (b, o, n) => dec.decode(b.subarray(o, o + n)).split('\0')[0];

// Position codes seen in roster.rst (one of each per 18-man roster).
export const POS = ['RB', 'RB', 'QB', 'WR', 'OL', 'OL', 'OL', 'WR', 'K', 'P', 'LB', 'S', 'S', 'CB', 'DE', 'DT', 'DE', 'CB'];

export function parseRoster(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const teams = []; let p = 0;
  while (p + 4 <= b.length) {
    const n = dv.getUint32(p, true); p += 4;
    if (n === 0 || n > 80) break;
    const pl = [];
    for (let i = 0; i < n; i++) {
      pl.push({
        first: cstr(b, p, 32), last: cstr(b, p + 32, 32), num: b[p + 64], height: b[p + 65], weight: dv.getUint16(p + 66, true),
        team: dv.getUint32(p + 68, true), posCode: dv.getUint32(p + 72, true), pos: POS[dv.getUint32(p + 72, true)] || '?',
        body: dv.getUint32(p + 76, true), ratings: Array.from(b.subarray(p + 84, p + 98)),
      });
      p += 100;
    }
    teams.push(pl);
  }
  return teams;
}

// Playbook: formation groups (name + list of play ids) followed by play records (12-byte name x2 + id ...).
export function parsePlaybook(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const groups = []; let p = 0x18;
  for (;;) {
    const name = cstr(b, p, 24);
    const a = dv.getUint32(p + 24, true), n = dv.getUint32(p + 28, true);
    if (n > 64 || !/^[\w .\-]*$/.test(name)) break;
    const ids = []; for (let i = 0; i < n; i++) ids.push(dv.getUint32(p + 32 + i * 4, true));
    groups.push({ name, kind: a, ids }); p += 32 + 4 * n;
  }
  const plays = new Map();
  for (let s = p; s + 28 <= b.length; s += 2) {
    if (b[s] < 0x20 || b[s] > 0x7e) continue;
    let same = true; for (let i = 0; i < 12; i++) if (b[s + i] !== b[s + 12 + i]) { same = false; break; }
    if (!same) continue;
    const nm = cstr(b, s, 12); if (nm.length < 2) continue;
    const id = dv.getUint32(s + 24, true);
    if (!plays.has(id)) plays.set(id, { id, name: nm, off: s, flags: dv.getUint32(s + 28, true) });
  }
  for (const g of groups) g.plays = g.ids.map(id => plays.get(id) || { id, name: '?' });
  return { groups, plays };
}
