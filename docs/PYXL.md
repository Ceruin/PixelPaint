# Pyxl — how she's built, and how to make variants

This guide covers where Pyxl's art comes from, the rules it follows, how the app draws and
animates her, and step-by-step recipes for **colour variants**, **clothing / accessories** and
**new poses**. Keep it next to the art: if you change one of the numbers below, update it here too.

---

## 1. Where she came from

| When | What | Who |
|---|---|---|
| 2026-09-25 `a996efa` | First version: sprites **cut from the character sheet you supplied** (`assets/pip-art.webp`, `assets/pip-sprites.webp`). She was called Pip. | Claude |
| 2026-09-25 `f57ad58` | Rebuilt as **true pixel sprites** at the art's native resolution: one art pixel = one sprite pixel, one shared palette, specks removed, 1px outline. Atlas went from 233 KB to 9 KB. | Claude (code-driven cleanup) |
| 2026-09-25 `2f17f4f` | Front / side / back turnaround, idle variants, walk. | Claude |
| 2026-09-26 `3000533` | Merged near-duplicate shades (27 → 17 colours), removed stray pixels. | Ceruin |
| 2026-09-26 `52791ae` | **Hand-painted clean pass on all 18 sprites**: one light source (top-left), one shadow/base/light ramp per material, one outline colour, tail in every pose. Paint splats and Z's moved off the smock teal, so outfit recolours don't tint them. | Ceruin |

No special tools or outside references were used: it was your character sheet, then code that
quantised it to a palette and outlined it, then your hand pass. The cleanup scripts ran once in that
early session and were **not** saved to the repo. Everything since then (poses, recolouring, Zzz's,
physics, eggs) is code in `js/ui/mascot.js`.

---

## 2. The sprite sheet

**File:** `assets/pyxl-pixel.webp`. Lossless WebP, **1034 × 59 px**, a single row of 18 poses on a
transparent background.

**Hard rules** (the code relies on them):
- **Lossless only.** Every pixel is fully opaque or fully transparent (0 semi-transparent pixels
  today). A lossy export smears the palette and breaks the outfit recolour.
- **One art pixel = one sprite pixel.** The app only ever scales her by whole numbers (1×, 2×, 3×…).
  Never resample the sheet.
- **Exactly the palette in §3.** New colours are fine if they're deliberate. Keep them out of the
  teal range (§4) unless they're meant to recolour with her outfit.

### Pose table (`SPRITES` in `js/ui/mascot.js`)

Each entry is `[x, y, w, h, anchorX, feetY]`, in sheet pixels:

- **anchorX** is the **centre of her beret**, measured from the left of the pose's box. Every pose
  lines up on this point.
- **feetY** is the **line her feet stand on**, measured from the top of the box.

| Pose | x | y | w | h | anchorX | feetY | Notes |
|---|---|---|---|---|---|---|---|
| `front` | 0 | 6 | 34 | 53 | 15 | 51 | neutral idle |
| `frontBlink` | 35 | 6 | 34 | 53 | 15 | 51 | same as front, eyes shut |
| `side` | 70 | 7 | 31 | 52 | 17 | 50 | **faces left** natively |
| `back` | 102 | 8 | 33 | 51 | 16 | 50 | turnaround |
| `idle0` | 136 | 5 | 48 | 54 | 23 | 52 | walk cycle 1 |
| `idle1` | 185 | 5 | 50 | 54 | 22 | 52 | walk cycle 2 |
| `walk` | 236 | 5 | 51 | 54 | 22 | 52 | walk cycle 3 |
| `brush` | 288 | 5 | 61 | 54 | 22 | 52 | holding the brush |
| `paint` | 350 | 5 | 89 | 54 | 29 | 51 | painting stroke |
| `raise` | 440 | 1 | 56 | 58 | 20 | 54 | brush up. Also the pose she **hangs** from when carried |
| `point` | 497 | 1 | 59 | 58 | 23 | 53 | pointing |
| `floor` | 557 | 8 | 64 | 51 | 26 | 49 | sitting / tripped |
| `cheer` | 622 | 1 | 61 | 58 | 21 | 50 | |
| `spray` | 684 | 0 | 86 | 59 | 33 | 53 | fill / spray |
| `happy` | 771 | 0 | 64 | 59 | 22 | 55 | |
| `oops` | 836 | 0 | 62 | 59 | 23 | 55 | |
| `drowsy` | 899 | 5 | 58 | 54 | 21 | 48 | |
| `sleep` | 958 | 16 | 75 | 43 | 29 | 34 | the code wipes the baked Z's at 1011,18 (20×20 px) |

