# Making a new character

How to build a **brand-new character** (not a skin of Pyxl) that can drop into PixelPaint. Use the
same small, chunky pixel style as Pyxl and draw the same 18 poses, so every state in the app (idle,
walking, being carried, sleeping, racing) has a frame to show.

For colour swaps and clothing *on Pyxl*, see `docs/PYXL.md` §6 instead.

The worked example is **Piton**, a little mountain climber.

![Piton's sheet](../assets/characters/piton-pixel.png)

---

## 1. Meet Piton

Piton is a small, round mountaineer who never takes his goggles off his hood. The idea was a
classic snowy-peak climber in the spirit of retro platform heroes, but with his own design:

| Part | What it is | Why |
| --- | --- | --- |
| Hood | One big round hood with a **fur ring** around the face and a fur **pompom** | The silhouette: a ball on a smaller ball |
| Goggles | **Amber snow goggles** pushed up onto the fur rim, with a dark strap around the hood | His signature, readable even from the back |
| Parka | A puffy, round parka with a white fur hem | Keeps him chibi: almost no neck, short limbs |
| Pack | An **orange backpack** with a **yellow coil of rope**; the straps show from the front | Tells you "climber" from any side |
| Mittens / boots | Red mittens, brown boots, dark indigo trousers | Warm accents against the cool parka |
| Mallet | A wooden ice mallet with steel bands | His tool in action poses, standing in for Pyxl's brush |

- **Parka colour:** the parka uses Pyxl's **teal smock ramp**, and nothing else on him is in the
  teal band. So if he's added to the app, his parka follows the outfit colour exactly like her
  smock (PYXL.md §4).
- **Pose mapping:** his poses map onto hers by meaning rather than look:
  - `brush` taps the mallet
  - `paint` swings it into ice chips
  - `spray` thrusts it forward
  - `raise` holds it up (the carried pose)

## 2. Files

| File | What it does |
| --- | --- |
| `tools/characters/rig.js` | The renderer. Shapes, outline, shading and packing. Shared by every character |
| `tools/characters/piton.js` | Piton himself: palette, parts and the 18 poses |
| `tools/character-builder.html` | Preview page. Draws the sheet, shows the `SPRITES` table, downloads both |
| `assets/characters/piton-pixel.png` | The finished sheet: 581 × 51, 32 colours, 0 semi-transparent pixels |
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
4. **Details:** `pixels: [[x, y, colour]]` are placed last. That's how the face is done: 2 × 3 eyes
   with a white glint, blush, and a 2px mouth. Faces are the one place where single pixels matter,
   so they're written by hand in `face()`.
5. **Packing:** `pack()` crops every pose to its drawn pixels, lays them out in one row 1px apart,
   and writes the anchor table. Each pose is drawn on the same 73 × 64 canvas with the **origin
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
one line. `poses()` lists all 18 by Pyxl's names. `sleep` is its own small function, because he
lies down.

## 5. Making your own character

1. **Copy `piton.js`** to `tools/characters/<name>.js` and rename it.
2. **Silhouette first.** Pick 2–3 big shapes that read at 26px tall: Piton is "ball hood + ball
   body". Fill them flat and look at them zoomed out before adding anything else. Keep the head big
   (about half the height) so it matches Pyxl's chibi proportions.
3. **Palette:** one `[shadow, base, light]` ramp per material, with:
   - clear brightness steps
   - shadows shifted slightly warm or purple rather than just darker
   - the outline `#221822`

   Use the **teal ramp** for whatever should follow the outfit colour, and keep everything else out
   of hue 150–205.
4. **A signature detail** that shows from every side (Piton's goggles and pack). This is what makes
   a character more than a recolour.
5. **The front pose, then the rest.** Get `front` right and use it to judge the others. Do the side
   walk cycle (`idle0 → idle1 → walk`) next, then the action and emotion poses.
6. **Add it to the builder:** one line in `CHARS` in `tools/character-builder.html`.
7. **Look at it at 1× and zoomed.** Things that commonly go wrong:
   - parts covering each other in the wrong order (draw back to front)
   - tools crossing the face (move the hand or the angle)
   - details that sit outside the silhouette (clip them with `and(...)`)
   - limbs hidden under a round body (lengthen them or raise the body)
8. **Download the sheet and table**, put them in `assets/characters/`, and run the checklist in
   PYXL.md §7: lossless, no semi-transparent pixels, one outline colour, anchors match.

## 6. Putting a character in the app (not built yet)

The sheet and table have the same shape as Pyxl's, so wiring one in means:

- teaching `Mascot` to take a sheet and `SPRITES` table per character, instead of the one in
  `js/ui/mascot.js`
- letting an egg or the Shop pick which character hatches

His poses use the same names, so the states, the walking, carrying, throwing, sleeping and racing
need no changes. Ask and it can be added.
