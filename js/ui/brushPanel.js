import { h, icon, iconBtn, slider, select, toggle } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { pickFile, download, readJSON } from '../core/util.js';
import { PRESETS } from '../engine/presets.js';
import { strokePreview, SMOOTHING } from '../engine/brush.js';
import { TIPS, tipFromImage, registerTip, customTips } from '../engine/tips.js';
import { BLEND_MODES } from '../engine/blend.js';

const PAINT_TOOLS = ['brush', 'eraser', 'smudge'];
export const sizeToPos = s => Math.log(s) / Math.log(1000) * 100;
export const posToSize = p => Math.max(1, Math.round(1000 ** (p / 100)));

export const userBrushes = () => local.get('pp.userBrushes', []);

export function loadCustomTips() {
  Object.entries(local.get('pp.tips', {})).forEach(([id, url]) => {
    const img = new Image();
    img.onload = () => registerTip(id, tipFromImage(img, 256));
    img.src = url;
  });
}

const CAT_ICONS = { Sketch: 'pencil', Ink: 'pen', Manga: 'bubble', Paint: 'brush', Texture: 'texture', Eraser: 'eraser', Blend: 'smudge', 'My Brushes': 'star' };
const QUICK_SIZES = [2, 4, 8, 16, 32, 64, 128, 256];
export const favs = () => local.get('pp.favs', ['Pencil HB', 'Ink Pen', 'Brush Pen', 'Round', 'Soft Round', 'Airbrush', 'Marker', 'Chalk']);

// Presets apply to the matching tool; any brush can be loaded into the eraser, like Procreate.
export function applyPreset(app, p) {
  // an eraser preset erases, a blender smudges, anything else paints — even if the eraser was active
  const tool = p.cat === 'Eraser' ? 'eraser' : p.cat === 'Blend' ? 'smudge' : 'brush';
  app.brushes[tool] = structuredClone(p);
  app.setTool(tool);
  app.brushChanged();
}

// Brush thumbnails are costly (each one paints a whole stroke), so they are drawn once per brush
// and ink colour, only when their row scrolls into view, a few at a time in idle moments —
// then copied from the cache whenever the list is rebuilt.
const thumbs = (() => {
  const cache = new Map(), queue = [];
  const key = (p, ink) => `${ink}|${JSON.stringify(p)}`;
  const idle = window.requestIdleCallback ?? (fn => setTimeout(() => fn({ timeRemaining: () => 8 }), 30));
  let pumping = false;
  const pump = () => {
    if (pumping) return;
    pumping = true;
    idle(deadline => {
      pumping = false;
      while (queue.length && deadline.timeRemaining() > 4) {
        const { c, p, ink } = queue.shift();
        if (!c.isConnected) continue;
        const k = key(p, ink);
        if (!cache.has(k)) { const t = document.createElement('canvas'); t.width = 220; t.height = 44; strokePreview(p, t, ink); cache.set(k, t); }
        c.getContext('2d').drawImage(cache.get(k), 0, 0);
      }
      if (queue.length) pump();
    });
  };
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target.job); pump(); } }));
  return {
    show(c, p, ink) {
      const hit = cache.get(key(p, ink));
      if (hit) return void requestAnimationFrame(() => c.getContext('2d').drawImage(hit, 0, 0));
      c.job = { c, p, ink };
      io.observe(c);
    },
  };
})();