**Facing:**
- `side` is drawn facing **left**; every action pose faces **right**.
- The code mirrors poses as needed, so draw each pose once only.

**Other things that read the sheet:**
- **Boot splash** (`index.html`, `.sp-strip`): hard-codes the sheet size `1034 × 59` and an offset
  of `-133` px to show a walk frame. Update it if the sheet changes size.
- **Physics** (`js/ui/pyxlPhysics.js`): makes the rotated frames used when she's carried or thrown
  by upscaling a pose 4× with Scale2x twice, rotating, then sampling back at 1×. Clean outlines
  matter here: specks turn into visible noise when she rotates.

---

## 3. Palette

These are the **20 colours** in the sheet as it is now. "Uses" is read from the hue (dark mauves =
hair, reds = beret, and so on), so check against the art before relying on it.

| Hex | Pixels | Likely use | Recoloured with outfit? |
|---|---|---|---|
| `#221822` | 3906 | **outline** (the only outline colour) | no |
| `#402d3b` | 3408 | hair: shadow | no |
| `#5c3f4c` | 4717 | hair: base | no |
| `#7d5566` | 235 | hair: light | no |
| `#8b303b` | 1202 | beret: shadow | no |
| `#dc4749` | 3085 | beret: base | no |
| `#f47a5e` | 421 | beret: light / warm accent | no |
| `#a86655` | 225 | skin: shadow | no |
| `#eab8a0` | 414 | skin: mid | no |
| `#fbe4d3` | 1211 | skin: light | no |
| `#3d6f80` | 445 | **smock: shadow** | **yes** |
| `#559aa6` | 914 | **smock: base** | **yes** |
| `#86c5c0` | 74 | **smock: light** | **yes** |
| `#2a4fb8` | 81 | blue: shadow (eyes / paint) | no |
| `#427ede` | 265 | blue: base | no |
| `#c98f2e` | 28 | yellow: shadow (brush ferrule / paint) | no |
| `#f0c840` | 235 | yellow: base | no |
| `#d6ad6e` | 13 | yellow: light / wood | no |
| `#595c71` | 239 | cool grey (brush handle / shoes) | no |
| `#a8988f` | 515 | warm grey (shoes / soles) | no |

**Shading rule:** light comes from the **top-left** in every pose.
- Each material has a **shadow / base / light** ramp, and nothing else.
- Cast shadows (under the beret, under the bangs) use the material's own shadow colour.

---

## 4. How outfit recolouring works

In `js/ui/mascot.js`, `tinted(hex)` makes a recoloured copy of the sheet. Copies are cached, up to
12 colours.

- **Which pixels change:** any pixel whose **hue is 150°–205°, saturation > 0.25 and value > 0.2**
  counts as "smock", meaning the three teal colours above.
- **What they become:** the target colour's hue, with saturation and brightness scaled from the
  original. A 3-step ramp stays a 3-step ramp in the new colour.
- **Your first Pyxl** wears the colour you paint with: `setOutfit(app.color.fg)`. Greys and very
  dark colours are ignored, so she keeps her last bright outfit.
- **Shop-egg Pyxls** each wear their own `stats.colour` (the `FRIEND_COLOURS` list in
  `js/ui/pyxlStats.js`). Race rivals use the same mechanism.
- **Rule:** keep every other part of the art out of the teal hue band, or it will recolour too.
  That's why paint splats and Z's use blue and yellow ramps.

---

## 5. How the app draws her

- **One function** draws every pose: `drawPose(ctx, name, x, y, k, flip, breath, src)`.
  - `(x, y)` is where her **beret centre** and **feet line** go, in sprite pixels.
  - `k` is the whole-number scale.
  - `src` is the sheet, or a tinted copy of it.
- **Breathing:** everything above `feetY − 22` sinks 1px on the exhale. Keep heads and shoulders
  above that line and legs below it, so breathing looks natural.
- **Her box** is 92 × 76 sprite pixels (`BOX_W`, `BOX_H`). She stands at `AX = 36`, `FLOOR = 74`
  inside it. Wide poses are kept inside the box automatically.
- **States** (the `STATES` table) are sequences of poses with timing, for example
  `cheer: { poses: ['cheer','happy'], fps: 4, dur: 2200, hop: true }`. Flags such as
  `hop`, `shake`, `sway`, `breath`, `zzz`, `tears`, `notes` and `prop` add motion and effects in
  code, so the art itself stays a small set of key poses.
- **Drawn in code, not in the sheet:**
  - egg, hatch and cocoon (`drawOval`, `eggSprite`)
  - props: ball, radio, TV, crayons, hourglass (`js/ui/pixelArt.js`)
  - particle icons: hearts, Z's, notes (`js/ui/pixelIcons.js`)

