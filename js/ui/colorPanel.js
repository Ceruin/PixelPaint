import { h, icon, iconBtn, segmented, select } from './dom.js';
import { PALETTES, parsePalette } from '../engine/palettes.js';
import { pickFile } from '../core/util.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { clamp, TAU } from '../core/util.js';
import { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv } from '../core/color.js';

const allPalettes = () => ({ ...PALETTES, ...local.get('pp.palettes', {}) });

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
  // Wheel style: hue ring around an SV square, knobs drawn onto the canvas.
  const wheel = h('canvas.wheel', { width: 240, height: 240 }), W = 120, RI = 96, SQ = 64;
  const drawWheel = () => {
    const c = wheel.getContext('2d');
    c.clearRect(0, 0, 240, 240);
    const g = c.createConicGradient(0, W, W);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    c.fillStyle = g; c.beginPath(); c.arc(W, W, W, 0, TAU); c.arc(W, W, RI, 0, TAU, true); c.fill();
    c.fillStyle = `hsl(${hh},100%,50%)`; c.fillRect(W - SQ, W - SQ, SQ * 2, SQ * 2);
    const wg = c.createLinearGradient(W - SQ, 0, W + SQ, 0); wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = wg; c.fillRect(W - SQ, W - SQ, SQ * 2, SQ * 2);
    const bg2 = c.createLinearGradient(0, W - SQ, 0, W + SQ); bg2.addColorStop(0, 'rgba(0,0,0,0)'); bg2.addColorStop(1, '#000');
    c.fillStyle = bg2; c.fillRect(W - SQ, W - SQ, SQ * 2, SQ * 2);
    const a = hh / 360 * TAU, knob = (x, y) => { c.beginPath(); c.arc(x, y, 6, 0, TAU); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); c.lineWidth = 1; c.strokeStyle = '#000'; c.stroke(); };
    knob(W + Math.cos(a) * (RI + 12), W + Math.sin(a) * (RI + 12));
    knob(W - SQ + ss * SQ * 2, W - SQ + (1 - vv) * SQ * 2);
  };
  wheel.addEventListener('pointerdown', e => {
    wheel.setPointerCapture(e.pointerId);
    const at = ev => { const r = wheel.getBoundingClientRect(), k = 240 / r.width; return [(ev.clientX - r.left) * k - W, (ev.clientY - r.top) * k - W]; };
    const [x0, y0] = at(e), ring = Math.hypot(x0, y0) > RI - 4;
    const go = ev => {
      const [x, y] = at(ev);
      if (ring) { hh = (Math.atan2(y, x) / TAU * 360 + 360) % 360; drawSV(); }
      else { ss = clamp((x + SQ) / (SQ * 2), 0, 1); vv = 1 - clamp((y + SQ) / (SQ * 2), 0, 1); }
      commit();
    };
    go(e);
    wheel.onpointermove = ev => ev.buttons && go(ev);
  });
  let style = local.get('pp.pickerStyle', 'square');
  const pads = h('div.pads');
  const setStyle = s => { style = s; local.set('pp.pickerStyle', s); pads.replaceChildren(...(s === 'wheel' ? [wheel] : [h('div.sv-wrap', {}, sv, svKnob), h('div.hue-wrap', {}, hue, hueKnob)])); place(); };

  const place = () => {
    if (style === 'wheel') drawWheel();
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
  // Palettes: built-ins, imported files (.gpl / .pal / .hex) and "My palette".
  let palName = local.get('pp.palette', 'PixelPaint');
  const palSel = h('span.pal-sel');
  const renderPalette = () => {
    const all = allPalettes();
    if (!all[palName]) palName = 'PixelPaint';
    palSel.replaceChildren(select(Object.keys(all).map(n => [n, n]), palName, v => { palName = v; local.set('pp.palette', v); renderPalette(); }));
    swatches.replaceChildren(...all[palName].map(sw));
  };
  const saveCustom = (name, colors) => { local.set('pp.palettes', { ...local.get('pp.palettes', {}), [name]: colors }); palName = name; local.set('pp.palette', name); renderPalette(); };
  const importPal = async () => {
    const f = await pickFile('.gpl,.pal,.hex,.txt');
    const colors = f && parsePalette(await f.text());
    if (colors?.length) saveCustom(f.name.replace(/\.\w+$/, ''), colors.slice(0, 256));
  };
  const addColor = () => { const mine = allPalettes()['My palette'] ?? []; saveCustom('My palette', [...new Set([...mine, app.color.fg])]); };
  const eyedrop = window.EyeDropper && iconBtn('picker', 'Pick a color from anywhere on screen', async () => { try { app.setColor((await new EyeDropper().open()).sRGBHex); } catch { /* cancelled */ } });
  renderPalette();
  bus.on('color', () => { if (!self) { [hh, ss, vv] = rgbToHsv(...hexToRgb(app.color.fg)); drawSV(); } place(); });
  bus.on('history', hist => {
    if (!['Brush', 'Fill'].includes(hist.done.at(-1)?.label) || recent[0] === app.color.fg) return;
    recent = [app.color.fg, ...recent.filter(c => c !== app.color.fg)].slice(0, 10);
    local.set('pp.recent', recent);
    drawRecent();
  });
  drawSV(); setStyle(style); drawRecent();
  return h('div.picker', {},
    segmented([['square', 'Square', 'marquee'], ['wheel', 'Wheel', 'palette']], style, setStyle, true),
    pads,
    h('div.picker-row', {}, h('div.chips.inline', {}, bg, fg), icon('palette'), hex, eyedrop),
    h('div.picker-row', {}, palSel, iconBtn('plus', 'Add current color to “My palette”', addColor), iconBtn('upload', 'Import palette (.gpl, .pal, .hex)', importPal)),
    swatches, h('div.sub-label', {}, 'Recent'), recents);
}
