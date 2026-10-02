# Making a new character

How to build a **brand-new character** (not a skin of Pyxl) that can drop into PixelPaint. Use the
same small, chunky pixel style as Pyxl and draw the same 18 poses, so every state in the app (idle,
walking, being carried, sleeping, racing) has a frame to show.

For colour swaps and clothing *on Pyxl*, see `docs/PYXL.md` §6 instead.

The worked example is **Piton**, a little mountain climber.

![Piton's sheet](../assets/characters/piton-pixel.png)

---

## 1. Meet Piton

Piton is a small mountaineer who never takes his goggles off his hood. The idea was a classic
snowy-peak climber in the spirit of retro platform heroes. He's drawn in **Pyxl's chibi anime
style** but has his own design:

| Part | What it is | Why |
| --- | --- | --- |
| Hood | A big round fur-trimmed hood, as wide as Pyxl's beret, with a pompom | His "hat": the biggest shape, like her beret |
| Hair | Spiky ginger bangs and side locks spilling out of the hood | Frames the face the way her hair does; ginger sets him apart from her dark hair |
| Eyes | Pyxl-style anime eyes: a dark lash line, iris rows, a white glint, blush under them | The style's signature. The face is small and the eyes are big and wide-set |
| Goggles | **Amber snow goggles** pushed up on the hood, with a strap all round | His signature, readable even from the back |
| Parka | A tiny puffy parka with a fur hem, and pack straps | Keeps him chibi: almost no neck, short limbs |
| Pack | An **orange backpack** with a **yellow coil of rope** | Says "climber" from any side |
| Mittens / boots | Red mittens, brown boots with fur cuffs, dark trousers | Warm accents against the cool parka |
| Mallet | A wooden ice mallet with a steel band | His tool in action poses, standing in for Pyxl's brush |

- **Parka colour:** the hood and parka use Pyxl's **teal smock ramp**, and nothing else on him is
  in the teal band. So in the app they would follow the outfit colour exactly like her smock
  (PYXL.md §4).
- **Pose mapping:** his poses map onto hers by meaning rather than look:
  - `brush` taps the mallet
  - `paint` swings it into ice chips
  - `spray` thrusts it forward
  - `raise` holds it up (the carried pose)

### Matching Pyxl's style (the rules that matter)

Measured from her sheet (`front` is 34 × 53):

- **Head ≈ 3/5 of the height.** The hat and hair are about 29 of her 53 rows, the body about 12
  and the legs about 8. Piton: hood plus face about 31 of 56, parka 13, legs 10.
- **Head as wide as the whole sprite** (34px). The body is about 18px and the arms and legs are
  stubs.
- **A small face, low in the head.** It's a skin window about 16px wide. The eyes sit in the
  lower half of the head with the chin just above the collar.
- **Eyes:** a solid dark lash row on top with a flick at the outer corner, then 3 rows of iris
  (dark at the top, lighter brown at the bottom) with a 1px white glint. Blush goes 2px below the
  outer corners. The mouth is tiny or missing.
- **Hair that breaks the outline:** zigzag bang tips, side locks down past the eyes, darker
  strands, and a light band near the top.
- **A 1px `#221822` outline everywhere, light from the top-left,** and 3-step ramps.

A first attempt used one round "ball" head with dot eyes. It was cute, but it read as a
different art style, because it had no hair, a small face window and tiny eyes. Those features
are what make the style.

## 2. Files

| File | What it does |
| --- | --- |
| `tools/characters/rig.js` | The renderer. Shapes, outline, shading and packing. Shared by every character |
| `tools/characters/piton.js` | Piton himself: palette, parts and the 18 poses |
| `tools/character-builder.html` | Preview page. Draws the sheet, shows the `SPRITES` table, downloads both |
| `assets/characters/piton-pixel.png` | The finished sheet: 671 × 57, 39 colours, 0 semi-transparent pixels |
| `assets/characters/piton-sprites.json` | His pose table, in the same `[x, y, w, h, anchorX, feetY]` form as Pyxl's |

To preview, serve the repo (`python3 -m http.server`) and open `/tools/character-builder.html`.

## 3. How the rig draws

Nothing is hand-placed except the face. A character is a **list of parts drawn back to front**.

1. **A part is a shape.** Each shape is a test that answers "is pixel (x, y) inside?":
   - `ellipse`, `circle`
   - `capsule` (limbs)
   - `rect`, `poly`
   - `box` (a rotated rectangle, used for the mallet head)
   - combined with `and` / `minus`

   For example, the fur ring is `and(furEllipse, hoodEllipse)`, so it never sticks out of the hood.
2. **Outline:** before a part is filled, every pixel touching it on the four sides (not the
   diagonals) gets the outline colour `#221822`, drawn over whatever is behind. That gives:
   - a clean 1px line around the whole character
   - lines between overlapping parts (an arm over the body)
   - slightly rounded corners

   A part can opt out with `outline: false` (straps, the fur hem), or use a softer colour, like the
   face's fur-shadow outline.
3. **Shading:** each part has a material, a ramp of `[shadow, base, light]`, and one of three
   `shade` modes:
   - `round`: a diagonal gradient across the part's box. Light top-left, shadow bottom-right.
     Used for the hood, body, mittens and boots.
   - `edge`: base colour, a light rim on the top-left edge and a shadow rim on the bottom-right.
     Used for limbs and the mallet.
   - `flat`: one colour. Used for the face, straps and ice.
4. **Details:** some parts need hand-drawn pixels.
   - `paint(x, y, k)` gives a part per-pixel colours. The hair uses it for darker strands and a
     light band.
   - `pixels: [[x, y, colour]]` are placed last.
   - `stamp(x, y, rows, legend)` turns little text drawings into pixels. The eyes are drawn this
     way:
     ```js
     open: ['.aaaa',    // a = lash/outline
            'aewee',    // e = dark iris, w = glint
            '.eeie',    // i = lighter iris
            '.eiii',
            '..ii.'],
     ```
     Faces are where single pixels matter, so every expression (`open`, `closed`, `happy`,
     `half`, `wide`) is a stamp. The right eye is the same stamp mirrored.
5. **Packing:** `pack()` crops every pose to its drawn pixels, lays them out in one row 1px apart,
   and writes the anchor table. Each pose is drawn on the same 84 × 68 canvas with the **origin
   between the feet on the floor** (`OX`, `FY`), so `feetY` comes out consistent. `anchorX` is the
   hood centre, which is where the app hangs him when carried, like Pyxl's beret.

## 4. How a pose is described

`pose(o)` in `piton.js` builds the parts from a handful of settings:

```js
pose({
  view: 'front' | 'side' | 'back',      // side faces right; the left-facing 'side' pose is mirrored
  legs: 'stand' | 'stepA' | 'stepB' | 'sit',
  bob: -1,                               // whole body up 1px (breathing, walking)
  hands: { back: [x, y], front: [x, y] },// mitten positions, relative to the origin
  tool: { hand: 'front', angle: -35 },   // the mallet, from that hand, at that angle (degrees)
  eyes: 'open' | 'closed' | 'happy' | 'half' | 'wide',
  mouth: 'smile' | 'open' | 'o' | 'none',
  extras: [ ...parts ],                  // ice chips, a sweat drop…
})
```

The arms are capsules from the shoulder to wherever you put the mitten, so a new pose is usually
one line. `poses()` lists all 18 by Pyxl's names. `sleep` is the standing pose with closed eyes,
turned a quarter turn with `rotate()` (lossless for pixel art) and set on the floor.

## 5. Making your own character

1. **Copy `piton.js`** to `tools/characters/<name>.js` and rename it.
2. **Silhouette first.** Follow the proportions in §1: the head is about 3/5 of the height and as
   wide as the sprite, the body is tiny, and the limbs are stubs. Fill the big shapes flat and look
   at them zoomed out before adding anything else.
3. **Hair and eyes next.** They carry the style. Use bangs and locks that break the face outline,
   and Pyxl-style eye stamps.
4. **Palette:** one `[shadow, base, light]` ramp per material, with:
   - clear brightness steps
   - shadows shifted slightly warm or purple rather than just darker
   - the outline `#221822`

   Use the **teal ramp** for whatever should follow the outfit colour, and keep everything else out
   of hue 150–205.
5. **A signature detail** that shows from every side (Piton's goggles and pack). This is what makes
   a character more than a recolour.
6. **The front pose, then the rest.** Get `front` right and use it to judge the others. Do the side
   walk cycle (`idle0 → idle1 → walk`) next, then the action and emotion poses.
7. **Add it to the builder:** one line in `CHARS` in `tools/character-builder.html`.
8. **Look at it at 1× and zoomed, next to Pyxl.** Things that commonly go wrong:
   - parts covering each other in the wrong order (draw back to front)
   - tools crossing the face (move the hand or the angle)
   - details that sit outside the silhouette (clip them with `and(...)`)
   - limbs hidden under a round body (lengthen them or raise the body)
9. **Download the sheet and table**, put them in `assets/characters/`, and run the checklist in
   PYXL.md §7: lossless, no semi-transparent pixels, one outline colour, anchors match.

## 6. Putting a character in the app (not built yet)

The sheet and table have the same shape as Pyxl's, so wiring one in means:

- teaching `Mascot` to take a sheet and `SPRITES` table per character, instead of the one in
  `js/ui/mascot.js`
- letting an egg or the Shop pick which character hatches

His poses use the same names, so the states, the walking, carrying, throwing, sleeping and racing
need no changes. Ask and it can be added.

## 7. Other ways to make pixel art with Claude (for reference)

- **[pixel-mcp](https://github.com/willibrandon/pixel-mcp):** an MCP server that lets Claude
  drive **Aseprite**.
  - Drawing tools: pixels, shapes, layers, frames and animation tags.
  - Art tools: dithering, palette reduction and automatic shading.
  - Sprite-sheet export with JSON.
  - Needs Go and a copy of Aseprite, and runs on your own computer.
- **[pixel-art-lab](https://github.com/nbrown725/pixel-art-lab):** a local web app built on
  pixel-mcp.
  - The model draws, renders a preview, looks at it and fixes problems in a loop, with undo
    checkpoints and limits on spending.
  - Needs Aseprite and an OpenRouter key.
- **Text-to-sprite renderers:** the approach used here (code or ASCII drawn into pixels) is also
  what many people building games with Claude use.
- **Local image models:** e.g. the
  [SD PixelArt SpriteSheet Generator](https://huggingface.co/Onodofthenorth/SD_PixelArt_SpriteSheet_Generator)
  (Stable Diffusion). Output is rough and needs a clean-up pass, and it won't match Pyxl's exact
  palette or poses.

The rig here was chosen because it needs nothing installed. It's also deterministic, so the same
code gives the same sheet every time, and every pose stays editable as code.
