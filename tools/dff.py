"""Decode NFL Blitz 2002 (RenderWare 3.1, PS2 native) .dff models.
Each native split = one material; its VIF stream is a sequence of batches, each batch a triangle
strip given as UNPACK V3-32 positions, V2-32 uvs, V4-8 colors, V3-8 normals (+ optional skin data).
Usage: python -I tools/dff.py <file.dff> [out.obj] [preview.png]
"""
import struct, sys, math

def chunks(d, o, e):
    while o + 12 <= e:
        t, s, v = struct.unpack_from('<III', d, o)
        yield t, o + 12, s
        o += 12 + s

ELEM = {0x0: 4, 0x1: 2, 0x2: 1, 0x4: 8, 0x5: 4, 0x6: 2, 0x8: 12, 0x9: 6, 0xA: 3, 0xC: 16, 0xD: 8, 0xE: 4, 0xF: 2}

def parse_vif(d, o, e):
    """Yield batches: list of (vn_vl, usn, n, dataoffset) per UNPACK, grouped by MSCAL/MSCNT."""
    batches = []; cur = []
    p = o
    while p + 16 <= e:
        tag = struct.unpack_from('<IIII', d, p)
        qwc = tag[0] & 0xffff; tid = (tag[0] >> 28) & 7
        if tid not in (0, 1, 6, 7) or qwc == 0: break
        r = p + 16; re_ = min(e, r + qwc * 16)
        while r + 4 <= re_:
            code = struct.unpack_from('<I', d, r)[0]
            cmd = (code >> 24) & 0x7f; num = (code >> 16) & 0xff; imm = code & 0xffff
            if cmd & 0x60 == 0x60:
                vn_vl = cmd & 0xf; n = num or 256
                nbytes = n * ELEM.get(vn_vl, 0)
                cur.append((vn_vl, (imm >> 14) & 1, n, r + 4))
                r += 4 + ((nbytes + 3) & ~3)
            else:
                if cmd in (0x14, 0x15, 0x17):      # MSCAL / MSCALF / MSCNT: batch complete
                    if cur: batches.append(cur); cur = []
                if cmd == 0x20: r += 4
                elif cmd in (0x30, 0x31): r += 16
                r += 4
        if cur: batches.append(cur); cur = []
        p = re_
        if tid in (0, 6, 7): break
    return batches

