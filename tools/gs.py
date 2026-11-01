"""PS2 GS local-memory address model. Textures are uploaded in one pixel format and read in another;
that is the whole 'swizzle'. Block/column tables follow the GS layout (as in PCSX2's GSLocalMemory).
"""
PAGE = 8192

BLOCK32 = [[0, 1, 4, 5, 16, 17, 20, 21], [2, 3, 6, 7, 18, 19, 22, 23], [8, 9, 12, 13, 24, 25, 28, 29], [10, 11, 14, 15, 26, 27, 30, 31]]
COL32 = [[0, 1, 4, 5, 8, 9, 12, 13], [2, 3, 6, 7, 10, 11, 14, 15]]
BLOCK16 = [[0, 2, 8, 10], [1, 3, 9, 11], [4, 6, 12, 14], [5, 7, 13, 15], [16, 18, 24, 26], [17, 19, 25, 27], [20, 22, 28, 30], [21, 23, 29, 31]]
COL16 = [[0, 2, 8, 10, 16, 18, 24, 26, 1, 3, 9, 11, 17, 19, 25, 27], [4, 6, 12, 14, 20, 22, 28, 30, 5, 7, 13, 15, 21, 23, 29, 31]]
BLOCK8 = BLOCK32
COL8 = [
    [0, 4, 16, 20, 32, 36, 48, 52, 2, 6, 18, 22, 34, 38, 50, 54],
    [8, 12, 24, 28, 40, 44, 56, 60, 10, 14, 26, 30, 42, 46, 58, 62],
    [33, 37, 49, 53, 1, 5, 17, 21, 35, 39, 51, 55, 3, 7, 19, 23],
    [41, 45, 57, 61, 9, 13, 25, 29, 43, 47, 59, 63, 11, 15, 27, 31],
    [96, 100, 112, 116, 64, 68, 80, 84, 98, 102, 114, 118, 66, 70, 82, 86],
    [104, 108, 120, 124, 72, 76, 88, 92, 106, 110, 122, 126, 74, 78, 90, 94],
    [65, 69, 81, 85, 97, 101, 113, 117, 67, 71, 83, 87, 99, 103, 115, 119],
    [73, 77, 89, 93, 105, 109, 121, 125, 75, 79, 91, 95, 107, 111, 123, 127],
]
COL8 = COL8 + [[v + 128 for v in row] for row in COL8]
BLOCK4 = BLOCK16
COL4 = [
    [0, 8, 32, 40, 64, 72, 96, 104, 2, 10, 34, 42, 66, 74, 98, 106, 4, 12, 36, 44, 68, 76, 100, 108, 6, 14, 38, 46, 70, 78, 102, 110],
    [16, 24, 48, 56, 80, 88, 112, 120, 18, 26, 50, 58, 82, 90, 114, 122, 20, 28, 52, 60, 84, 92, 116, 124, 22, 30, 54, 62, 86, 94, 118, 126],
    [65, 73, 97, 105, 1, 9, 33, 41, 67, 75, 99, 107, 3, 11, 35, 43, 69, 77, 101, 109, 5, 13, 37, 45, 71, 79, 103, 111, 7, 15, 39, 47],
    [81, 89, 113, 121, 17, 25, 49, 57, 83, 91, 115, 123, 19, 27, 51, 59, 85, 93, 117, 125, 21, 29, 53, 61, 87, 95, 119, 127, 23, 31, 55, 63],
    [192, 200, 224, 232, 128, 136, 160, 168, 194, 202, 226, 234, 130, 138, 162, 170, 196, 204, 228, 236, 132, 140, 164, 172, 198, 206, 230, 238, 134, 142, 166, 174],
    [208, 216, 240, 248, 144, 152, 176, 184, 210, 218, 242, 250, 146, 154, 178, 186, 212, 220, 244, 252, 148, 156, 180, 188, 214, 222, 246, 254, 150, 158, 182, 190],
    [129, 137, 161, 169, 193, 201, 225, 233, 131, 139, 163, 171, 195, 203, 227, 235, 133, 141, 165, 173, 197, 205, 229, 237, 135, 143, 167, 175, 199, 207, 231, 239],
    [145, 153, 177, 185, 209, 217, 241, 249, 147, 155, 179, 187, 211, 219, 243, 251, 149, 157, 181, 189, 213, 221, 245, 253, 151, 159, 183, 191, 215, 223, 247, 255],
]
COL4 = COL4 + [[v + 256 for v in row] for row in COL4]

