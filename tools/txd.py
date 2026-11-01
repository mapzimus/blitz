"""Decode RenderWare PS2 texture dictionaries (.rtd from NFL Blitz 2002) to PNG.
Usage: python -I tools/txd.py <file.rtd|dir> <outdir>
"""
import os, struct, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gs

def chunks(d, o, e):
    while o + 12 <= e:
        t, s, v = struct.unpack_from('<III', d, o)
        yield t, o + 12, s
        o += 12 + s

def unswizzle8(src, w, h):
    out = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            block = (y & ~0xf) * w + (x & ~0xf) * 2
            swap = (((y + 2) >> 2) & 1) * 4
            py = (((y & ~3) >> 1) + (y & 1)) & 7
            col = py * w * 2 + ((x + swap) & 7) * 4
            bn = ((y >> 1) & 1) + ((x >> 2) & 2)
            out[y * w + x] = src[block + col + bn]
    return out

def unswizzle4(src, w, h):
    # returns one byte per pixel (0..15)
    out = bytearray(w * h)
    ph = (w + 127) // 128; pv = (h + 127) // 128
    for y in range(h):
        for x in range(w):
            pageX = x & ~0x7f; pageY = y & ~0x7f
            pn = (pageY // 128) * ph + (pageX // 128)
            p32y = (pn // pv) * 32; p32x = (pn % pv) * 64
            ploc = p32y * h * 2 + p32x * 4
            lx = x & 0x7f; ly = y & 0x7f
            bloc = ((lx & ~0x1f) >> 1) * h + (ly & ~0xf) * 2
            swap = (((y + 2) >> 2) & 1) * 4
            py = (((y & ~3) >> 1) + (y & 1)) & 7
            cloc = py * h * 2 + ((x + swap) & 7) * 4
            bn = (x >> 3) & 3
            bits = (y >> 1) & 1
            b = src[ploc + bloc + cloc + bn]
            out[y * w + x] = (b >> (bits * 4)) & 0xf
    return out

def untwiddle_clut(pal):
    # PS2 8-bit CLUT: inside each 32-entry group, swap entries 8..15 with 16..23
    pal = bytearray(pal)
    for g in range(0, 256, 32):
        a = g + 8; b = g + 16
        pal[a*4:(a+8)*4], pal[b*4:(b+8)*4] = pal[b*4:(b+8)*4], pal[a*4:(a+8)*4]
    return bytes(pal)

def ps2_alpha(a):
    return min(255, a * 2)

def gif_trxreg(blob):
    """If the pixel blob starts with a 0x50-byte GIF upload header, return (rrw, rrh, 0x50), else (None, None, 0)."""
    if len(blob) < 0x50: return None, None, 0
    nloop = struct.unpack_from('<I', blob, 0)[0] & 0x7fff
    regs = struct.unpack_from('<Q', blob, 8)[0]
    if nloop == 3 and (regs & 0xf) == 0xe:
        rrw = rrh = None
        for i in range(3):
            data, addr = struct.unpack_from('<QQ', blob, 16 + i * 16)
            if addr == 0x52: rrw, rrh = data & 0xfff, (data >> 32) & 0xfff
        return rrw, rrh, 0x50
    return None, None, 0

def decode_native(d, o, e):
    it = chunks(d, o, e)
    t, so, ss = next(it); platform = d[so:so+4]
    if platform != b'PS2\0': raise ValueError('not PS2: %r' % platform)
    t, so, ss = next(it); name = d[so:so+ss].split(b'\0')[0].decode('latin1')
    t, so, ss = next(it)  # mask name
    t, so, ss = next(it)  # raster struct (contains two sub-structs)
    sub = list(chunks(d, so, so + ss))
    (_, io, isz), (_, po, psz) = sub[0], sub[1]
    w, h, depth, fmt = struct.unpack_from('<IIII', d, io)
    tex0 = struct.unpack_from('<Q', d, io + 16)[0]
    texel_size, pal_size = struct.unpack_from('<II', d, io + 48)
    pix = d[po:po + texel_size]
    pal = d[po + texel_size: po + texel_size + pal_size]
    rrw, rrh, hdr = gif_trxreg(pix)
    pix = pix[hdr:]
    prrw, prrh, phdr = gif_trxreg(pal)
    pal = pal[phdr:]
    img = Image.new('RGBA', (w, h))
    px = img.load()
    if depth == 8:
        n = w * h
        swz = rrw is not None and rrw * 2 == w and rrh * 2 == h
        idx = unswizzle8(pix[:n], w, h) if swz else pix[:n]
        clut = untwiddle_clut(pal[:1024]) if len(pal) >= 1024 else pal
        for i in range(n):
            k = idx[i] * 4
            px[i % w, i // w] = (clut[k], clut[k+1], clut[k+2], ps2_alpha(clut[k+3]))
    elif depth == 4:
        n = w * h
        swz = rrw is not None and rrw * 2 == w and rrh * 2 == h
        if swz:
            idx = gs.unswizzle4_ct16(pix[:n // 2], w, h, rrw, rrh)
        else:
            idx = bytearray(n)
            for i in range(n // 2):
                b = pix[i]; idx[2*i] = b & 0xf; idx[2*i+1] = b >> 4
        for i in range(n):
            k = idx[i] * 4
            px[i % w, i // w] = (pal[k], pal[k+1], pal[k+2], ps2_alpha(pal[k+3]))
    elif depth == 32:
        for i in range(w * h):
            k = i * 4
            px[i % w, i // w] = (pix[k], pix[k+1], pix[k+2], ps2_alpha(pix[k+3]))
    elif depth == 16:
        for i in range(w * h):
            v = struct.unpack_from('<H', pix, i * 2)[0]
            px[i % w, i // w] = ((v & 31) << 3, ((v >> 5) & 31) << 3, ((v >> 10) & 31) << 3, 255 if v & 0x8000 else 0)
    else:
        raise ValueError('depth %d' % depth)
    return name, img, dict(w=w, h=h, depth=depth, fmt=hex(fmt), swizzled=bool(rrw is not None and rrw * 2 == w))

def decode_txd(path):
    d = open(path, 'rb').read()
    out = []
    for t, o, s in chunks(d, 0, len(d)):
        if t != 0x16: continue
        for t2, o2, s2 in chunks(d, o, o + s):
            if t2 == 0x15:
                try:
                    out.append(decode_native(d, o2, o2 + s2))
                except Exception as ex:
                    out.append((f'ERR@{o2:#x}', None, str(ex)))
    return out

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    files = [os.path.join(src, f) for f in sorted(os.listdir(src)) if f.lower().endswith('.rtd')] if os.path.isdir(src) else [src]
    os.makedirs(dst, exist_ok=True)
    for f in files:
        base = os.path.splitext(os.path.basename(f))[0]
        for name, img, info in decode_txd(f):
            if img is None:
                print(f'{base}: {name} {info}'); continue
            outp = os.path.join(dst, f'{base}__{name}.png')
            img.save(outp)
            print(f'{base}/{name}: {info}')