def read_geometry(d, go, ge):
    """Return dict with materials, splits (list of batches of vertex dicts), and bone data."""
    it = chunks(d, go, ge)
    _, so, ss = next(it)                               # geometry struct
    flags, ntri, nvert, nmorph = struct.unpack_from('<IIII', d, so)
    mats = []
    splits_mat = []
    native = None
    skin = None
    bflags = 1
    for t, o, s in chunks(d, go, ge):
        if t == 0x8:                                  # material list
            sub = list(chunks(d, o, o + s))
            for t2, o2, s2 in sub:
                if t2 == 0x7:
                    tex = None; color = struct.unpack_from('<4B', d, o2 + 12 + 4)
                    for t3, o3, s3 in chunks(d, o2, o2 + s2):
                        if t3 == 0x6:
                            strs = [x for x in chunks(d, o3, o3 + s3) if x[0] == 2]
                            if strs: tex = d[strs[0][1]:strs[0][1] + strs[0][2]].split(b'\0')[0].decode('latin1')
                    mats.append({'texture': tex, 'color': color})
        if t == 0x3:                                  # extension: binmesh + native data + skin
            for t2, o2, s2 in chunks(d, o, o + s):
                if t2 == 0x50E:
                    bflags, nmesh, nidx = struct.unpack_from('<III', d, o2)
                    splits_mat = [struct.unpack_from('<II', d, o2 + 12 + 8 * k)[1] for k in range(nmesh)]
                if t2 == 0x510:
                    for t3, o3, s3 in chunks(d, o2, o2 + s2):
                        if t3 == 1: native = (o3, min(o3 + s3, o2 + s2))
                if t2 == 0x116:
                    skin = (o2, o2 + s2)
    splits = []
    if not native and nvert:
        # standard RW geometry: [prelit][uv sets][triangles][morph: sphere, flags, verts, normals]
        q = so + 16 + (12 if ss >= 28 else 0)      # RW < 3.4 keeps ambient/specular/diffuse floats here
        cols = None
        if flags & 0x8: cols = [struct.unpack_from('<4B', d, q + 4 * i) for i in range(nvert)]; q += 4 * nvert
        ntex = (flags >> 16) & 0xff or (1 if flags & 0x4 else 0)
        uvs = None
        for k in range(ntex):
            u = [struct.unpack_from('<2f', d, q + 8 * i) for i in range(nvert)]; q += 8 * nvert
            if k == 0: uvs = u
        tris = [struct.unpack_from('<4H', d, q + 8 * i) for i in range(ntri)]; q += 8 * ntri
        q += 16
        hasv, hasn = struct.unpack_from('<II', d, q); q += 8
        pos = [struct.unpack_from('<3f', d, q + 12 * i) for i in range(nvert)] if hasv else None; q += 12 * nvert if hasv else 0
        nrm = [struct.unpack_from('<3f', d, q + 12 * i) for i in range(nvert)] if hasn else None
        bymat = {}
        for (b, a, m, c) in tris: bymat.setdefault(m, []).append((a, b, c))
        for m, tl in bymat.items():
            splits.append({'material': m, 'batches': [], 'indexed': {'pos': pos, 'uv': uvs, 'col': cols, 'nrm': nrm, 'tris': tl}})
    if native:
        o, e = native
        p = o + 4
        si = 0
        while p + 8 <= e:
            size, flag = struct.unpack_from('<II', d, p); p += 8
            if size == 0 or p + size > e + 16: break
            batches = parse_vif(d, p, p + size)
            verts_batches = []
            for b in batches:
                pos = uv = col = nrm = wgt = idx = None
                for (vn, usn, n, off) in b:
                    if vn == 0x8 and pos is None: pos = [struct.unpack_from('<3f', d, off + 12 * i) for i in range(n)]
                    elif vn == 0x4 and uv is None: uv = [struct.unpack_from('<2f', d, off + 8 * i) for i in range(n)]
                    elif vn == 0xE and col is None: col = [struct.unpack_from('<4B', d, off + 4 * i) for i in range(n)]
                    elif vn == 0xA and nrm is None: nrm = [struct.unpack_from('<3b', d, off + 3 * i) for i in range(n)]
                    elif vn == 0xC and wgt is None: wgt = [struct.unpack_from('<4f', d, off + 16 * i) for i in range(n)]
                    elif vn == 0xC and wgt is not None and idx is None: idx = [struct.unpack_from('<4f', d, off + 16 * i) for i in range(n)]
                    elif vn == 0xE and col is not None and idx is None: idx = [struct.unpack_from('<4B', d, off + 4 * i) for i in range(n)]
                if pos: verts_batches.append({'pos': pos, 'uv': uv, 'col': col, 'nrm': nrm, 'wgt': wgt, 'idx': idx})
            splits.append({'material': splits_mat[si] if si < len(splits_mat) else 0, 'batches': verts_batches})
            p += size; si += 1
    return {'flags': flags, 'ntri': ntri, 'nvert': nvert, 'materials': mats, 'splits': splits, 'skin': skin, 'strip': bool(bflags & 1)}

