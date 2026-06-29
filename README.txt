PixelPaint — a simple pixel-art editor
======================================

HOW TO RUN
  Double-click PixelPaint.html. It opens in your default browser. No install,
  no internet, nothing to set up. Everything runs locally.

INSTALL AS A DESKTOP APP (Chrome / Edge)
  Chrome only lets you install a web app when it is served from a real address
  (http://localhost), not from a double-clicked file. So:

  1. Double-click PixelPaint-App.bat. It starts a tiny local server and opens
     PixelPaint at http://localhost:8137 in your browser. (Needs Node.js or
     Python installed -- most dev machines have one. Keep that little black
     window open while you use the app; closing it stops the server.)
  2. Click the "Install App" button in the top bar, OR use the install icon
     that appears at the right of Chrome's address bar (Edge: the same icon,
     or menu > Apps > Install this site as an app).
  3. PixelPaint installs like a normal app: its own window, Start-menu /
     taskbar entry, and it works offline (a service worker caches it).

  After that first install (done with the server running, so it caches itself),
  you can launch PixelPaint from the Start menu / taskbar any time -- it loads
  from its offline cache and the local server does NOT need to be running.
  (Re-run PixelPaint-App.bat only if you edit PixelPaint.html and want the
  installed app to pick up the changes.)

FEATURES
  - Layers: add, duplicate, reorder, rename (double-click), per-layer opacity
    and visibility. Transparency is fully supported (checkerboard = see-through).
  - Import images: paste (Ctrl+V), drag-and-drop an image file onto the window,
    or click "Add image…" in the tools panel. The image drops in at its FULL
    (native) size in a movable, resizable box -- drag it to position, drag the
    handles to resize (hold Shift on a corner to keep aspect ratio), then click
    Place / press Enter to add it as a new layer (Esc cancels). It's resampled
    to the pixel grid on placement.
      - The place bar has 1:1 (actual size) and Fit (shrink to canvas) buttons.
      - Right-click the image for more: Actual size, Fit to canvas, Fill canvas,
        Center, Flip horizontal, Flip vertical, Place, Cancel.
  - Tools: Pencil, Eraser, Fill (bucket), Color picker, Line, Rectangle, Ellipse,
    Select. Rectangle/Ellipse can be outline or filled ("Fill shapes" checkbox).
  - Rectangle select (the Select tool, or press M): drag a marquee (marching
    ants). While a selection is active, ALL drawing/fill is confined to it. Drag
    inside the selection to move the selected pixels. Right-click a selection for
    options: Fill with foreground, Snap to palette, Clear, Select all, Deselect.
    Keys: Delete = clear contents, Ctrl+A = select all, Ctrl+D / Esc = deselect.
  - Snap to palette: "Snap to this palette" (under the palette) remaps the active
    layer -- or just the current selection -- to the nearest colors in the chosen
    palette. Great for forcing imported art into a retro palette like NES or C64.
  - The status bar shows the live pixel coordinate under the cursor and the
    current selection size.
  - Adjustable brush size (1-16 px).
  - Two-color workflow (like MS Paint): LEFT mouse paints the foreground color,
    RIGHT mouse paints the background color. Left/right-click a palette swatch to
    set each; click a swatch in the Color box to choose which one the picker edits;
    press X (or the swap button) to swap them.
  - Preset color palettes: DawnBringer 16/32, NES (Nintendo), Game Boy (DMG) &
    Pocket, Sega Master System (full 64) & Genesis, PICO-8, Commodore 64,
    ZX Spectrum, CGA, Endesga 32, Sweetie 16, Grayscale. Plus a custom color
    picker, hex input, and a recent-colors strip.
  - Zoom + pixel grid overlay.
  - Undo / Redo (up to 80 steps).
  - Export to transparent PNG at 1x / 2x / 4x / 8x / 16x.
  - Save / Open projects (.pxpaint file keeps all layers).

KEYBOARD SHORTCUTS
  B Pencil   E Eraser   F Fill   I Pick   L Line   R Rectangle   C Ellipse   M Select
  Ctrl+A select all   Ctrl+D / Esc deselect   Delete clear selection contents
  [ / ]      brush size down / up
  + / -      zoom in / out
  G          toggle grid
  X          swap foreground / background colors
  Ctrl+V      paste an image onto the canvas
  Enter / Esc place / cancel a pasted or dropped image
  Ctrl+Z     undo        Ctrl+Y (or Ctrl+Shift+Z)  redo
  Alt+click   quick color pick (with any tool)
  Right-drag  paint with the background color
  Mouse wheel over the canvas = zoom

TIPS
  - Set the canvas size before you start (top bar). "New" clears everything.
  - The PNG export is transparent wherever you didn't paint, so it drops
    straight into a game engine or sprite sheet.
