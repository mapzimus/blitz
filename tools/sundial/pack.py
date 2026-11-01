"""Build a single asset pack for the SUNDIAL page from your own disc copy.

The pack is a plain container: 'SNDL' + u32 count, then per entry u16 nameLen, name (utf-8),
u32 size, and after the table the file bodies in order. The page loads it once (file pick or
?pack=URL) and keeps the archives in the browser. Keep the pack private; it is game data.

  python pack.py <disc folder> <out.pack> [--music N] [--no-story] [--chr]

  --music N   include the first N arcade music tracks (default 6; 0 for none)
  --no-story  leave out the story maps (about 170 MB)
  --chr       include CHR.PAK (36 MB, only needed by the viewer page)
"""
import os, sys, struct, glob

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        raise SystemExit(__doc__)
    disc, out = args
    music = 6
    for a in sys.argv:
        if a.startswith('--music'):
            music = int(sys.argv[sys.argv.index(a) + 1]) if a == '--music' else int(a.split('=')[1])
    pak = os.path.join(disc, 'PAK')
    files = []
    for n in ['GUN.PAK', 'SOUNDS.PAK', 'ANIM.PAK', 'FE_ANIM.PAK']:
        files.append((n.lower(), os.path.join(pak, n)))
    files.append(('l_103.pak', os.path.join(pak, 'ARCADE', 'L_103.PAK')))  # front-end pack: UI text
    if '--chr' in sys.argv:
        files.append(('chr.pak', os.path.join(pak, 'CHR.PAK')))
    for p in sorted(glob.glob(os.path.join(pak, 'ARCADE', 'L_*_AR.PAK'))):
        files.append((os.path.basename(p).lower(), p))
    if '--no-story' not in sys.argv:
        for p in sorted(glob.glob(os.path.join(pak, 'STORY', 'L_*_ST.PAK'))):
            files.append((os.path.basename(p).lower(), p))
    tracks = sorted(glob.glob(os.path.join(disc, 'MUSIC', 'MUSIC1', '*.MIB')))[:music]
    for p in tracks:
        files.append((os.path.basename(p).lower(), p))
    files = [(n, p) for n, p in files if os.path.isfile(p)]
    total = sum(os.path.getsize(p) for _, p in files)
    with open(out, 'wb') as o:
        o.write(b'SNDL' + struct.pack('<I', len(files)))
        for n, p in files:
            nb = n.encode('utf-8')
            o.write(struct.pack('<H', len(nb)) + nb + struct.pack('<I', os.path.getsize(p)))
        for n, p in files:
            with open(p, 'rb') as f:
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    o.write(chunk)
    print(f'{out}: {len(files)} files, {total / 1e6:.0f} MB')
    for n, p in files:
        print(f'  {n:18s} {os.path.getsize(p) / 1e6:7.1f} MB')

if __name__ == '__main__':
    main()
