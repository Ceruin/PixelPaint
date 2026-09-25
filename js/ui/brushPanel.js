import { h, slider, select, toggle } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { pickFile } from '../core/util.js';
import { PRESETS } from '../engine/presets.js';
import { strokePreview } from '../engine/brush.js';
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

// Presets apply to the matching tool; any brush can be loaded into the eraser, like Procreate.
function applyPreset(app, p) {
  const tool = p.cat === 'Eraser' ? 'eraser' : p.cat === 'Blend' ? 'smudge' : app.tool.id === 'eraser' ? 'eraser' : 'brush';
  app.brushes[tool] = structuredClone(p);
  app.setTool(tool);
  app.brushChanged();
}

export function brushLibrary(app) {
  const list = h('div.brush-list');
  const ink = () => getComputedStyle(document.body).getPropertyValue('--text').trim() || '#e7e9ee';
  const render = () => {
    const all = [...PRESETS, ...userBrushes().map(b => ({ ...b, cat: b.cat === 'Eraser' || b.cat === 'Blend' ? b.cat : 'My Brushes' }))];
    const cats = [...new Set(all.map(p => p.cat))];
    list.replaceChildren(...cats.map(cat => h('details.brush-cat', { open: true },
      h('summary', {}, cat, h('span.count', {}, all.filter(p => p.cat === cat).length)),
      all.filter(p => p.cat === cat).map(p => {
        const c = h('canvas', { width: 220, height: 44 });
        requestAnimationFrame(() => strokePreview(p, c, ink()));
        return h('button.brush-row', { type: 'button', className: app.brush.name === p.name ? 'on' : '', onclick: () => applyPreset(app, p) }, h('span.brush-label', {}, p.name), c);
      }))));
  };
  bus.on('brush', () => list.querySelectorAll('.brush-row').forEach(r => r.classList.toggle('on', r.firstChild.textContent === app.brush.name)));
  bus.on('tool', () => list.querySelectorAll('.brush-row').forEach(r => r.classList.toggle('on', r.firstChild.textContent === app.brush.name)));
  bus.on('mode', render);
  bus.on('userBrushes', render);
  render();
  return list;
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
      slider({ label: 'Size', value: sizeToPos(b.size), step: 0.1, fmt: () => `${app.brush.size}px`, onInput: v => set('size', posToSize(v)) }).el,
      pct('Opacity', 'opacity'), pct('Flow', 'flow'), pct('Hardness', 'hardness'), pct('Spacing', 'spacing', 200),
      pct('Stabilizer', 'smoothing', 94), pct('Min size (pressure)', 'minSize'), pct('Roundness', 'roundness'),
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

