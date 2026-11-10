# The 2026-11-10 cleanup of Pyxl's sheet, kept as a record of exactly what changed (docs/PYXL.md §1).
# old sheet -> automatic stray-pixel pass (auto.py) -> hand patches (patches.py) -> checks -> new.png
# It was written against the sheet as of commit 13a806c: running it on the cleaned sheet would patch it twice.
#   git show 13a806c:assets/pyxl-pixel.webp > old.webp && python3 build.py old.webp   (needs Pillow)
# then save new.png as lossless WebP: Image.open('new.png').save('pyxl-pixel.webp', lossless=True, exact=True)
import sys
from px import *
from auto import despeckle
from patches import PATCHES
SRC = sys.argv[1] if len(sys.argv) > 1 else 'old.webp'
def build():
    old = load(SRC); g = [r[:] for r in old]
    for name, (sx, sy, w, h) in SPR.items(): despeckle(g, sx, sx + w)
    for name, rows in PATCHES.items():
        sx, sy, w, h = SPR[name]
        for (y, c0, s) in rows:
            for i, ch in enumerate(s):
                if ch in ' _': continue
                assert ch in PAL, (name, y, ch)
                assert 0 <= c0 + i < w, (name, y, c0, s)
                g[y][sx + c0 + i] = ch
    # checks: every coloured pixel on the silhouette is outline; nothing outside each pose's box changed
    H, W = len(g), len(g[0]); bad = []
    for y in range(H):
        for x in range(W):
            c = g[y][x]
            if c in '.#': continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = x + dx, y + dy
                if not (0 <= a < W and 0 <= b < H) or g[b][a] == '.': bad.append((x, y, c)); break
    for x, y, c in bad:
        n = next(k for k, (sx, sy, w, h) in SPR.items() if sx <= x < sx + w)
        print(f'OPEN EDGE {n} row {y} col {x - SPR[n][0]} {c}')
    for name, (sx, sy, w, h) in SPR.items():
        def box(q):
            ys = [y for y in range(H) if any(q[y][x] != '.' for x in range(sx, sx + w))]; xs = [x for x in range(sx, sx + w) if any(q[y][x] != '.' for y in range(H))]
            return (min(xs) - sx, min(ys), max(xs) - sx, max(ys))
        if box(old) != box(g): print('BOX CHANGED', name, box(old), box(g))
    return old, g
if __name__ == '__main__':
    old, g = build(); save(g, 'new.png')
    n = sum(1 for y in range(len(g)) for x in range(len(g[0])) if g[y][x] != old[y][x]); print('pixels changed', n)