export function brushLibrary(app) {
  const list = h('div.brush-list');
  let query = '';
  const search = h('input', { type: 'search', placeholder: 'Search brushes…', oninput: () => { query = search.value.toLowerCase(); render(); } });
  let inkFor, inkVal;   // the theme's text colour, read once per theme/mode (a style read can force a recalc)
  const ink = () => { const key = document.body.className + document.body.dataset.theme; if (key !== inkFor) { inkFor = key; inkVal = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#e6e8ee'; } return inkVal; };
  const mark = () => list.querySelectorAll('.brush-row').forEach(r => r.classList.toggle('on', r.dataset.name === app.brush.name));
  const render = () => {
    const all = [...PRESETS, ...userBrushes().map(b => ({ ...b, cat: b.cat === 'Eraser' || b.cat === 'Blend' ? b.cat : 'My Brushes' }))]
      .filter(p => !query || `${p.name} ${p.cat}`.toLowerCase().includes(query));
    const cats = [...new Set(all.map(p => p.cat))], fav = favs();
    list.replaceChildren(...cats.map(cat => h('details.brush-cat', { open: true },
      h('summary', {}, icon(CAT_ICONS[cat] ?? 'brush'), cat, h('span.count', {}, all.filter(p => p.cat === cat).length)),
      all.filter(p => p.cat === cat).map(p => {
        const c = h('canvas', { width: 220, height: 44 });
        thumbs.show(c, p, ink());
        return h('div.brush-row', { dataset: { name: p.name }, className: app.brush.name === p.name ? 'on' : '', onclick: e => !e.target.closest('.star') && applyPreset(app, p) },
          h('span.brush-label', {}, p.name), c,
          h('button.star', { type: 'button', className: fav.includes(p.name) ? 'on' : '', 'data-tip': 'Pin to the pop-up palette (right-click canvas)', onclick: () => { toggleFav(p.name); render(); } }, icon('star')));
      }))), query && !all.length ? h('p.muted', {}, 'No brushes match.') : '');
    mark();
  };
  bus.on('brush', mark); bus.on('tool', mark);
  // Modes only matter if they change the ink colour (light theme / paper): then re-render.
  let lastInk = ink();
  const reink = () => { if (ink() !== lastInk) { lastInk = ink(); render(); } };
  bus.on('mode', reink); bus.on('theme', reink);
  bus.on('userBrushes', render); bus.on('favs', render);
  render();
  return h('div.brush-lib', {},
    h('div.brush-search', {}, search,
      iconBtn('upload', 'Import brush bundle…', importBundle),
      iconBtn('download', 'Export my brushes as a bundle…', exportBundle)),
    list);
}

function toggleFav(name) {
  const f = favs();
  local.set('pp.favs', f.includes(name) ? f.filter(n => n !== name) : [...f, name].slice(-12));
  bus.emit('favs');
}

// Brush bundles (Krita's resource bundles, simplified): user presets + their custom tips as JSON.
function exportBundle() {
  const tips = local.get('pp.tips', {}), brushes = userBrushes();
  const used = Object.fromEntries(Object.entries(tips).filter(([id]) => brushes.some(b => b.tip === id)));
  download(new Blob([JSON.stringify({ type: 'pixelpaint-brushes', version: 1, brushes, tips: used }, null, 1)], { type: 'application/json' }), 'pixelpaint-brushes.json');
}
async function importBundle() {
  const f = await pickFile('.json');
  if (!f) return;
  const j = await readJSON(f);
  if (j.type !== 'pixelpaint-brushes') return;
  local.set('pp.tips', { ...local.get('pp.tips', {}), ...j.tips });
  const names = new Set(j.brushes.map(b => b.name));
  local.set('pp.userBrushes', [...userBrushes().filter(b => !names.has(b.name)), ...j.brushes]);
  loadCustomTips();
  setTimeout(() => bus.emit('userBrushes'), 100);
}

export function brushSettings(app) {
  const root = h('div.brush-settings');
  let busy = false;
  const set = (k, v) => { busy = true; app.brush[k] = v; app.brushChanged(); busy = false; };
  const pct = (label, k, max = 100) => slider({ label, max, value: app.brush[k] * 100, fmt: v => `${Math.round(v)}%`, onInput: v => set(k, v / 100) }).el;

  const render = () => {
    const b = app.brush;
    const tips = [...TIPS, ...customTips().map(id => [id, `Custom ${id.slice(7)}`])];
    root.replaceChildren(
      h('div.bs-head', {}, h('strong', {}, b.name), h('span.muted', {}, ` · ${PAINT_TOOLS.includes(app.tool.id) ? app.tool.id : 'brush'}`)),
      h('div.quick-sizes', {}, QUICK_SIZES.map(s => h('button', { type: 'button', className: b.size === s ? 'on' : '', 'data-tip': `${s}px`, onclick: () => { app.brush.size = s; app.brushChanged(); } },
        h('i', { style: { width: `${Math.max(2, Math.sqrt(s) * 1.6)}px`, height: `${Math.max(2, Math.sqrt(s) * 1.6)}px` } })))),
      slider({ label: 'Size', value: sizeToPos(b.size), step: 0.1, fmt: () => `${app.brush.size}px`, onInput: v => set('size', posToSize(v)) }).el,
      pct('Opacity', 'opacity'), pct('Flow', 'flow'), pct('Hardness', 'hardness'), pct('Spacing', 'spacing', 200),
      h('label.field', {}, h('span', {}, 'Smoothing'), select(SMOOTHING, b.smoothMode ?? 'basic', v => set('smoothMode', v))),
      pct('Smoothing amount', 'smoothing', 94), pct('Min size (pressure)', 'minSize'), pct('Roundness', 'roundness'),
      slider({ label: 'Angle', min: -180, max: 180, value: b.angle, fmt: v => `${v}°`, onInput: v => set('angle', v) }).el,
      pct('Scatter', 'scatter', 300), pct('Size jitter', 'sizeJitter'), pct('Angle jitter', 'angleJitter'),
      h('div.bs-grid', {},
        toggle('Pressure → size', b.pressureSize, v => set('pressureSize', v)),
        toggle('Pressure → opacity', b.pressureOpacity, v => set('pressureOpacity', v)),
        toggle('Tilt shading', b.tilt, v => set('tilt', v)),
        toggle('Follow direction', b.followDir, v => set('followDir', v)),
        toggle('Build-up (airbrush)', b.buildup, v => set('buildup', v))),
      h('label.field', {}, h('span', {}, 'Tip'), select(tips, b.tip, v => set('tip', v))),
      h('label.field', {}, h('span', {}, 'Blend'), select(BLEND_MODES, b.blend, v => set('blend', v))),
      h('div.bs-actions', {},
        h('button.btn', { type: 'button', onclick: () => importTip(app) }, 'Import tip…'),
        h('button.btn', { type: 'button', onclick: () => saveBrush(app) }, 'Save as preset')));
  };
  bus.on('brush', () => !busy && render());
  bus.on('tool', render);
  render();
  return root;
}

async function importTip(app) {
  const f = await pickFile('image/*');
  if (!f) return;
  const img = new Image();
  img.src = URL.createObjectURL(f);
  await img.decode();
  const tip = tipFromImage(img, 256), id = `custom-${Date.now().toString(36)}`;
  registerTip(id, tip);
  const small = document.createElement('canvas');
  small.width = small.height = 128;
  small.getContext('2d').drawImage(img, 0, 0, 128, 128);
  local.set('pp.tips', { ...local.get('pp.tips', {}), [id]: small.toDataURL() });
  app.brush.tip = id;
  app.brushChanged();
}

function saveBrush(app) {
  const name = prompt('Preset name', `${app.brush.name} *`);
  if (!name) return;
  const b = { ...app.brush, name };
  if (app.tool.id === 'eraser') b.cat = 'Eraser';
  else if (app.tool.id === 'smudge') b.cat = 'Blend';
  else b.cat = 'My Brushes';
  local.set('pp.userBrushes', [...userBrushes().filter(u => u.name !== name), b]);
  app.brush.name = name;
  bus.emit('userBrushes');
  app.brushChanged();
}

