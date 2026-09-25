import { h, icon } from './dom.js';
import { modal } from './dialogs.js';

// Help → Getting Started: a short, skimmable tour of the app.
const SECTIONS = [
  ['brush', 'Painting', ['Pick a tool on the left and a brush from Brushes; size, opacity, flow and smoothing sit in the bar on top.', 'Pen pressure and tilt work out of the box. Alt-click picks a colour, right-click opens a quick palette, and Space pans.', '[ and ] resize the brush, X swaps colours, Ctrl+Z / Ctrl+Shift+Z undo and redo.']],
  ['layers', 'Layers', ['Blend modes, opacity, clipping masks, alpha lock, groups and filter layers live in the Layers panel.', 'Drag layers to reorder them.']],
  ['film', 'Animation', ['Open the Animation strip at the bottom. Each frame holds the drawing before it until you draw a new key.', 'Onion skin, tags, playback speed, and export to GIF, sprite sheet, PNG frames or video are in the Frame menu.']],
  ['window', 'Panels & layouts', ['Drag panel headers to move, dock or float them; the « » buttons fold a dock into an icon rail.', 'Window → Save Layout keeps your arrangement; Keyboard Shortcuts lets you rebind any key.']],
  ['zen', 'Modes', ['Paint is the full studio, Zen hides everything but the canvas (Tab), Notes is a board for ideas, Paper is a calm e-ink look, and Pixel is the pixel-art editor.']],
  ['sketch', 'Touch', ['Pinch to zoom and rotate, drag two fingers to pan.', 'Two-finger tap undoes, three-finger tap redoes. With a pen, fingers never paint.']],
  ['save', 'Saving', ['Everything autosaves in this browser. File → Download Project saves an OpenRaster (.ora) file that Krita and GIMP open too; PNG, JPG and PSD export are there as well.']],
  ['heart', 'Pyxl', ['Pyxl reacts to what you do and grows with you: your strokes, colours, shapes and filters train her Line, Colour, Shape and Power skills, and food builds her Stamina.',
    'Click her to care for her. Her card has Care (food, toys), Chart (her name, personality, skills and grades), School (lessons she then shows off), Games (stars and races) and a Shop for rings you earn.',
    'She has a life cycle — child, a cocoon, adult — and a happy Pyxl is reborn remembering you. Drag her card anywhere, pin it, or dock it as a panel.']],
  ['download', 'Updates', ['Installed as an app? Help → Check for Updates fetches the newest version; you’ll also see a banner when one is out.']],
];

export const showGuide = () => modal('Getting Started', h('div.guide', {},
  SECTIONS.map(([ic, title, lines]) => h('section.guide-sec', {}, icon(ic), h('div', {}, h('h4', {}, title), lines.map(l => h('p', {}, l)))))),
[['Got it', 'ok', true]], 'wide');
