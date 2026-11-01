#!/usr/bin/env python3
"""Pull the story-mission layout tables out of the PS2 executable.

Each level has a 0xC8-byte "level descriptor" in the executable's data segment
(pointed at from the 32-byte level table at 0x540b10). It is a bag of
(pointer, count) list pairs plus the objective table and three code pointers
(init / update / event). The lists are:

  +0x0c/10  A  props            52 B  {id, cond, obj, pos[3], rot[3], fn, id2, w11, w12}
  +0x14/18  B  characters       32 B  {cond, type, chr, w3, weapon, ai, node, rt}
  +0x1c/20  C  objects/doors    88 B  {id, cond, obj, type, w4, node, f6, w7 ... pos[3] @0x48, yaw @0x54}
  +0x24/28  D  player starts    20 B  {cond, node, w2, w3, rt}
  +0x34/38  E  per-difficulty   24 B  {ptr, n, ptr, n, ptr, n}
  +0x3c/40  F  engine hooks      4 B  code pointer
  +0x44/48  G  items            80 B  {id, cond, w2, obj, w4, w5, w6, w7, node, ... amount @0x30, fn @0x3c, flags}
  +0x4c/50  H  pickups          24 B  {cond, obj, w2, w3, posrec*, w5}
  +0x54/58  I  animated objects 96 B  {id, cond, obj, w3, anim, w5, node, pos[3], floats..., text, ...}
  +0x5c/60  J  triggers         36 B  {id, cond, kind, w3, pos[3], radius, fn_or_data}
  +0x64/68  K  level settings  raw
  +0x6c/70  L  anim sequences   16 B  {id, cond, f, mask}
  +0x74/78  M  lifts         1316 B  raw words
  +0x7c/80  N  interactives     56 B  {id, cond, obj, pos[3], yaw, w7, w8, fn, w10, w11, f12, ptr13}
  +0x84/88  O  raw              16 B
  +0x8c/90  P  props (story)    52 B  same as A
  +0x94/98  Q  raw
  +0x9c/a0     objectives       36 B  {text, counted, fnA, fnB, cat[easy,normal,hard], state, w8}
  +0xa4/a8/ac  init / update / event functions

Spawn and item positions are nav-graph node ids (1001+ in pad/data/levelNN.raw,
9001+ in that file's "extra" block), so the positions are resolved here from the
disc copy and written inline.

Usage: python story_extract.py <elf> <disc PAK dir> <out dir> [--arcade]
"""
import json, os, struct, sys

ELF_SEGS = [(0x1000, 0x200000, 0x29d798), (0x29e800, 0x49d800, 0x1011ad)]
LEVEL_TABLE = 0x540b10
OBJECT_TABLE = 0x5410c4  # pointer to model path, stride 0x24, index = object id


class Elf:
    def __init__(self, path):
        self.d = open(path, 'rb').read()

    def off(self, va):
        for o, v, s in ELF_SEGS:
            if v <= va < v + s:
                return va - v + o
        return None

    def u32(self, va):
        return struct.unpack_from('<I', self.d, self.off(va))[0]

    def i32(self, va):
        return struct.unpack_from('<i', self.d, self.off(va))[0]

    def f32(self, va):
        return round(struct.unpack_from('<f', self.d, self.off(va))[0], 4)

    def words(self, va, n):
        return list(struct.unpack_from('<%dI' % n, self.d, self.off(va)))

    def cstr(self, va):
        o = self.off(va)
        if o is None:
            return None
        e = self.d.index(b'\0', o)
        return self.d[o:e].decode('latin1')

    def is_code(self, v):
        return 0x200000 <= v < 0x49d798

    def is_data(self, v):
        return 0x49d800 <= v < 0x5a0000


def f(w):
    return round(struct.unpack('<f', struct.pack('<I', w))[0], 4)


def s32(w):
    return w - (1 << 32) if w & 0x80000000 else w


def obj_name(elf, idx):
    if not (0 <= idx < 1400):
        return None
    p = elf.u32(OBJECT_TABLE + idx * 0x24)
    s = elf.cstr(p) if elf.is_data(p) or 0x200000 <= p < 0x5a0000 else None
    return s.replace('host0:', '') if s else None


def read_pad(pak_path, level):
    """Node id -> {pos, yaw, room, type} from the story PAK's nav file."""
    from pak import read_dir  # tools/sundial/pak.py
    entries = read_dir(pak_path)
    name = 'pad/data/level%d.raw' % level
    ent = next((e for e in entries if e[0] == name), None)
    if not ent:
        return {}
    with open(pak_path, 'rb') as fh:
        fh.seek(ent[1]); d = fh.read(ent[2])
    nodes = {}
    _, nn, nl = struct.unpack_from('<3I', d, 0)

    def node(p):
        nid, flags, link, x, y, z, yaw, typ = struct.unpack_from('<3I3fIi', d, p)
        yaw = f(yaw) if yaw else 0.0
        return nid, {'pos': [round(x, 4), round(y, 4), round(z, 4)], 'yaw': yaw, 'link': link, 'type': typ, 'flags': flags}
    for i in range(nn):
        nid, rec = node(12 + i * 32); nodes[nid] = rec
    ex = 12 + nn * 32 + nl * 20
    if ex + 4 <= len(d):
        nx = struct.unpack_from('<I', d, ex)[0]
        for i in range(nx):
            if ex + 4 + i * 32 + 32 > len(d):
                break
            nid, rec = node(ex + 4 + i * 32); nodes[nid] = rec
    return nodes


