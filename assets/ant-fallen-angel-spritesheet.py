# -*- coding: utf-8 -*-
# AnT (Akuma no Tenshi) - Fallen Angel hoodie design
# 32x32 pixel-art character + animation frames.
# Renders a preview PNG (pure stdlib) and the final SVG spritesheet.

import zlib, struct, os, math

S = 32  # sprite size

# ---------------------------------------------------------------- palette
PAL = {
    '.': None,
    'o': (0x24,0x20,0x2e),   # outline
    'O': (0x35,0x2f,0x42),   # soft outline
    'H': (0xf2,0xc4,0x4c),   # gold
    'h': (0xff,0xe6,0x9a),   # gold highlight
    'g': (0xc9,0x97,0x2e),   # gold shadow
    'r': (0xbd,0xac,0x82),   # hair mid
    'R': (0xdb,0xcb,0xa2),   # hair highlight
    'd': (0x93,0x84,0x5f),   # hair shadow
    's': (0xf3,0xd7,0xba),   # skin
    'k': (0xdd,0xb4,0x92),   # skin shadow
    'K': (0xc9,0x9c,0x7c),   # skin deep shadow
    'e': (0x4a,0x40,0x5e),   # eye
    'm': (0xc9,0x86,0x86),   # mouth/blush
    'w': (0xec,0xe6,0xd6),   # wing feather
    'W': (0xff,0xfb,0xf0),   # wing highlight
    'v': (0xcf,0xc6,0xb1),   # wing shadow
    'V': (0xb2,0xa8,0x90),   # wing feather line
    'c': (0xf1,0xeb,0xdb),   # hoodie base
    'C': (0xff,0xfc,0xf3),   # hoodie highlight
    'x': (0xd8,0xd0,0xbd),   # hoodie shadow
    'X': (0xbe,0xb5,0x9e),   # hoodie deep shadow
    'p': (0xa8,0x9d,0x84),   # drawstring / seam
    'b': (0xf2,0xc4,0x4c),   # bracelet gold
    'n': (0xe6,0xc3,0xa1),   # bare foot skin
    't': (0x8a,0x63,0x3d),   # sandal leather
    'T': (0xa8,0x7c,0x4e),   # sandal highlight
}

def blank():
    return [['.' for _ in range(S)] for _ in range(S)]

def px(g,x,y,c):
    if 0<=x<S and 0<=y<S and c!='.':
        g[y][x]=c

def hline(g,x0,x1,y,c):
    if x0>x1: x0,x1=x1,x0
    for x in range(x0,x1+1): px(g,x,y,c)

def vline(g,x,y0,y1,c):
    if y0>y1: y0,y1=y1,y0
    for y in range(y0,y1+1): px(g,x,y,c)

def rect(g,x0,y0,x1,y1,c):
    for y in range(y0,y1+1): hline(g,x0,x1,y,c)

def stamp(g, x0, y0, rows):
    for j,row in enumerate(rows):
        for i,ch in enumerate(row):
            if ch!='.':
                px(g, x0+i, y0+j, ch)

# ---------------------------------------------------------------- wing
WING = [
    ".....vv.",
    "...vvWWv",
    "..vwWWWv",
    ".vwwWWvV",
    "vwwwWvvV",
    "vwwwvvV.",
    ".vwwvV..",
    ".vwvvV..",
    "..vVV...",
]
def draw_wing(g, anchor_x, anchor_y, mirror=False, dy=0, spread=0):
    rows=WING
    for j,row in enumerate(rows):
        for i,ch in enumerate(row):
            if ch=='.': continue
            xx = i
            if mirror:
                x = anchor_x - (len(row)-1-xx) - (spread if j>3 else 0)
            else:
                x = anchor_x + xx + (spread if j>3 else 0)
            y = anchor_y + j + dy
            px(g,x,y,ch)