# (page w, page h, block w, block h, blocktable, coltable, bytes per unit, units per byte)
FMT = {
    32: (64, 32, 8, 8, BLOCK32, COL32),
    16: (64, 64, 16, 8, BLOCK16, COL16),
    8: (128, 64, 16, 16, BLOCK8, COL8),
    4: (128, 128, 32, 16, BLOCK4, COL4),
}

def addr(fmt, x, y, pages_per_row):
    """Return (byte address, sub-index) of pixel (x,y) in a buffer `pages_per_row` pages wide."""
    pw, ph, bw, bh, BT, CT = FMT[fmt]
    page = (y // ph) * pages_per_row + (x // pw)
    lx, ly = x % pw, y % ph
    block = BT[ly // bh][lx // bw]
    bx, by = lx % bw, ly % bh
    if fmt == 32:
        idx = CT[by & 1][bx] + (by >> 1) * 16
        return page * PAGE + block * 256 + idx * 4, 0
    if fmt == 16:
        idx = CT[by & 1][bx] + (by >> 1) * 32
        return page * PAGE + block * 256 + idx * 2, 0
    if fmt == 8:
        idx = CT[by][bx]
        return page * PAGE + block * 256 + idx, 0
    idx = CT[by][bx]           # nibble index 0..511
    return page * PAGE + block * 256 + (idx >> 1), idx & 1

def unswizzle(data, w, h, read_fmt, write_fmt, write_w, write_h):
    """Data was uploaded as `write_fmt` with dimensions write_w x write_h; read it back as `read_fmt` w x h.
    Returns list of pixel values (indices for 4/8 bit)."""
    bpp_w = {32: 4, 16: 2, 8: 1}[write_fmt]
    ppr = max(1, write_w // FMT[write_fmt][0])
    # map GS byte address -> position in upload stream
    amap = {}
    for row in range(write_h):
        for col in range(write_w):
            a, _ = addr(write_fmt, col, row, ppr)
            amap[a] = (row * write_w + col) * bpp_w
    out = [0] * (w * h)
    ppr_r = max(1, w // FMT[read_fmt][0])
    for y in range(h):
        for x in range(w):
            a, sub = addr(read_fmt, x, y, ppr_r)
            base = a - (a % bpp_w)
            src = amap[base] + (a % bpp_w)
            b = data[src]
            if read_fmt == 4:
                out[y * w + x] = (b >> (4 * sub)) & 0xf
            else:
                out[y * w + x] = b
    return out


_LUT = {}
def lut4(w, h, ww, wh):
    """Per-texel (byte offset, nibble) for a PSMT4 w x h texture uploaded as PSMCT16 ww x wh. Cached."""
    key = (w, h, ww, wh)
    if key not in _LUT:
        ppr = max(1, ww // 64)
        amap = {}
        for row in range(wh):
            for col in range(ww):
                a, _ = addr(16, col, row, ppr)
                amap[a] = (row * ww + col) * 2
        ppr_r = max(1, w // 128)
        lut = []
        for y in range(h):
            for x in range(w):
                a, sub = addr(4, x, y, ppr_r)
                lut.append((amap[a - (a & 1)] + (a & 1), sub))
        _LUT[key] = lut
    return _LUT[key]

def unswizzle4_ct16(data, w, h, ww, wh):
    lut = lut4(w, h, ww, wh)
    return bytes((data[o] >> (4 * n)) & 0xf for o, n in lut)