def extract_descriptor(elf, desc, level, pak_path):
    w = elf.words(desc, 50)
    lists = {}

    def lst(ptr_i, stride, n_override=None):
        ptr, n = w[ptr_i], w[ptr_i + 1]
        if not ptr or not n:
            return []
        return [elf.words(ptr + i * stride, stride // 4) for i in range(n)]

    used_nodes = set()

    def node_ref(v):
        if 1000 <= v < 9999:
            used_nodes.add(v)
            return v
        return None

    out = {'level': level, 'descriptor': hex(desc), 'flags': [w[0], w[1], w[2]]}

    def prop(r):
        return {'id': s32(r[0]), 'cond': r[1], 'obj': r[2], 'path': obj_name(elf, r[2]),
                'pos': [f(r[3]), f(r[4]), f(r[5])], 'rot': [f(r[6]), f(r[7]), f(r[8])],
                'fn': hex(r[9]) if r[9] else None, 'id2': s32(r[10]), 'w11': r[11], 'w12': r[12]}
    out['props'] = [prop(r) for r in lst(3, 0x34)]
    out['props2'] = [prop(r) for r in lst(35, 0x34)]
    out['chars'] = [{'cond': r[0], 'type': r[1], 'chr': r[2], 'w3': s32(r[3]), 'weapon': s32(r[4]), 'ai': s32(r[5]), 'node': node_ref(r[6])}
                    for r in lst(5, 0x20)]
    objs = []
    for r in lst(7, 0x58):
        objs.append({'id': s32(r[0]), 'cond': r[1], 'obj': r[2], 'path': obj_name(elf, r[2]), 'type': r[3], 'w4': s32(r[4]),
                     'node': node_ref(r[5]), 'f6': f(r[6]), 'w7': s32(r[7]), 'w8': r[8], 'w9': r[9], 'f10': f(r[10]),
                     'w11': r[11], 'w12': r[12], 'w13': r[13], 'w14': r[14], 'w15': r[15], 'w16': r[16], 'w17': r[17],
                     'pos': [f(r[18]), f(r[19]), f(r[20])], 'yaw': f(r[21])})
    out['objects'] = objs
    out['starts'] = [{'cond': r[0], 'node': node_ref(r[1]), 'w2': r[2], 'w3': r[3]} for r in lst(9, 0x14)]
    # E: three (ptr,count) pairs per record; record contents are u32 lists of unknown stride, kept raw (as words up to the next pointer)
    diff = []
    for r in lst(13, 0x18):
        trip = []
        for k in range(3):
            p, n = r[k * 2], r[k * 2 + 1]
            trip.append({'ptr': hex(p), 'n': n, 'words': elf.words(p, min(64, max(1, n * 4))) if p and elf.is_data(p) else []})
        diff.append(trip)
    out['difficulty'] = diff
    out['hooks'] = [hex(x) for x in lst(15, 4) and [r[0] for r in lst(15, 4)]]
    out['items'] = [{'id': s32(r[0]), 'cond': r[1], 'w2': r[2], 'obj': r[3], 'path': obj_name(elf, r[3]), 'w4': r[4], 'w5': r[5], 'w6': r[6], 'w7': r[7],
                     'node': node_ref(r[8]), 'w9': r[9], 'w10': r[10], 'w11': r[11], 'amount': r[12], 'w13': r[13], 'w14': s32(r[14]),
                     'fn': hex(r[15]) if r[15] else None, 'flags': r[16], 'w17': r[17], 'w18': r[18], 'w19': r[19]} for r in lst(17, 0x50)]
    pick = []
    for r in lst(19, 0x18):
        pr = elf.words(r[4], 4) if r[4] and elf.is_data(r[4]) else None
        pick.append({'cond': r[0], 'obj': r[1], 'path': obj_name(elf, r[1]), 'w2': r[2], 'w3': r[3],
                     'at': {'id': pr[0], 'pos': [f(pr[1]), f(pr[2]), f(pr[3])]} if pr else None, 'w5': r[5]})
    out['pickups'] = pick
    out['animObjects'] = [{'id': s32(r[0]), 'cond': r[1], 'obj': r[2], 'path': obj_name(elf, r[2]), 'w3': r[3], 'anim': r[4], 'w5': s32(r[5]),
                           'node': node_ref(r[6]), 'pos': [f(r[7]), f(r[8]), f(r[9])],
                           'f10': [f(x) for x in r[10:19]], 'text': r[19], 'w20': r[20], 'f21': f(r[21]), 'w22': r[22], 'w23': r[23]}
                          for r in lst(21, 0x60)]
    trig = []
    for r in lst(23, 0x24):
        tgt = r[8]
        trig.append({'id': s32(r[0]), 'cond': r[1], 'kind': r[2], 'w3': r[3], 'pos': [f(r[4]), f(r[5]), f(r[6])], 'radius': f(r[7]),
                     'fn': hex(tgt) if elf.is_code(tgt) else None, 'data': elf.words(tgt, 16) if elf.is_data(tgt) else None})
    out['triggers'] = trig
    out['settings'] = elf.words(w[25], 36) if w[25] and elf.is_data(w[25]) else None
    out['anims'] = [{'id': r[0], 'cond': r[1], 'f': f(r[2]), 'mask': r[3]} for r in lst(27, 0x10)]
    lifts = []
    for r in lst(29, 0x524):
        lifts.append({'flags': r[0], 'obj': r[1], 'path': obj_name(elf, r[1]), 'node': node_ref(r[6]), 'words': r[:96]})
    out['lifts'] = lifts
    out['interact'] = [{'id': s32(r[0]), 'cond': r[1], 'obj': r[2], 'path': obj_name(elf, r[2]), 'pos': [f(r[3]), f(r[4]), f(r[5])], 'yaw': f(r[6]),
                        'w7': r[7], 'w8': r[8], 'fn': hex(r[9]) if r[9] else None, 'w10': r[10], 'w11': r[11], 'f12': f(r[12]),
                        'data': elf.words(r[13], 8) if r[13] and elf.is_data(r[13]) else None} for r in lst(31, 0x38)]
    out['o'] = [{'ptr': hex(r[0]), 'n': r[1], 'f2': f(r[2]), 'w3': r[3], 'words': elf.words(r[0], min(48, max(4, r[1] * 4))) if r[0] and elf.is_data(r[0]) else []}
                for r in lst(33, 0x10)]
    # Q: stride unknown; keep the raw words up to the next known list start
    q, qn = w[37], w[38]
    if q and qn:
        starts = sorted(x for x in w if elf.is_data(x) and x > q)
        end = starts[0] if starts else q + 0x200
        out['q'] = {'n': qn, 'words': elf.words(q, min(256, (end - q) // 4))}
    else:
        out['q'] = None
    out['objectives'] = [{'text': r[0], 'counted': r[1], 'fnA': hex(r[2]) if r[2] else None, 'fnB': hex(r[3]) if r[3] else None,
                          'cat': [s32(r[4]), s32(r[5]), s32(r[6])], 'state': r[7], 'w8': r[8]} for r in lst(39, 0x24)]
    out['fns'] = {'init': hex(w[41]) if w[41] else None, 'update': hex(w[42]) if w[42] else None, 'event': hex(w[43]) if w[43] else None}
    nodes = read_pad(pak_path, level) if pak_path and os.path.exists(pak_path) else {}
    out['nodes'] = {str(n): nodes[n] for n in sorted(used_nodes) if n in nodes}
    out['missingNodes'] = sorted(n for n in used_nodes if n not in nodes)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    arcade = '--arcade' in sys.argv
    if len(args) < 3:
        print(__doc__); sys.exit(1)
    elf = Elf(args[0]); pakdir = args[1]; outdir = args[2]
    os.makedirs(outdir, exist_ok=True)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    levels = []
    v = LEVEL_TABLE
    while True:
        tw = elf.words(v, 8)
        if not (1600 < tw[0] < 1800 and tw[1] < 200):
            break
        levels.append({'entry': v, 'text': tw[0], 'num': tw[1], 'story': tw[4], 'arcade': tw[5]})
        v += 32
    index = []
    for L in levels:
        for kind in (['arcade'] if arcade else ['story']):
            desc = L[kind]
            if not desc or L['num'] >= 100:
                continue
            sub = 'STORY/L_%d_ST.PAK' % L['num'] if kind == 'story' else 'ARCADE/L_%d_AR.PAK' % L['num']
            pak_path = os.path.join(pakdir, sub)
            data = extract_descriptor(elf, desc, L['num'], pak_path)
            data['kind'] = kind; data['nameText'] = L['text']
            scripted = bool(data['fns']['init'] or data['objectives'])
            fn = os.path.join(outdir, '%s%d.json' % ('arcade' if kind == 'arcade' else 'level', L['num']))
            with open(fn, 'w') as fh:
                json.dump(data, fh, indent=1)
            index.append({'level': L['num'], 'kind': kind, 'nameText': L['text'], 'scripted': scripted, 'file': os.path.basename(fn),
                          'objectives': len(data['objectives']), 'chars': len(data['chars']), 'props': len(data['props']) + len(data['props2']),
                          'objects': len(data['objects']), 'triggers': len(data['triggers']), 'missingNodes': data['missingNodes']})
            print('%s %d: %d objectives, %d chars, %d objects, %d props, %d items, %d triggers, %d interact, missing nodes %s' % (
                kind, L['num'], len(data['objectives']), len(data['chars']), len(data['objects']), len(data['props']) + len(data['props2']),
                len(data['items']), len(data['triggers']), len(data['interact']), data['missingNodes'][:5]))
    with open(os.path.join(outdir, 'index.json'), 'w') as fh:
        json.dump(index, fh, indent=1)


if __name__ == '__main__':
    main()
