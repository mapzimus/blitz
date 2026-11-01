"""Walk the PS2 native-data DMA/VIF stream inside a RenderWare DFF and print what it unpacks.
Usage: python -I tools/vifdump.py <file.dff> [maxlines]
"""
import struct, sys

def chunks(d, o, e):
    while o + 12 <= e:
        t, s, v = struct.unpack_from('<III', d, o)
        yield t, o + 12, s
        o += 12 + s

def find_native(d):
    out = []
    def walk(o, e):
        for t, so, s in chunks(d, o, e):
            if t == 0x510:
                for t2, so2, s2 in chunks(d, so, so + s):
                    if t2 == 1: out.append((so2, s2))
            elif t in (0x10, 0xE, 0x1A, 0xF, 0x3, 0x14):
                walk(so, so + s)
    walk(0, len(d))
    return out

UNPACK = {0x0: 'S-32', 0x1: 'S-16', 0x2: 'S-8', 0x4: 'V2-32', 0x5: 'V2-16', 0x6: 'V2-8', 0x8: 'V3-32', 0x9: 'V3-16', 0xA: 'V3-8', 0xC: 'V4-32', 0xD: 'V4-16', 0xE: 'V4-8', 0xF: 'V4-5'}
ELEM = {0x0: 4, 0x1: 2, 0x2: 1, 0x4: 8, 0x5: 4, 0x6: 2, 0x8: 12, 0x9: 6, 0xA: 3, 0xC: 16, 0xD: 8, 0xE: 4, 0xF: 2}

def dump(d, o, e, maxlines=400, pr=print):
    hdr = struct.unpack_from('<IIII', d, o)
    pr(f'native struct @{o:#x} size={e-o} head={[hex(h) for h in hdr]}')
    p = o + 4                      # skip platform id (4)
    split = 0
    lines = 0
    while p + 8 <= e and lines < maxlines:
        size, flag = struct.unpack_from('<II', d, p)
        pr(f'-- split {split}: dma bytes={size} flag={flag} @{p:#x}')
        p += 8
        q = p; qe = p + size
        while q + 16 <= qe and lines < maxlines:
            # DMA tag: qwc(16) | pad | id(3 bits at 28) ; addr ; then 2 VIF codes in the tag's upper 8 bytes
            tag = struct.unpack_from('<IIII', d, q)
            qwc = tag[0] & 0xffff; tid = (tag[0] >> 28) & 7
            vif0, vif1 = tag[2], tag[3]
            pr(f'  DMAtag @{q:#x} qwc={qwc} id={tid} addr={tag[1]:#x} vif={vif0:#010x},{vif1:#010x}')
            lines += 1
            q += 16
            # payload: qwc quadwords of VIF codes
            r = q; re_ = q + qwc * 16
            while r + 4 <= re_ and lines < maxlines:
                code = struct.unpack_from('<I', d, r)[0]
                cmd = (code >> 24) & 0x7f; num = (code >> 16) & 0xff; imm = code & 0xffff
                if cmd & 0x60 == 0x60:      # UNPACK
                    vn_vl = cmd & 0xf; mask = (cmd >> 4) & 1
                    n = num or 256
                    nbytes = n * ELEM.get(vn_vl, 0)
                    pr(f'    UNPACK {UNPACK.get(vn_vl, hex(vn_vl))} n={n} addr={imm & 0x3ff:#x} flg={(imm>>15)&1} usn={(imm>>14)&1} mask={mask} bytes={nbytes} @{r+4:#x} first={d[r+4:r+4+min(16,nbytes)].hex()}')
                    r += 4 + ((nbytes + 3) & ~3)
                else:
                    names = {0: 'NOP', 1: 'STCYCL', 2: 'OFFSET', 3: 'BASE', 4: 'ITOP', 5: 'STMOD', 6: 'MSKPATH3', 7: 'MARK', 0x10: 'FLUSHE', 0x11: 'FLUSH', 0x13: 'FLUSHA', 0x14: 'MSCAL', 0x15: 'MSCALF', 0x17: 'MSCNT', 0x20: 'STMASK', 0x30: 'STROW', 0x31: 'STCOL', 0x4A: 'MPG', 0x50: 'DIRECT', 0x51: 'DIRECTHL'}
                    nm = names.get(cmd, hex(cmd))
                    extra = ''
                    if cmd == 0x20: extra = f' mask={struct.unpack_from("<I", d, r+4)[0]:#010x}'; r += 4
                    if cmd in (0x30, 0x31): extra = ' ' + d[r+4:r+20].hex(); r += 16
                    if cmd == 1: extra = f' cl={imm & 0xff} wl={(imm>>8)&0xff}'
                    if cmd in (0x14, 0x15, 0x17, 4, 5, 2, 3): extra += f' imm={imm:#x}'
                    if cmd != 0: pr(f'    {nm}{extra}'); lines += 1
                    r += 4
            q = re_
            if tid in (0, 7): break      # refe / end
        p = qe
        split += 1
    return

if __name__ == '__main__':
    d = open(sys.argv[1], 'rb').read()
    for o, s in find_native(d):
        dump(d, o, o + s, int(sys.argv[2]) if len(sys.argv) > 2 else 400)
