"""Unpack NFL Blitz 2002's MSLASSET.MS2 sound container to WAV.
Usage: python -I tools/mss.py <mslasset.ms2> <outdir> [name-substring ...]
Each .mss = small header (flags, ?, channels, rate, datasize) + PS2 ADPCM frames.
"""
import os, struct, sys, wave

F1 = [0.0, 60 / 64, 115 / 64, 98 / 64, 122 / 64]
F2 = [0.0, 0.0, -52 / 64, -55 / 64, -60 / 64]

def decode_adpcm(data):
    out = []
    h1 = h2 = 0.0
    n = len(data) // 16
    for i in range(n):
        f = data[i * 16:i * 16 + 16]
        shift = f[0] & 0x0f; filt = (f[0] >> 4) & 0x0f
        if filt > 4: filt = 0
        if f[1] == 7: break                     # end marker, no play
        for j in range(14):
            b = f[2 + j]
            for nib in (b & 0x0f, b >> 4):
                s = (nib << 12)
                if s & 0x8000: s -= 0x10000
                s = (s >> shift) if shift <= 12 else 0
                v = s + h1 * F1[filt] + h2 * F2[filt]
                h2 = h1; h1 = v
                out.append(max(-32768, min(32767, int(v))))
        if f[1] == 1: break                     # end
    return out

def read_table(d):
    ents = []; p = 0x11
    while True:
        e = d.index(b'\0', p); name = d[p:e].decode('latin1')
        if not name.endswith(('.mss', '.msb')): break
        off, size = struct.unpack_from('<II', d, e + 1); ents.append((name, off, size)); p = e + 9
    return ents

def unpack_mss(blob):
    flags, _, ch, rate, dsize = struct.unpack_from('<IIIII', blob, 0)
    hdr = 0x14 + 16 * ch
    data = blob[hdr:hdr + dsize]
    if ch == 1:
        return rate, 1, decode_adpcm(data)
    # stereo: frames interleaved L,R per 16-byte frame (verified by continuity test)
    L = decode_adpcm(b''.join(data[i:i + 16] for i in range(0, len(data) - 15, 32)))
    R = decode_adpcm(b''.join(data[i + 16:i + 32] for i in range(0, len(data) - 31, 32)))
    n = min(len(L), len(R)); mix = []
    for i in range(n): mix.append(L[i]); mix.append(R[i])
    return rate, 2, mix

def write_wav(path, rate, ch, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(ch); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(struct.pack('<%dh' % len(samples), *samples))

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]; filt = sys.argv[3:]
    d = open(src, 'rb').read()
    os.makedirs(dst, exist_ok=True)
    ents = read_table(d)
    done = 0
    for name, off, size in ents:
        if not name.endswith('.mss'): continue
        if filt and not any(f in name for f in filt): continue
        rate, ch, s = unpack_mss(d[off:off + size])
        write_wav(os.path.join(dst, name[:-4] + '.wav'), rate, ch, s)
        done += 1
    print('wrote', done, 'wav files to', dst)
