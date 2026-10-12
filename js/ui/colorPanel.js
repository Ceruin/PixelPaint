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
    const dpr = devicePixelRatio || 1, cw = Math.round((sv.clientWidth || 256) * dpr), chh = Math.round((sv.clientHeight || 110) * dpr);
    if (sv.width !== cw || sv.height !== chh) Object.assign(sv, { width: cw, height: chh });   // crisp at the screen's resolution
    const c = sv.getContext('2d'), w = sv.width, ht = sv.height;
    c.fillStyle = `hsl(${hh},100%,50%)`; c.fillRect(0, 0, w, ht);
    const wg = c.createLinearGradient(0, 0, w, 0); wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = wg; c.fillRect(0, 0, w, ht);
    const bgd = c.createLinearGradient(0, 0, 0, ht); bgd.addColorStop(0, 'rgba(0,0,0,0)'); bgd.addColorStop(1, '#000');
    c.fillStyle = bgd; c.fillRect(0, 0, w, ht);
  };
  // Wheel style: a slim hue ring around a rounded SV square, drawn at the screen's resolution
  // (sized to the panel) so it stays crisp; slim ring-and-dot knobs show the colour itself.
  const wheel = h('canvas.wheel');
  let S = 0, W = 0, RO = 0, RI = 0, SQ = 0, D = 1;
  const sizeWheel = () => {
    const css = Math.round(wheel.getBoundingClientRect().width) || 220;
    D = devicePixelRatio || 1;
    if (css === S && wheel.width === Math.round(css * D)) return;
    S = css; W = S / 2; RO = W - 2; RI = RO - Math.max(10, S * 0.07); SQ = (RI - 8) / Math.SQRT2;
    wheel.width = wheel.height = Math.round(S * D);
  };
  const drawWheel = () => {
    sizeWheel();
    const c = wheel.getContext('2d');
    c.setTransform(D, 0, 0, D, 0, 0);
    c.clearRect(0, 0, S, S);
    const g = c.createConicGradient(0, W, W);
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `hsl(${i * 30},100%,50%)`);
    c.fillStyle = g; c.beginPath(); c.arc(W, W, RO, 0, TAU); c.arc(W, W, RI, 0, TAU, true); c.fill();
    c.save();
    c.beginPath(); c.roundRect(W - SQ, W - SQ, SQ * 2, SQ * 2, 6); c.clip();
    c.fillStyle = `hsl(${hh},100%,50%)`; c.fillRect(W - SQ, W - SQ, SQ * 2, SQ * 2);
    const wg = c.createLinearGradient(W - SQ, 0, W + SQ, 0); wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = wg; c.fillRect(W - SQ, W - SQ, SQ * 2, SQ * 2);
    const bg2 = c.createLinearGradient(0, W - SQ, 0, W + SQ); bg2.addColorStop(0, 'rgba(0,0,0,0)'); bg2.addColorStop(1, '#000');
    c.fillStyle = bg2; c.fillRect(W - SQ, W - SQ, SQ * 2, SQ * 2);
    c.restore();
    const knob = (x, y, r, fill) => {
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill();
      c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
      c.beginPath(); c.arc(x, y, r + 1.5, 0, TAU); c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.45)'; c.stroke();
    };
    const a = hh / 360 * TAU, rm = (RO + RI) / 2;
    knob(W + Math.cos(a) * rm, W + Math.sin(a) * rm, (RO - RI) / 2 - 1.5, `hsl(${hh},100%,50%)`);
    knob(W - SQ + ss * SQ * 2, W - SQ + (1 - vv) * SQ * 2, 5, app.color.fg);
  };
  new ResizeObserver(() => style === 'wheel' && drawWheel()).observe(wheel);
  wheel.addEventListener('pointerdown', e => {
    wheel.setPointerCapture(e.pointerId);
    const at = ev => { const r = wheel.getBoundingClientRect(), k = S / r.width; return [(ev.clientX - r.left) * k - W, (ev.clientY - r.top) * k - W]; };
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
  // One working palette. Built-ins and imported files (.gpl / .pal / .hex) are loaded into it,
  // replacing its colors; they are not browsed in place.
  let mine = local.get('pp.swatches', null) ?? allPalettes()[local.get('pp.palette', 'PixelPaint')] ?? PALETTES.PixelPaint;
  const palSel = h('span.pal-sel');
  const setMine = colors => { mine = colors; local.set('pp.swatches', mine); renderPalette(); };
  const palSw = c => {
    const b = sw(c);
    b.dataset.tip = `${c} - right-click to remove`;
    b.oncontextmenu = e => { e.preventDefault(); setMine(mine.filter(m => m !== c)); };
    return b;
  };
  const renderPalette = () => {
    palSel.replaceChildren(select([['', 'Load palette...'], ...Object.keys(allPalettes()).map(n => [n, n])], '', v => v && loadPalette(allPalettes()[v])));
    swatches.replaceChildren(...mine.map(palSw));
  };
  const savePalette = (name, colors) => local.set('pp.palettes', { ...local.get('pp.palettes', {}), [name]: colors });
  // Loading replaces your colors: a palette you built yourself is kept as "My palette" first.
  const loadPalette = colors => {
    if (!Object.values(allPalettes()).some(p => p.join() === mine.join())) savePalette('My palette', mine);
    setMine(colors);
  };
  const importPal = async () => {
    const f = await pickFile('.gpl,.pal,.hex,.txt');
    const colors = f && parsePalette(await f.text());
    if (!colors?.length) return;
    savePalette(f.name.replace(/\.\w+$/, ''), colors.slice(0, 256));
    loadPalette(colors.slice(0, 256));
  };
  const addColor = () => setMine([...new Set([...mine, app.color.fg])]);
  const eyedrop = window.EyeDropper && iconBtn('picker', 'Pick a color from anywhere on screen', async () => { try { app.setColor((await new EyeDropper().open()).sRGBHex); } catch { /* cancelled */ } });
  renderPalette();
  bus.on('color', () => { if (!self) { [hh, ss, vv] = rgbToHsv(...hexToRgb(app.color.fg)); drawSV(); } place(); });
  bus.on('history', hist => {
    if (!['Brush', 'Pencil', 'Pixel Shape', 'Fill', 'Shape'].includes(hist.done.at(-1)?.label) || recent[0] === app.color.fg) return;
    recent = [app.color.fg, ...recent.filter(c => c !== app.color.fg)].slice(0, 10);
    local.set('pp.recent', recent);
    drawRecent();
  });
  new ResizeObserver(() => style !== 'wheel' && drawSV()).observe(sv);
  drawSV(); setStyle(style); drawRecent();
  return h('div.picker', {},
    segmented([['square', 'Square', 'marquee'], ['wheel', 'Wheel', 'palette']], style, setStyle, true),
    pads,
    h('div.picker-row', {}, h('div.chips.inline', {}, bg, fg), icon('palette'), hex, eyedrop),
    h('div.picker-row', {}, palSel, iconBtn('plus', 'Add current color to the palette', addColor), iconBtn('upload', 'Import palette (.gpl, .pal, .hex)', importPal)),
    swatches, h('div.sub-label', {}, 'Recent'), recents);
}
