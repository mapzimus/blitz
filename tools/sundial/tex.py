"""Decode TimeSplitters 2 PS2 .raw textures (textures/*.raw) to PNG.

Header (16 bytes, LE): u32 a, u32 b, u32 width, u32 height
Then: 256 x RGBA palette (PS2: alpha 0x80 = opaque), then width*height 8-bit indices.
PS2 CLUT swizzle: within each 32-entry block, entries 8-15 and 16-23 are swapped.

Usage: tex.py IN.raw OUT.png   |   tex.py --dir INDIR OUTDIR [--noswizzle]
"""
import os, struct, sys, zlib

def png(w, h, rgba):
    raw = b''.join(b'\0' + rgba[y*w*4:(y+1)*w*4] for y in range(h))
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def unswizzle_clut(pal):
    out = bytearray(pal)
    for blk in range(0, 256, 32):
        a = out[(blk+8)*4:(blk+16)*4]
        b = out[(blk+16)*4:(blk+24)*4]
        out[(blk+8)*4:(blk+16)*4] = b
        out[(blk+16)*4:(blk+24)*4] = a
    return bytes(out)

def decode(data, swizzle=True):
    a, b, w, h = struct.unpack_from('<IIII', data, 0)
    pal = data[16:16+1024]
    if swizzle:
        pal = unswizzle_clut(pal)
    idx = data[16+1024:16+1024+w*h]
    if len(idx) != w*h:
        raise ValueError(f'size mismatch: header {w}x{h}, have {len(data)} bytes (a={a} b={b})')
    out = bytearray(w*h*4)
    for i, p in enumerate(idx):
        r, g, bb, al = pal[p*4:p*4+4]
        out[i*4:i*4+4] = bytes((r, g, bb, min(255, al*2)))
    return w, h, bytes(out), (a, b)

def main():
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    sw = '--noswizzle' not in sys.argv
    if '--dir' in sys.argv:
        src, dst = args
        os.makedirs(dst, exist_ok=True)
        n = 0
        for root, _, files in os.walk(src):
            for f in files:
                if not f.endswith('.raw'): continue
                p = os.path.join(root, f)
                try:
                    w, h, rgba, _ = decode(open(p, 'rb').read(), sw)
                except Exception as e:
                    print('skip', p, e); continue
                rel = os.path.relpath(p, src).replace(os.sep, '_')[:-4] + '.png'
                open(os.path.join(dst, rel), 'wb').write(png(w, h, rgba)); n += 1
        print(f'{n} textures -> {dst}')
    else:
        src, dst = args
        w, h, rgba, hdr = decode(open(src, 'rb').read(), sw)
        open(dst, 'wb').write(png(w, h, rgba))
        print(f'{w}x{h} hdr={hdr} -> {dst}')

if __name__ == '__main__':
    main()
