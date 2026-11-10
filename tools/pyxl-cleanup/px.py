# pixel helpers: load the sheet as a char grid (one letter per palette colour), save it back
from PIL import Image
PAL = {'.': None, '#': '221822', 'd': '402d3b', 'h': '5c3f4c', 'l': '7d5566', 'R': 'dc4749', 'r': '8b303b', 'o': 'f47a5e', 'S': 'fbe4d3', 's': 'eab8a0',
       'T': '559aa6', 't': '3d6f80', 'c': '86c5c0', 'G': 'a8988f', 'g': '595c71', 'B': '427ede', 'b': '2a4fb8', 'Y': 'f0c840', 'y': 'c98f2e', 'w': 'd6ad6e', 'n': 'a86655'}
RGB = {k: (tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,) if v else (0, 0, 0, 0)) for k, v in PAL.items()}
INV = {v: k for k, v in RGB.items()}
SPR = dict(front=[0,6,34,53], frontBlink=[35,6,34,53], side=[70,7,31,52], back=[102,8,33,51], idle0=[136,5,48,54], idle1=[185,5,50,54], walk=[236,5,51,54], brush=[288,5,61,54],
  paint=[350,5,89,54], raise_=[440,1,56,58], point=[497,1,59,58], floor=[557,8,64,51], cheer=[622,1,61,58], spray=[684,0,86,59], happy=[771,0,64,59], oops=[836,0,62,59], drowsy=[899,5,58,54], sleep=[958,16,75,43])
def load(path):
    im = Image.open(path).convert('RGBA'); w, h = im.size; p = im.load()
    return [[INV[p[x, y] if p[x, y][3] else (0, 0, 0, 0)] for x in range(w)] for y in range(h)]
def save(g, path, **kw):
    h, w = len(g), len(g[0]); im = Image.new('RGBA', (w, h)); p = im.load()
    for y in range(h):
        for x in range(w): p[x, y] = RGB[g[y][x]]
    im.save(path, **kw)
def dump(g, name, y0=0, y1=59):
    x, _, w, _ = SPR[name]
    print(f'--- {name} x0={x} w={w}   cols:')
    print('    ' + ''.join(str(i // 10 % 10) for i in range(w)))
    print('    ' + ''.join(str(i % 10) for i in range(w)))
    for y in range(y0, y1): print(f'{y:2d}  ' + ''.join(g[y][x:x + w]))
