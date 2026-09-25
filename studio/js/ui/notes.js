import { h, icon, iconBtn } from './dom.js';
import { idb } from '../core/storage.js';
import { debounce, clamp } from '../core/util.js';
import { BrushEngine, DEFAULT_BRUSH } from '../engine/brush.js';
import { actions } from '../core/actions.js';

const COLORS = ['#fff3a8', '#ffd1dc', '#c8f0d8', '#cfe6ff', '#e6dcff', '#ffffff'];
const PEN = { ...DEFAULT_BRUSH, name: 'Note pen', size: 3.5, minSize: 0.35, hardness: 0.95, spacing: 0.05, smoothing: 0.35 };
const SKETCH_W = 640, SKETCH_H = 480;

// Note-taking board: infinite pan/zoom surface with sticky notes, text blocks and sketch cards.
export function initNotes(app, sendToCanvas) {
  const root = document.getElementById('notes');
  const inner = h('div.board-inner'), board = h('div.board', {}, inner), slot = h('div.mascot-slot');
  let state = { items: [], view: { x: 40, y: 40, z: 1 } }, uid = 1;
  const save = debounce(() => idb.set('notes', state), 400);
  const applyView = () => { const v = state.view; inner.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`; board.style.backgroundPosition = `${v.x}px ${v.y}px`; board.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`; };
  const toBoard = (cx, cy) => { const r = board.getBoundingClientRect(), v = state.view; return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }; };

  // Drags with pointer capture; fn receives board-space deltas.
  const dragger = (el, fn, end) => el.addEventListener('pointerdown', e => {
    if (e.target.closest('button, [contenteditable]') && el !== e.target) return;
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    let x = e.clientX, y = e.clientY;
    el.onpointermove = ev => { if (!ev.buttons && ev.pointerType === 'mouse') return; fn((ev.clientX - x) / state.view.z, (ev.clientY - y) / state.view.z); x = ev.clientX; y = ev.clientY; };
    el.onpointerup = () => { el.onpointermove = null; end?.(); save(); };
  });

  const mount = it => {
    const el = h(`div.card.${it.kind}`);
    const place = () => Object.assign(el.style, { left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px`, background: it.color ?? '' });
    const grip = h('div.card-grip', {},
      it.kind === 'note' && COLORS.map(c => h('button.dot', { type: 'button', style: { background: c }, onclick: () => { it.color = c; place(); save(); } })),
      h('span.spacer'),
      it.kind === 'sketch' && iconBtn('upload', 'Send to canvas as a layer', () => sendToCanvas(canvas)),
      it.kind === 'sketch' && iconBtn('eraser', 'Clear sketch', () => { canvas.getContext('2d').clearRect(0, 0, SKETCH_W, SKETCH_H); it.img = null; save(); }),
      iconBtn('trash', 'Delete', () => { state.items = state.items.filter(i => i !== it); el.remove(); save(); }));
    let canvas;
    if (it.kind === 'sketch') {
      canvas = h('canvas.card-canvas', { width: SKETCH_W, height: SKETCH_H });
      if (it.img) { const i = new Image(); i.onload = () => canvas.getContext('2d').drawImage(i, 0, 0); i.src = it.img; }
      let eng = null;
      const pt = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * SKETCH_W / r.width, y: (e.clientY - r.top) * SKETCH_H / r.height, p: e.pointerType === 'pen' ? e.pressure : 1 }; };
      canvas.addEventListener('pointerdown', e => {
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        eng = new BrushEngine(PEN, { target: canvas.getContext('2d'), color: '#1b1d23', symmetry: [(x, y, a) => [x, y, a, false]], profile: app.profile });
        eng.begin(pt(e));
      });
      canvas.addEventListener('pointermove', e => eng && (e.getCoalescedEvents?.() ?? [e]).forEach(ev => eng.move(pt(ev))));
      canvas.addEventListener('pointerup', e => { if (!eng) return; eng.end(pt(e)); eng = null; it.img = canvas.toDataURL(); save(); });
    }
    const body = it.kind === 'sketch' ? canvas : h('div.card-text', {
      contentEditable: 'true', spellcheck: true, textContent: it.text,
      oninput: e => { it.text = e.target.innerText; save(); },
      onpointerdown: e => e.stopPropagation(),
    });
    const resize = h('div.card-resize');
    dragger(grip, (dx, dy) => { it.x += dx; it.y += dy; place(); });
    dragger(resize, (dx, dy) => {
      it.w = clamp(it.w + dx, 140, 2000);
      it.h = it.kind === 'sketch' ? it.w * SKETCH_H / SKETCH_W + 34 : clamp(it.h + dy, 60, 2000);
      place();
    });
    el.append(grip, body, resize);
    place();
    inner.append(el);
    return body;
  };

  const add = (kind, at) => {
    const r = board.getBoundingClientRect();
    const k = state.items.length % 6 * 28, p = at ?? toBoard(r.left + r.width / 2 - 160 + k, r.top + r.height / 2 - 140 + k);
    const it = { id: uid++, kind, x: p.x, y: p.y, w: kind === 'sketch' ? 320 : kind === 'text' ? 280 : 220, h: kind === 'sketch' ? 274 : kind === 'text' ? 70 : 200, color: kind === 'note' ? COLORS[state.items.length % 5] : null, text: '' };
    state.items.push(it);
    const body = mount(it);
    if (kind !== 'sketch') body.focus();
    save();
  };

  // Board pan (drag empty space), zoom (wheel / pinch via ctrl+wheel), double-click = new note.
  board.addEventListener('pointerdown', e => {
    if (e.target !== board && e.target !== inner) return;
    board.setPointerCapture(e.pointerId);
    let x = e.clientX, y = e.clientY;
    board.onpointermove = ev => { state.view.x += ev.clientX - x; state.view.y += ev.clientY - y; x = ev.clientX; y = ev.clientY; applyView(); };
    board.onpointerup = () => { board.onpointermove = null; save(); };
  });
  board.addEventListener('dblclick', e => (e.target === board || e.target === inner) && add('note', toBoard(e.clientX - 20, e.clientY - 20)));
  board.addEventListener('wheel', e => {
    e.preventDefault();
    const v = state.view, r = board.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (!e.ctrlKey && !e.altKey) { v.x -= e.deltaX; v.y -= e.deltaY; }
    else {
      const z = clamp(v.z * Math.exp(-e.deltaY * 0.01), 0.2, 4);
      v.x = sx - (sx - v.x) * z / v.z; v.y = sy - (sy - v.y) * z / v.z; v.z = z;
    }
    applyView(); save();
  }, { passive: false });

  root.append(
    h('div.notes-bar', {},
      h('strong', {}, 'Notes'),
      h('button.btn', { type: 'button', onclick: () => add('note') }, icon('note'), 'Sticky'),
      h('button.btn', { type: 'button', onclick: () => add('text') }, icon('text'), 'Text'),
      h('button.btn', { type: 'button', onclick: () => add('sketch') }, icon('sketch'), 'Sketch'),
      h('button.btn', { type: 'button', onclick: () => { state.view = { x: 40, y: 40, z: 1 }; applyView(); } }, 'Reset view'),
      h('span.spacer'), h('span.muted', {}, 'Double-click the board for a quick note'),
      h('button.btn.primary', { type: 'button', onclick: () => actions.run('mode.studio') }, 'Back to canvas'),
      slot),
    board);

  idb.get('notes').then(s => {
    if (s?.items) state = s;
    uid = Math.max(0, ...state.items.map(i => i.id)) + 1;
    state.items.forEach(mount);
    applyView();
  }).catch(() => applyView());

  return { slot, show: on => { root.hidden = !on; } };
}