def read_dff(path):
    d = open(path, 'rb').read()
    geos = []; frames = []; atomics = []
    def walk(o, e):
        for t, so, s in chunks(d, o, e):
            if t == 0xF: geos.append(read_geometry(d, so, so + s))
            elif t == 0x14:
                _, ao, asz = next(chunks(d, so, so + s)); fi, gi = struct.unpack_from('<II', d, ao); atomics.append({'frame': fi, 'geometry': gi})
            elif t == 0xE:
                _, fo, fs = next(chunks(d, so, so + s))
                n = struct.unpack_from('<I', d, fo)[0]
                for i in range(n):
                    m = struct.unpack_from('<12f', d, fo + 4 + i * 56); parent = struct.unpack_from('<i', d, fo + 4 + i * 56 + 48)[0]
                    frames.append({'rot': m[:9], 'pos': m[9:12], 'parent': parent})
            elif t in (0x10, 0x1A, 0x3):
                walk(so, so + s)
    walk(0, len(d))
    return {'geometries': geos, 'frames': frames, 'atomics': atomics}

def batch_triangles(n, strip):
    if strip: return strip_triangles(n)
    return ((i, i + 1, i + 2) for i in range(0, n - 2, 3))

def frame_world(frames):
    out = [None] * len(frames)
    def mat(f):
        r = f['rot']; p = f['pos']
        return [[r[0], r[3], r[6], p[0]], [r[1], r[4], r[7], p[1]], [r[2], r[5], r[8], p[2]], [0, 0, 0, 1]]
    def mul(a, b): return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
    for i, f in enumerate(frames):
        m = mat(f)
        out[i] = m if f['parent'] < 0 else mul(out[f['parent']], m)
    return out

def xform(m, p): return (m[0][0]*p[0]+m[0][1]*p[1]+m[0][2]*p[2]+m[0][3], m[1][0]*p[0]+m[1][1]*p[1]+m[1][2]*p[2]+m[1][3], m[2][0]*p[0]+m[2][1]*p[1]+m[2][2]*p[2]+m[2][3])

def all_triangles(model):
    """World-space triangles of every atomic (rest pose)."""
    W = frame_world(model['frames']) if model['frames'] else []
    tris = []
    ats = model['atomics'] or [{'frame': 0, 'geometry': i} for i in range(len(model['geometries']))]
    for a in ats:
        g = model['geometries'][a['geometry']]
        m = W[a['frame']] if W and a['frame'] < len(W) else None
        T = (lambda p: xform(m, p)) if m else (lambda p: p)
        for sp in g['splits']:
            if 'indexed' in sp:
                ix = sp['indexed']
                for (x, y, z) in ix['tris']: tris.append((T(ix['pos'][x]), T(ix['pos'][y]), T(ix['pos'][z])))
            for b in sp['batches']:
                n = len(b['pos'])
                for (x, y, z) in batch_triangles(n, g['strip']):
                    pa, pb, pc = b['pos'][x], b['pos'][y], b['pos'][z]
                    if pa == pb or pb == pc or pa == pc: continue
                    tris.append((T(pa), T(pb), T(pc)))
    return tris

def strip_triangles(n):
    for i in range(2, n):
        if i % 2 == 0: yield (i - 2, i - 1, i)
        else: yield (i - 1, i - 2, i)

def to_obj(model, path):
    out = ['# blitz dff']; base = 1; ntri = 0
    for gi, g in enumerate(model['geometries']):
        for si, sp in enumerate(g['splits']):
            mat = g['materials'][sp['material']] if sp['material'] < len(g['materials']) else {'texture': None}
            out.append(f'g geo{gi}_split{si}_{mat["texture"]}')
            if 'indexed' in sp:
                ix = sp['indexed']
                for i in range(len(ix['pos'])):
                    x, y, z = ix['pos'][i]; out.append(f'v {x} {y} {z}')
                    if ix['uv']: u, v = ix['uv'][i]; out.append(f'vt {u} {1 - v}')
                for (a, bb, c) in ix['tris']: out.append(f'f {base+a}/{base+a} {base+bb}/{base+bb} {base+c}/{base+c}'); ntri += 1
                base += len(ix['pos'])
            for b in sp['batches']:
                n = len(b['pos'])
                for i in range(n):
                    x, y, z = b['pos'][i]; out.append(f'v {x} {y} {z}')
                    if b['uv']: u, v = b['uv'][i]; out.append(f'vt {u} {1 - v}')
                for (a, bb, c) in batch_triangles(n, g['strip']):
                    pa, pb, pc = b['pos'][a], b['pos'][bb], b['pos'][c]
                    if pa == pb or pb == pc or pa == pc: continue
                    out.append(f'f {base+a}/{base+a} {base+bb}/{base+bb} {base+c}/{base+c}'); ntri += 1
                base += n
    open(path, 'w').write('\n'.join(out))
    return ntri