# ---------------------------------------------------------------- head
HEAD = [
    "....dddddd....",
    "..ddrrrrrrdd..",
    ".drrrRRRrrrrd.",
    ".drrRRRRRrrrd.",
    "drrdssssskdrrd",
    "drdssssssskdrd",
    "rdssssssssskdr",
    "rdsseskesskddr",
    "rdssssssssskdr",
    ".dsskssssskkd.",
    ".dKsssmssssKd.",
    "..dKkssskKd...",
    "...dkkkkkd....",
]
def draw_head(g, x0, y0):
    stamp(g, x0, y0, HEAD)

# ---------------------------------------------------------------- body / hoodie robe
def draw_hoodie(g, cx, top, lean=0, arm='rest'):
    rect(g, cx-6, top-1, cx+5, top, 'x')
    px(g,cx-6,top-1,'X'); px(g,cx+5,top-1,'X')
    bottom = 27
    for y in range(top, bottom+1):
        t = (y-top)/(bottom-top)
        half = 6 + int(t*6.2)
        ox = int(round(lean * (1-t)))
        L = cx - half + ox
        Rr = cx + half + ox
        hline(g, L, Rr, y, 'c')
        px(g,L,y,'X'); px(g,Rr,y,'X')
        px(g,L+1,y,'C')
        px(g,Rr-1,y,'x'); px(g,Rr-2,y,'x')
    hline(g, cx-12, cx+12, bottom, 'X')
    for x in range(cx-11,cx+12,2):
        px(g,x,bottom,'x')
    for i in range(5):
        px(g, cx-3+i, top+1+i, 'x')
        px(g, cx+2-i, top+1+i, 'x')
    px(g,cx-1,top+1,'X'); px(g,cx,top+1,'X')
    rect(g, cx-5, top+9, cx+4, top+13, 'x')
    hline(g, cx-5, cx+4, top+9, 'p')
    px(g,cx-5,top+9,'X'); px(g,cx+4,top+9,'X')
    vline(g, cx-2, top+1, top+5, 'p')
    vline(g, cx+1, top+1, top+5, 'p')
    px(g,cx-2,top+6,'h'); px(g,cx+1,top+6,'h')
    draw_arms(g, cx, top, lean, arm)

def draw_arms(g, cx, top, lean, arm):
    if arm=='rest':
        rect(g, cx-8, top+2, cx-6, top+11, 'c')
        rect(g, cx+5, top+2, cx+7, top+11, 'c')
        px(g,cx-8,top+2,'X'); px(g,cx+7,top+2,'X')
        vline(g,cx-8,top+3,top+11,'x'); vline(g,cx+7,top+3,top+11,'x')
        px(g,cx-7,top+3,'C')
        hline(g,cx-8,cx-6,top+9,'b'); hline(g,cx+5,cx+7,top+9,'b')
        rect(g,cx-6,top+10,cx-4,top+12,'n'); rect(g,cx+3,top+10,cx+5,top+12,'n')
    elif arm=='throw':
        rect(g, cx+5, top-4, cx+7, top+4, 'c')
        px(g,cx+7,top-4,'X'); vline(g,cx+7,top-3,top+4,'x')
        hline(g,cx+5,cx+7,top-2,'b')
        rect(g,cx+5,top-6,cx+7,top-4,'n')
        rect(g, cx-8, top+2, cx-6, top+11, 'c')
        px(g,cx-8,top+2,'X'); vline(g,cx-8,top+3,top+11,'x')
        hline(g,cx-8,cx-6,top+9,'b'); rect(g,cx-6,top+10,cx-4,top+12,'n')
    elif arm=='hold':
        rect(g, cx-8, top+4, cx-5, top+12, 'c'); rect(g, cx+4, top+4, cx+7, top+12, 'c')
        px(g,cx-8,top+4,'X'); px(g,cx+7,top+4,'X')
        hline(g,cx-8,cx-6,top+11,'b'); hline(g,cx+5,cx+7,top+11,'b')
        rect(g,cx-7,top+12,cx-5,top+14,'n'); rect(g,cx+5,top+12,cx+7,top+14,'n')

