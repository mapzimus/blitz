// TS2 PAD file (pad/data/levelNN.raw): AI waypoint graph plus "extra" nodes (spawns, pickups, cameras).
// Header: u32 id, u32 nodeCount, u32 linkCount. Node 32 bytes. Link 20 bytes. Then u32 extraCount + nodes.
import { Bin } from './bin.js';

export function parsePad(bytes) {
  const b = Bin.of(bytes);
  const id = b.u32(), nNodes = b.u32(), nLinks = b.u32();
  const node = () => {
    const nd = { id: b.u32(), a: b.u32(), link: b.u32(), pos: [b.f32(), b.f32(), b.f32()] };
    nd.c = b.u32();
    nd.type = b.u32();
    return nd;
  };
  const nodes = [];
  for (let i = 0; i < nNodes && b.pos + 32 <= b.length; i++) nodes.push(node());
  const links = [];
  for (let i = 0; i < nLinks && b.pos + 20 <= b.length; i++) {
    links.push({ flags: b.u32(), from: b.u32(), to: b.u32(), a: b.u32(), b: b.u32() });
  }
  const extra = [];
  if (b.pos + 4 <= b.length) {
    const nx = b.u32();
    for (let i = 0; i < nx && b.pos + 32 <= b.length; i++) extra.push(node());
  }
  return { id, nodes, links, extra };
}
