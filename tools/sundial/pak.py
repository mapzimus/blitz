"""P4CK archive reader (PS2).

Layout (little-endian):
  0x00  'P4CK'
  0x04  u32 dirOffset   absolute offset of the directory table
  0x08  u32 dirSize     bytes; entries are 60 bytes each
  0x0C  u32 zero
  data  starts at 0x800 (2 KB aligned)
entry: char name[48] (NUL padded, '/' separated), u32 offset, u32 size, u32 zero

Usage:
  pak.py list  FILE.PAK
  pak.py x     FILE.PAK OUTDIR
  pak.py stats FILE.PAK          # count by extension
"""
import os, struct, sys
from collections import Counter

ENTRY = struct.Struct('<48sIII')

def read_dir(path):
    with open(path, 'rb') as f:
        magic, doff, dsize, _ = struct.unpack('<4sIII', f.read(16))
        if magic != b'P4CK':
            raise SystemExit(f'{path}: not P4CK (got {magic!r})')
        f.seek(doff)
        raw = f.read(dsize)
    n = dsize // ENTRY.size
    out = []
    for i in range(n):
        name, off, size, pad = ENTRY.unpack_from(raw, i * ENTRY.size)
        name = name.split(b'\0', 1)[0].decode('latin-1')
        if not name:
            continue
        out.append((name, off, size))
    return out

def main():
    cmd, path = sys.argv[1], sys.argv[2]
    entries = read_dir(path)
    if cmd == 'list':
        for name, off, size in entries:
            print(f'{off:#010x} {size:>9} {name}')
        print(f'{len(entries)} entries')
    elif cmd == 'stats':
        c = Counter(os.path.splitext(n)[1].lower() for n, _, _ in entries)
        d = Counter(n.split('/')[0] for n, _, _ in entries)
        print('by extension:', dict(c.most_common()))
        print('by top dir  :', dict(d.most_common()))
        print(f'{len(entries)} entries')
    elif cmd == 'x':
        outdir = sys.argv[3]
        with open(path, 'rb') as f:
            for name, off, size in entries:
                dst = os.path.join(outdir, *name.split('/'))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                f.seek(off)
                with open(dst, 'wb') as o:
                    o.write(f.read(size))
        print(f'extracted {len(entries)} files to {outdir}')
    else:
        raise SystemExit(__doc__)

if __name__ == '__main__':
    main()
