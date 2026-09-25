import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { clamp } from '../core/util.js';
import { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv } from '../core/color.js';

const PALETTE = ['#000000', '#3c3f47', '#8c93a5', '#ffffff', '#ff3b47', '#ff8a3d', '#ffd23f', '#9be15d', '#17c06b', '#1fb5a8',
  '#84cee0', '#3b7bff', '#5b4bff', '#a445ff', '#ff5fa2', '#7a4a2e', '#c89f7c', '#f5deb3', '#2e4a7a', '#233d2b'];

function dragPad(el, fn) {
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    const go = ev => { const r = el.getBoundingClientRect(); fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); };
    go(e);
    el.onpointermove = ev => ev.buttons && go(ev);
  });
}

// HSV square + hue strip + hex + palette/recents. Several instances stay in sync through the bus.
export function colorPicker(app) {
  let [hh, ss, vv] = rgbToHsv(...hexToRgb(app.color.fg)), self = false;
  let recent = local.get('pp.recent', []);
  const sv = h('canvas.sv', { width: 256, height: 160 }), hue = h('canvas.hue', { width: 256, height: 12 });
  const svKnob = h('i.knob'), hueKnob = h('i.knob');
  const hex = h('input.hex', { maxLength: 7, spellcheck: false, onchange: () => /^#?[0-9a-f]{6}$/i.test(hex.value) && app.setColor('#' + hex.value.replace('#', '').toLowerCase()) });
  const fg = h('button.chip.fg', { type: 'button', 'data-tip': 'Foreground' }), bg = h('button.chip.bg', { type: 'button', 'data-tip': 'Swap colors', onclick: () => app.swapColors() });
  const swatches = h('div.swatches'), recents = h('div.swatches.recent');

  const hc = hue.getContext('2d'), g = hc.createLinearGradient(0, 0, 256, 0);
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
  hc.fillStyle = g; hc.fillRect(0, 0, 256, 12);

  const drawSV = () => {
    const c = sv.getContext('2d'), w = sv.width, ht = sv.height;
    c.fillStyle = `hsl(${hh},100%,50%)`; c.fillRect(0, 0, w, ht);
    const wg = c.createLinearGradient(0, 0, w, 0); wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = wg; c.fillRect(0, 0, w, ht);
    const bgd = c.createLinearGradient(0, 0, 0, ht); bgd.addColorStop(0, 'rgba(0,0,0,0)'); bgd.addColorStop(1, '#000');
    c.fillStyle = bgd; c.fillRect(0, 0, w, ht);
  };
  const place = () => {
    Object.assign(svKnob.style, { left: `${ss * 100}%`, top: `${(1 - vv) * 100}%`, background: app.color.fg });
    hueKnob.style.left = `${hh / 360 * 100}%`;
    hex.value = app.color.fg;
    fg.style.background = app.color.fg; bg.style.background = app.color.bg;
  };
  const commit = () => { self = true; app.setColor(rgbToHex(...hsvToRgb(hh, ss, vv))); self = false; place(); };
  const sw = c => h('button.sw', { type: 'button', style: { background: c }, 'data-tip': c, onclick: () => app.setColor(c) });
  const drawRecent = () => recents.replaceChildren(...recent.map(sw));

  dragPad(sv, (x, y) => { ss = x; vv = 1 - y; commit(); });
  dragPad(hue, x => { hh = x * 359.9; drawSV(); commit(); });
  swatches.append(...PALETTE.map(sw));
  bus.on('color', () => { if (!self) { [hh, ss, vv] = rgbToHsv(...hexToRgb(app.color.fg)); drawSV(); } place(); });
  bus.on('history', hist => {
    if (!['Brush', 'Fill'].includes(hist.done.at(-1)?.label) || recent[0] === app.color.fg) return;
    recent = [app.color.fg, ...recent.filter(c => c !== app.color.fg)].slice(0, 10);
    local.set('pp.recent', recent);
    drawRecent();
  });
  drawSV(); place(); drawRecent();
  return h('div.picker', {},
    h('div.sv-wrap', {}, sv, svKnob),
    h('div.hue-wrap', {}, hue, hueKnob),
    h('div.picker-row', {}, h('div.chips.inline', {}, bg, fg), icon('palette'), hex),
    swatches, h('div.sub-label', {}, 'Recent'), recents);
}