# ---------------------------------------------------------------- halo
def draw_halo(g, cx, cy, rx=6):
    for a in range(0,360,6):
        x = cx + rx*math.cos(math.radians(a))
        y = cy + (rx*0.34)*math.sin(math.radians(a))
        c = 'h' if math.sin(math.radians(a))<0 else 'H'
        px(g, int(round(x)), int(round(y)), c)
    px(g,cx-2,cy+2,'g'); px(g,cx+2,cy+2,'g')

# ---------------------------------------------------------------- feet
def draw_feet(g, cx, y, pose='stand', step=0):
    lx = cx-4; rx = cx+2
    if pose=='walk':
        lx += step; rx -= step
    for (fx,fy) in [(lx,y),(rx,y)]:
        rect(g,fx,fy,fx+2,fy+1,'n')
        hline(g,fx,fx+2,fy+2,'t')
        px(g,fx+1,fy,'T')
        px(g,fx,fy+2,'o')

# ================================================================ frame builders
def base_char(bob=0, lean=0, arm='rest', wing_dy=0, wing_spread=0,
              halo=(16,2), feet='stand', step=0, hidewing=False, extra=None):
    g=blank()
    top = 12 + bob
    cx = 16
    if not hidewing:
        draw_wing(g, cx-6, 9+bob+wing_dy, mirror=True, spread=wing_spread)
        draw_wing(g, cx+5, 9+bob+wing_dy, mirror=False, spread=wing_spread)
    if feet is not None:
        draw_feet(g, cx, 28, pose=('walk' if feet=='walk' else 'stand'), step=step)
    draw_hoodie(g, cx, top, lean=lean, arm=arm)
    draw_head(g, cx-7+lean, 3+bob)
    if halo is not None:
        draw_halo(g, halo[0], halo[1]+bob)
    if extra: extra(g)
    return g

def thrown_halo(pos, trail=0):
    def f(g):
        x,y=pos
        # small spinning halo ring
        px(g,x-2,y,'h'); px(g,x-1,y-1,'H'); px(g,x,y-1,'H'); px(g,x+1,y,'h')
        px(g,x-1,y+1,'g'); px(g,x,y+1,'g'); px(g,x+2,y,'H')
        # motion streak behind
        for t in range(1,trail+1):
            px(g,x-2-t,y,'g')
    return f

def build_frames():
    frames={}
    frames['IDLE']=[
        base_char(bob=0, wing_dy=0),
        base_char(bob=0, wing_dy=0),
        base_char(bob=1, wing_dy=1),
        base_char(bob=1, wing_dy=1),
    ]
    frames['WALK']=[
        base_char(bob=0, lean=1, feet='walk', step=-1, wing_dy=0),
        base_char(bob=1, lean=1, feet='walk', step=0,  wing_dy=1),
        base_char(bob=0, lean=1, feet='walk', step=1,  wing_dy=0),
        base_char(bob=1, lean=1, feet='walk', step=0,  wing_dy=1),
    ]
    frames['RUN']=[
        base_char(bob=0, lean=2, feet='walk', step=-2, wing_dy=-1, wing_spread=1),
        base_char(bob=1, lean=3, feet='walk', step=0,  wing_dy=0,  wing_spread=1),
        base_char(bob=0, lean=2, feet='walk', step=2,  wing_dy=-1, wing_spread=1),
        base_char(bob=1, lean=3, feet='walk', step=0,  wing_dy=0,  wing_spread=1),
    ]
    frames['JUMP']=[
        base_char(bob=2, lean=1, feet='walk', step=0, wing_dy=1, wing_spread=0),
        base_char(bob=-2, lean=0, feet=None, wing_dy=-2, wing_spread=2),
        None, None,
    ]
    frames['THROW']=[
        base_char(bob=1, lean=-1, arm='rest'),
        base_char(bob=0, lean=1,  arm='throw'),
        base_char(bob=0, lean=2,  arm='throw', halo=None, extra=thrown_halo((22,3),trail=2)),
        base_char(bob=0, lean=2,  arm='throw', halo=None, extra=thrown_halo((27,4),trail=3)),
        base_char(bob=1, lean=1,  arm='throw', halo=None, extra=thrown_halo((30,6),trail=3)),
        base_char(bob=1, lean=0,  arm='rest',  halo=None),
    ]
    def shake(offx, halo_y):
        g=blank()
        cx=16
        draw_wing(g, cx-6+offx, 9, mirror=True)
        draw_wing(g, cx+5+offx, 9, mirror=False)
        draw_feet(g, cx, 28)
        draw_hoodie(g, cx+offx, 12, lean=offx, arm='hold')
        draw_head(g, cx-7+offx, 3)
        draw_halo(g, cx+offx, halo_y)
        px(g,cx-11,14,'O'); px(g,cx+12,14,'O')
        return g
    frames['SHAKE']=[
        shake(-1,20), shake(1,21), shake(-1,20), shake(2,22), shake(-2,20),
    ]
    return frames

