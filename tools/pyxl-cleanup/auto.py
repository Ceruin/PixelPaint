# automatic pass: stray pixels (tiny islands of one colour sitting inside another) melt into what surrounds them
from px import *
PROTECT = set('YywBbn')
FAMILY = {'d': 'hair', 'h': 'hair', 'l': 'hair', 'T': 'teal', 't': 'teal', 'c': 'teal', 'R': 'red', 'r': 'red', 'o': 'red', 'S': 'skin', 's': 'skin', 'G': 'grey', 'g': 'grey'}
def despeckle(g, x0, x1, log=None):
    H = len(g); seen = set(); changes = []
    def n8(x, y): return [(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and x0 <= x + dx < x1 and 0 <= y + dy < H]
    for y in range(H):
        for x in range(x0, x1):
            c = g[y][x]
            if c == '.' or (x, y) in seen or c in PROTECT: continue
            comp = [(x, y)]; seen.add((x, y)); i = 0
            while i < len(comp):
                for q in n8(*comp[i]):
                    if q not in seen and g[q[1]][q[0]] == c: seen.add(q); comp.append(q)
                i += 1
            limit = 2 if c in 'dh' else 1
            if len(comp) > limit: continue
            ring = {q for p in comp for q in n8(*p)} - set(comp)
            cols = [g[b][a] for a, b in ring]
            if '.' in cols: continue                         # on the silhouette: leave the outline alone
            if c == '#':
                if cols.count('#') > 0: continue
            if c in 'Ss' and cols.count('#') + cols.count('d') >= 3 and any(k in 'Ss' for k in cols) is False: continue   # an eye's glint
            if c in 'Ss' and cols.count('#') >= 4: continue  # eye glint
            if c == 'c' and '#' in cols: continue            # rim light
            if c in 'Ss': continue                           # faces and hands are left to the hand pass
            cnt = {}
            for k in cols:
                if k != '#': cnt[k] = cnt.get(k, 0) + 1
            if not cnt: continue
            # only into its own family (hair into hair, teal into teal…); a dark speck inside hair counts as hair
            fam = [k for k in cnt if k != c and (FAMILY.get(k) == FAMILY.get(c) or (c == '#' and FAMILY.get(k) == 'hair'))]
            if not fam: continue
            best = max(fam, key=cnt.get)
            if sum(cnt[k] for k in fam) < len(cols) * 0.5: continue
            if best == c: continue
            for a, b in comp: changes.append((a, b, c, best))
    for a, b, c, best in changes: g[b][a] = best
    return changes
if __name__ == '__main__':
    import sys; g = load(sys.argv[1])
    for name, (sx, sy, w, h) in SPR.items():
        ch = despeckle(g, sx, sx + w)
        from collections import Counter
        print(name, len(ch), dict(Counter(f'{c}>{b}' for _, _, c, b in ch)))
    save(g, 'auto.png')