def preview(model, path, size=800):
    from PIL import Image, ImageDraw
    tris = all_triangles(model)
    if not tris: return 0
    xs = [p[0] for t in tris for p in t]; ys = [p[1] for t in tris for p in t]; zs = [p[2] for t in tris for p in t]
    cx, cy, cz = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2, (min(zs)+max(zs))/2
    ext = max(max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)) or 1
    # 3/4 view: rotate about Y by 35deg, tilt 20deg
    ca, sa = math.cos(0.6), math.sin(0.6); cb, sb = math.cos(0.35), math.sin(0.35)
    def proj(p):
        x, y, z = p[0]-cx, p[1]-cy, p[2]-cz
        x, z = x*ca + z*sa, -x*sa + z*ca
        y, z = y*cb - z*sb, y*sb + z*cb
        s = size * 0.42 / ext
        return (size/2 + x*s, size/2 - y*s, z)
    img = Image.new('RGB', (size, size), (20, 22, 30)); dr = ImageDraw.Draw(img)
    light = (0.3, 0.8, 0.5)
    pts = []
    for t in tris:
        a, b, c = [proj(p) for p in t]
        ux, uy, uz = t[1][0]-t[0][0], t[1][1]-t[0][1], t[1][2]-t[0][2]
        vx, vy, vz = t[2][0]-t[0][0], t[2][1]-t[0][1], t[2][2]-t[0][2]
        nx, ny, nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        l = math.sqrt(nx*nx+ny*ny+nz*nz) or 1
        sh = abs((nx*light[0]+ny*light[1]+nz*light[2])/l)
        pts.append(((a[2]+b[2]+c[2])/3, a, b, c, sh))
    pts.sort(key=lambda t: -t[0])
    for _, a, b, c, sh in pts:
        v = int(60 + 180 * sh)
        dr.polygon([a[:2], b[:2], c[:2]], fill=(v, v, v), outline=(v//2, v//2, v//2))
    dr.text((8, 8), f'{len(tris)} tris  extent {ext:.1f}  center ({cx:.0f},{cy:.0f},{cz:.0f})', fill=(255, 200, 80))
    img.save(path)
    return len(tris)

if __name__ == '__main__':
    m = read_dff(sys.argv[1])
    for gi, g in enumerate(m['geometries']):
        print(f'geometry {gi}: flags={g["flags"]:#x} ntri={g["ntri"]} nvert={g["nvert"]} materials={[x["texture"] for x in g["materials"]]} splits={[(s["material"], len(s["batches"]), sum(len(b["pos"]) for b in s["batches"]) if s["batches"] else len(s["indexed"]["tris"])) for s in g["splits"]]} skin={g["skin"] is not None}')
        for sp in [x for x in g['splits'] if x['batches']][:1]:
            b = sp['batches'][0]; print('  batch0 keys:', {k: (len(v) if v else None) for k, v in b.items()}, 'pos0', b['pos'][0], 'uv0', b['uv'] and b['uv'][0], 'wgt0', b['wgt'] and b['wgt'][0], 'idx0', b['idx'] and b['idx'][0])
    print('frames', len(m['frames']))
    if len(sys.argv) > 2: print('obj tris', to_obj(m, sys.argv[2]))
    if len(sys.argv) > 3: print('preview tris', preview(m, sys.argv[3]))
