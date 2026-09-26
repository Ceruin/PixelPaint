import { h } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';

// Help ▸ Getting Started ▸ guided tour: Pyxl walks you through the app one spotlight at a time.
// Some steps wait for you to try the thing (the tour moves on by itself); any step can be
// skipped with Next. Steps whose target isn't on screen (a closed panel, a phone layout) are left out.
const STEPS = [
  [null, 'Hi, I’m Pyxl!', 'Let’s take a quick tour. Use Next, or try each thing as we go.'],
  ['.panel[data-panel=tools] .toolbar, #zen', 'Tools', 'Your tools. A small corner mark means more tools inside — hold, right-click or click again to pick one.'],
  ['#stage', 'Draw something', 'Go on, paint a stroke on the canvas!', ['history', hist => /Brush|Pencil|Eraser|Smudge/.test(hist.done.at(-1)?.label ?? '')]],
  ['#optionsbar', 'Brush options', 'Size, opacity, flow and smoothing live here. [ and ] change the size.'],
  ['.panel[data-panel=brushes]', 'Brushes', 'Pick a brush — pencils, inks, paints and a Manga set with tones.'],
  ['.panel[data-panel=color]', 'Colour', 'Pick colours here. Right-click the canvas for a quick palette; Alt-click picks from the picture.', ['color']],
  ['.panel[data-panel=layers]', 'Layers', 'Stack your work on layers, each with its own blend mode and opacity.'],
  ['#menubar [data-action="edit.undo"]', 'Undo', 'Undo and redo. On a tablet: two-finger tap undoes, three-finger tap redoes.'],
  ['.mode-switch', 'Workspaces', 'Draw is for painting and pixel art; Notes is a board for ideas and sketches.'],
  ['#menubar [data-action="view.focus"]', 'Focus', 'Hide everything but the canvas (Tab). The Exit button brings the menus back.'],
  ['#menubar .menu-title', 'Save & share', 'File has Save to Browser (Ctrl+S), Open from Browser, .pp project files and Share.'],
  ['.mascot', 'That’s me!', 'Click me to feed, play, study or shop. Drag me anywhere — you can even throw me!'],
  [null, 'You’re all set ✿', 'Help ▸ Getting Started brings this tour back any time. Have fun painting!'],
];

let active = null;

export function startTour(pyxl) {
  active?.end();
  if (document.body.dataset.mode !== 'paint') actions.run('mode.paint');
  const steps = STEPS.filter(([sel]) => !sel || target(sel));
  const hole = h('div.tour-hole'), tip = h('div.tour-tip', { role: 'dialog', 'aria-live': 'polite' }), root = h('div.tour', {}, hole, tip);
  document.body.append(root);
  let i = 0, off = null, raf = 0;
  const end = () => { off?.(); cancelAnimationFrame(raf); clearInterval(timer); removeEventListener('keydown', key, true); root.remove(); active = null; };
  const go = n => { i = Math.max(0, Math.min(steps.length - 1, n)); show(); };
  const show = () => {
    off?.(); off = null;
    const [sel, title, text, wait] = steps[i], last = i === steps.length - 1;
    tip.replaceChildren(...[
      h('div.tour-count', {}, `${i + 1} / ${steps.length}`),
      h('b', {}, title), h('p', {}, text),
      wait && h('small.tour-try', {}, 'Try it — or press Next.'),
      h('div.tour-btns', {},
        !last && h('button.btn.sm', { type: 'button', onclick: end }, 'Skip tour'),
        h('span.spacer'),
        i > 0 && h('button.btn.sm', { type: 'button', onclick: () => go(i - 1) }, 'Back'),
        h('button.btn.sm.primary', { type: 'button', onclick: () => (last ? end() : go(i + 1)) }, last ? 'Done' : 'Next'))].filter(Boolean));
    if (wait) off = bus.on(wait[0], v => {
      if (wait[1] && !wait[1](v)) return;
      off?.(); off = null;
      pyxl?.react('cheer', { icon: 'star', n: 3, say: 'Nice!', force: true });
      setTimeout(() => active && go(i + 1), 900);
    });
    if (sel === '.mascot') pyxl?.react('wave', { force: true });
    place();
  };
  // Follows the target as panels move or the window resizes.
  const place = () => {
    const sel = steps[i][0], el = sel && target(sel), r = el?.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, m = 10;
    hole.hidden = !r;
    if (r) Object.assign(hole.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    root.classList.toggle('dim', !r);
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = vw / 2 - tw / 2, y = vh / 2 - th / 2;
    if (r) {
      const below = r.bottom + 14, above = r.top - 14 - th, right = r.right + 14, left = r.left - 14 - tw;
      if (r.height > vh * 0.6) { x = right + tw < vw ? right : left > 0 ? left : r.right - tw - 16; y = right + tw < vw || left > 0 ? r.top + r.height / 2 - th / 2 : r.top + 16; }   // big targets: beside it, else in its top corner
      else { x = r.left + r.width / 2 - tw / 2; y = below + th < vh ? below : above > 0 ? above : vh / 2 - th / 2; }
    }
    Object.assign(tip.style, { left: `${Math.round(Math.max(m, Math.min(vw - tw - m, x)))}px`, top: `${Math.round(Math.max(m, Math.min(vh - th - m, y)))}px` });
  };
  const timer = setInterval(() => { raf = requestAnimationFrame(place); }, 300);
  const key = e => {
    if (e.key === 'Escape') { e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight' && !e.target.closest?.('input, textarea, [contenteditable]')) go(i + 1);
    else if (e.key === 'ArrowLeft' && !e.target.closest?.('input, textarea, [contenteditable]')) go(i - 1);
  };
  addEventListener('keydown', key, true);
  active = { end };
  requestAnimationFrame(show);
}

// The first matching element that's actually on screen.
function target(sel) {
  return [...document.querySelectorAll(sel)].find(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; });
}