---

## 6. Recipes

### A. A colour variant (hair, beret, skin…) — easiest

The palette is exact, so the cleanest approach is **exact colour swaps**. Hue detection is only
needed for the smock, because it follows the brush.

1. Pick a full **shadow / base / light** ramp for each material you're changing, for example a
   blue beret: `#8b303b → #2c3f8a`, `#dc4749 → #4a6fe0`, `#f47a5e → #8fb0ff`. Keep about the same
   brightness steps as the original, so the hand-painted shading still reads.
2. Write it as a variant:
   ```js
   // js/ui/pyxlVariants.js (not in the app yet — see §7)
   export const VARIANTS = {
     classic: {},
     bluebird: { '#8b303b': '#2c3f8a', '#dc4749': '#4a6fe0', '#f47a5e': '#8fb0ff' },
     ginger:   { '#402d3b': '#7a3a1c', '#5c3f4c': '#b5602a', '#7d5566': '#e08a44' },
   };
   ```
3. Never swap the outline `#221822`, and keep new colours out of the teal band.

### B. Clothing and accessories — a "paper doll" overlay sheet

Keep the base sheet untouched and draw clothing in **matching overlay sheets**:

1. Copy `assets/pyxl-pixel.webp` to `assets/wear/<item>.webp`. That gives you the same 1034 × 59
   canvas, with the same poses in the same places.
2. On a layer above the base, paint the item **on every pose it should appear in**. Erase
   everything that isn't the item, so the file holds only the item's pixels.
3. **Covering parts of her** (a hat replacing the beret): paint pure **magenta `#ff00ff`** where
   the base should disappear. Overlays draw after the base; magenta pixels erase the base instead
   of drawing.
4. Follow the same rules:
   - 1px `#221822` outline where the item meets the background.
   - Top-left light.
   - A shadow / base / light ramp per material.
   - No semi-transparent pixels.
   - Lossless export.
5. **Recolourable clothing:** paint it in the teal band, and it follows her outfit colour like the
   smock does.
6. **Fit:** each pose's box and anchor are fixed (§2 table). Keep the item inside the pose's box,
   or it will be cut off.

Suggested slots, so items don't fight: `hat` (replaces the beret), `face` (glasses), `neck`
(scarf, bow), `body` (over the smock), `hand` (held props) and `back` (wings, cape). Draw `back`
**before** the base, and the others after it.

### C. A new pose

1. Widen the sheet and add the pose **to the right of `sleep`**, on transparent background, top
   aligned like the others.
2. Measure:
   - the box `x, y, w, h`
   - `anchorX`, the centre of the beret, from the box's left
   - `feetY`, the feet line, from the box's top
3. Add an entry to `SPRITES` in `js/ui/mascot.js`.
4. Use it in a state, for example `jump: { poses: ['crouch', 'cheer'], fps: 6, dur: 900, hop: true }`.
5. If the sheet's width changed, update `1034` in `index.html` (`.sp-strip`).
6. Add the pose to every overlay sheet (§B) that should show on it.

### D. Tools for the art

- **Any pixel editor with a 1:1 grid works**, for example PixelPaint's Sprite Studio or Aseprite.
  Use a hard 1px pencil and eraser, with no anti-aliasing or smoothing.
- Load the §3 colours as a palette and stick to them.
- Flip between neighbouring poses (onion skin, if your editor has it) to keep proportions
  consistent, e.g. the walk frames `idle0 → idle1 → walk`.
- Export a PNG, then convert it to **lossless** WebP, e.g. `cwebp -lossless -exact in.png -o out.webp`.

---

## 7. Checklist before committing art

- [ ] Lossless file with 0 semi-transparent pixels.
- [ ] Colours: the 20 above plus any you added on purpose; nothing new in the teal band by accident.
- [ ] One outline colour (`#221822`), light from the top-left.
- [ ] Every pose's beret centre and feet line still match the `SPRITES` table.
- [ ] Checked in the app:
  - idle (breathing and blinking)
  - walking
  - being carried (hanging from `raise`) and thrown (rotated frames)
  - sleeping (the Z's)
  - in a race (tinted rivals)
  - with a bright and a dark brush colour (recolour)

**Not built yet** (ask and it can be added):
- `VARIANTS` palette swaps (§A), plus a picker in her Chart tab.
- The overlay "wear" system (§B): load `assets/wear/*.webp`, draw slots in order with magenta
  masking, and make items buyable in the Shop.
- A small script that checks a sheet against this checklist.
