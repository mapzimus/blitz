// The disc's own UI text table (boss/str*_e.str inside the front-end pack): a u32 offset table
// followed by NUL-terminated strings. Names shown in the game come from here, never from this code.
import { Bin } from './bin.js';

export class TextTable {
  constructor(bytes) {
    this.strs = [];
    if (!bytes) return;
    const b = Bin.of(bytes);
    const first = b.u32at(0), n = Math.floor(first / 4);
    const dec = new TextDecoder('latin1');
    for (let i = 0; i < n; i++) {
      const o = b.u32at(i * 4);
      let e = o; while (e < bytes.length && bytes[e] !== 0) e++;
      this.strs.push(dec.decode(bytes.subarray(o, e)));
    }
  }
  get(id, fallback = '') { return (id != null && this.strs[id]) || fallback; }
  get size() { return this.strs.length; }
}

// Text ids of the arcade arena names by level number (from the arena table), and story titles by era.
export const ARENA_TEXT = { 10: 1678, 11: 1679, 13: 1680, 20: 1681, 21: 1682, 29: 1700, 31: 1684, 32: 1685, 33: 1686, 34: 1687, 35: 1688, 36: 1689, 38: 1690, 39: 1691, 40: 1692, 41: 1693, 42: 1694, 43: 1695, 45: 1697, 46: 1698, 47: 1699, 48: 1700, 50: 1701, 55: 1702, 56: 1703, 64: 1693, 65: 1698 };
export const STORY_TEXT = { 10: 1678, 11: 1679, 20: 2302, 31: 2308, 32: 2309, 34: 2303, 35: 2301, 38: 2305, 39: 2311, 40: 2310, 41: 2304, 45: 1697, 46: 1698, 47: 1699, 48: 2306 };
export const MODE_TEXT = { dm: 1458, elim: 1470, bag: 1454 };
