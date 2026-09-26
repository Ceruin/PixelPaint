import { h, icon } from './dom.js';
import { modal } from './dialogs.js';

// Help → Getting Started: a short, skimmable tour of the app.
const SECTIONS = [
  ['brush', 'Painting', ['Pick a tool on the left and a brush from Brushes; size, opacity, flow and smoothing sit in the bar on top.', 'Pen pressure and tilt work out of the box. Alt-click picks a colour, right-click opens a quick palette, and Space pans.', '[ and ] resize the brush, X swaps colours, Ctrl+Z / Ctrl+Shift+Z undo and redo.']],
  ['layers', 'Layers', ['Blend modes, opacity, clipping masks, alpha lock, groups and filter layers live in the Layers panel.', 'Drag layers to reorder them.']],
  ['film', 'Animation', ['Open the Animation strip at the bottom. Each frame holds the drawing before it until you draw a new key.', 'Onion skin, tags, playback speed, and export to GIF, sprite sheet, PNG frames or video are in the Frame menu.']],
  ['window', 'Panels & layouts', ['Drag panel headers to move, dock or float them; the « » buttons fold a dock into an icon rail.', 'Window → Save Layout keeps your arrangement; Keyboard Shortcuts lets you rebind any key.']],
  ['zen', 'Workspaces', ['Draw is for painting and pixel art; Notes is a board for ideas. Focus (Tab) hides everything but the canvas or board. The theme button switches Dark, Light and E-ink (with an e-ink display simulation you can turn off in View).']],
  ['pixel', 'Pixel art', ['File ▸ New Canvas has pixel presets: small canvases stay crisp and fit at whole zooms. Use the Pencil (P) and Pixel Shapes (Shift+P); right-click erases. Export crisp enlargements and sprite sheets from File, or open the canvas in Sprite Studio for tiles, voxels and .aseprite.']],
  ['sketch', 'Touch', ['Pinch to zoom and rotate, drag two fingers to pan.', 'Two-finger tap undoes, three-finger tap redoes. With a pen, fingers never paint.']],
  ['save', 'Saving', ['Everything autosaves in this browser. File ▸ Save to Browser (Ctrl+S) keeps named projects you can reopen from Open from Browser. Download Project saves a .pp file with every layer; Share sends the finished picture or the project anywhere. OpenRaster (.ora, for Krita and GIMP), PNG, JPG and PSD export are there too.']],
  ['heart', 'Pyxl', ['Pyxl reacts to what you do and grows with you: your strokes, colours, shapes and filters train her Line, Colour, Shape and Power skills, and food builds her Stamina.',
    'Click her to care for her. Her card has Care (food, toys), Chart (her name, personality, skills and grades), School (lessons she then shows off), Games (stars, tracing, colour memory, drawing and races) and a Shop for rings you earn. Her radio plays lofi while you work, and a focus session sends her to study while you do.',
    'She has a life cycle — child, a cocoon, adult — and a happy Pyxl is reborn remembering you. Drag her card anywhere, pin it, or dock it as a panel.']],
  ['download', 'Updates', ['Installed as an app? Help → Check for Updates fetches the newest version; you’ll also see a banner when one is out.']],
];

export const showGuide = async onTour => {
  const tour = h('button.guide-tour', { type: 'button', onclick: () => tour.closest('.modal-back')?.querySelector('.modal-foot .btn')?.click() },
    icon('play'), h('span', {}, h('b', {}, 'Take the guided tour'), h('small', {}, 'Pyxl shows you around, one step at a time (2 minutes).')));
  const v = await modal('Getting Started', h('div.guide', {}, tour,
    SECTIONS.map(([ic, title, lines]) => h('section.guide-sec', {}, icon(ic), h('div', {}, h('h4', {}, title), lines.map(l => h('p', {}, l)))))),
  [['Take the tour', 'tour'], ['Got it', 'ok', true]], 'wide');
  if (v === 'tour') onTour?.();
};