# ================================================================ PNG preview
def png_write(path, pixels, w, h):
    def chunk(typ,data):
        c=struct.pack(">I",len(data))+typ+data
        return c+struct.pack(">I", zlib.crc32(typ+data)&0xffffffff)
    raw=bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r,g,b,a=pixels[y*w+x]
            raw+=bytes((r,g,b,a))
    comp=zlib.compress(bytes(raw),9)
    sig=b'\x89PNG\r\n\x1a\n'
    ihdr=struct.pack(">IIBBBBB",w,h,8,6,0,0,0)
    with open(path,'wb') as f:
        f.write(sig+chunk(b'IHDR',ihdr)+chunk(b'IDAT',comp)+chunk(b'IEND',b''))

# ================================================================ layout
SECTIONS=[('IDLE',4),('WALK',4),('RUN',4),('JUMP',4),('THROW',6),('SHAKE',5)]
BG=(0x2b,0x2f,0x38); CELL=(0x23,0x27,0x2f)

def render_preview(frames, scale=5, path='preview.png'):
    grid=[[SECTIONS[0],SECTIONS[1]],[SECTIONS[2],SECTIONS[3]],[SECTIONS[4],SECTIONS[5]]]
    pad=8; label_h=14; cellgap=4; title_h=26
    cs=S*scale
    def sec_w(n): return n*cs+(n-1)*cellgap
    col_w=[ max(sec_w(grid[r][0][1]) for r in range(3)),
            max(sec_w(grid[r][1][1]) for r in range(3)) ]
    colgap=24
    W = pad + col_w[0] + colgap + col_w[1] + pad
    row_h = label_h + cs + pad
    H = title_h + pad + 3*row_h + pad
    buf=[BG+(255,) for _ in range(W*H)]
    def setp(x,y,rgba):
        if 0<=x<W and 0<=y<H: buf[y*W+x]=rgba
    def fill(x0,y0,x1,y1,rgb):
        for y in range(y0,y1):
            for x in range(x0,x1): setp(x,y,rgb+(255,))
    def blit(gr,ox,oy):
        for yy in range(S):
            for xx in range(S):
                ch=gr[yy][xx]; col=PAL[ch]
                if col is None: continue
                for sy in range(scale):
                    for sx in range(scale):
                        setp(ox+xx*scale+sx, oy+yy*scale+sy, col+(255,))
    y0=title_h
    for r in range(3):
        for c in range(2):
            name,n=grid[r][c]
            ox = pad + (0 if c==0 else col_w[0]+colgap)
            oy = y0 + pad + r*row_h
            for i in range(n):
                cx0=ox+i*(cs+cellgap); cy0=oy+label_h
                fill(cx0,cy0,cx0+cs,cy0+cs,CELL)
                fr=frames[name][i]
                if fr is not None: blit(fr,cx0,cy0)
    png_write(path,buf,W,H)
    return W,H

def render_svg(frames, scale=6, path='ant-spritesheet.svg'):
    grid=[[SECTIONS[0],SECTIONS[1]],[SECTIONS[2],SECTIONS[3]],[SECTIONS[4],SECTIONS[5]]]
    pad=16; label_h=22; cellgap=6; colgap=40; title_h=52
    cs=S*scale
    def sec_w(n): return n*cs+(n-1)*cellgap
    col_w=[ max(sec_w(grid[r][0][1]) for r in range(3)),
            max(sec_w(grid[r][1][1]) for r in range(3)) ]
    W = pad + col_w[0] + colgap + col_w[1] + pad
    row_h = label_h + cs + pad + 6
    H = title_h + pad + 3*row_h + pad
    def hx(rgb): return '#%02x%02x%02x'%rgb
    out=[]
    out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
               f'viewBox="0 0 {W} {H}" shape-rendering="crispEdges" '
               f'font-family="\'Courier New\',monospace">')
    out.append(f'<rect width="{W}" height="{H}" fill="{hx(BG)}"/>')
    out.append(f'<rect x="0" y="0" width="{W}" height="{title_h-14}" fill="{hx((0x1f,0x22,0x29))}"/>')
    out.append(f'<text x="{pad}" y="30" fill="#f1ebdb" font-size="26" font-weight="bold" '
               f'letter-spacing="2">AnT CHARACTER SPRITESHEET '
               f'<tspan fill="#9aa1b1" font-size="16">(32x32 PIXEL ART)</tspan></text>')
    def draw_frame(gr,ox,oy):
        parts=[f'<g transform="translate({ox},{oy})">']
        for y in range(S):
            x=0
            while x<S:
                ch=gr[y][x]
                if ch=='.' or PAL[ch] is None:
                    x+=1; continue
                x2=x
                while x2+1<S and gr[y][x2+1]==ch: x2+=1
                w=(x2-x+1)*scale
                parts.append(f'<rect x="{x*scale}" y="{y*scale}" width="{w}" '
                             f'height="{scale}" fill="{hx(PAL[ch])}"/>')
                x=x2+1
        parts.append('</g>')
        return ''.join(parts)
    for r in range(3):
        for c in range(2):
            name,n=grid[r][c]
            ox = pad + (0 if c==0 else col_w[0]+colgap)
            oy = title_h + pad + r*row_h
            out.append(f'<text x="{ox}" y="{oy+15}" fill="#f1ebdb" font-size="15" '
                       f'font-weight="bold" letter-spacing="1">AnT {name}</text>')
            for i in range(n):
                cx0=ox+i*(cs+cellgap); cy0=oy+label_h
                fr=frames[name][i]
                if fr is None:
                    out.append(f'<rect x="{cx0}" y="{cy0}" width="{cs}" height="{cs}" '
                               f'fill="none" stroke="#454b58" stroke-dasharray="4 4"/>')
                    out.append(f'<text x="{cx0+cs/2}" y="{cy0+cs/2+4}" fill="#5a6170" '
                               f'font-size="12" text-anchor="middle">empty</text>')
                    continue
                out.append(f'<rect x="{cx0}" y="{cy0}" width="{cs}" height="{cs}" '
                           f'fill="{hx(CELL)}" stroke="#20242c"/>')
                out.append(draw_frame(fr,cx0,cy0))
    out.append(f'<text x="{W-pad}" y="{H-12}" fill="#5a6170" font-size="12" '
               f'text-anchor="end" letter-spacing="1">SHAKEDOWN CHARACTERS</text>')
    out.append('</svg>')
    with open(path,'w') as f: f.write('\n'.join(out))
    return W,H

if __name__=='__main__':
    frames=build_frames()
    here=os.path.dirname(os.path.abspath(__file__))
    w,h=render_preview(frames, scale=5, path=os.path.join(here,'preview.png'))
    print('preview',w,h)
    W,H=render_svg(frames, scale=6, path=os.path.join(here,'ant-spritesheet.svg'))
    print('svg',W,H)
