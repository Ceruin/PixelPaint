import { h } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { drawIcon, iconSize } from './pixelIcons.js';
import { artCanvas } from './pixelArt.js';
import { rotated, centreOfMass, Pendulum, Settle } from './pyxlPhysics.js';
import { PyxlStats, LESSONS, TYPES, currentLesson } from './pyxlStats.js';
import { openCareCard } from './pyxlCare.js';
import { startGame } from './pyxlGames.js';
import { startRace, RACES, medalName } from './pyxlRace.js';
import { radio, sfx } from './pyxlAudio.js';

// Pyxl — pixel sprites rebuilt from the character sheet at their native resolution (one art pixel
// per sprite pixel, shared palette, 1px outline). Always drawn at an integer scale so she stays crisp.
const atlas = new Image();
atlas.src = 'assets/pyxl-pixel.webp';
export const atlasReady = atlas.decode().catch(() => {});

// Outfit: her teal smock (and the teal paint on her beret) is recoloured to the colour you're
// painting with. Greys keep her last colourful outfit; the default is her original teal.
// Tinted atlases are cached per colour (race rivals wear other colours).
const hsv = (r, g, b) => { const v = Math.max(r, g, b), d = v - Math.min(r, g, b); return [d === 0 ? 0 : v === r ? ((g - b) / d + 6) % 6 * 60 : v === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60, v ? d / v : 0, v / 255]; };
const rgb = (hh, s, v) => { const f = n => { const k = (n + hh / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); }; return [f(5), f(3), f(1)]; };
const isTeal = (hh, s, v) => hh > 150 && hh < 205 && s > 0.25 && v > 0.2;
const tints = new Map();
export function tinted(hex) {
  if (!atlas.complete) return atlas;
  if (tints.has(hex)) return tints.get(hex);
  const [th, ts, tv] = hsv(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  const out = document.createElement('canvas');
  Object.assign(out, { width: atlas.width, height: atlas.height });
  const c = out.getContext('2d');
  c.drawImage(atlas, 0, 0);
  const img = c.getImageData(0, 0, atlas.width, atlas.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const [hh, s, v] = hsv(d[i], d[i + 1], d[i + 2]);
    if (!isTeal(hh, s, v)) continue;
    const [r, g, b] = rgb(th, Math.min(1, ts * s / 0.6), Math.min(1, v * tv / 0.62));
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  c.putImageData(img, 0, 0);
  if (tints.size > 12) tints.delete(tints.keys().next().value);
  tints.set(hex, out);
  return out;
}
let outfitHex = null;
export function setOutfit(hex) {
  if (!atlas.complete || hex === outfitHex) return;
  const [, ts, tv] = hsv(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  if (ts < 0.25 || tv < 0.3) return;
  outfitHex = hex;
}
const sheet = () => (outfitHex ? tinted(outfitHex) : atlas);
// name: [x, y, w, h, anchorX (beret centre), feet line]. 'side' faces left natively, action poses face right.
export const SPRITES = {
  front: [0, 6, 34, 53, 15, 51], frontBlink: [35, 6, 34, 53, 15, 51], side: [70, 7, 31, 52, 17, 50], back: [102, 8, 33, 51, 16, 50],
  idle0: [136, 5, 48, 54, 23, 52], idle1: [185, 5, 50, 54, 22, 52], walk: [236, 5, 51, 54, 22, 52], brush: [288, 5, 61, 54, 22, 52],
  paint: [350, 5, 89, 54, 29, 51], raise: [440, 1, 56, 58, 20, 54], point: [497, 1, 59, 58, 23, 53], floor: [557, 8, 64, 51, 26, 49],
  cheer: [622, 1, 61, 58, 21, 50], spray: [684, 0, 86, 59, 33, 53], happy: [771, 0, 64, 59, 22, 55], oops: [836, 0, 62, 59, 23, 55],
  drowsy: [899, 5, 58, 54, 21, 48], sleep: [958, 16, 75, 43, 29, 34],
};

// Draws a pose with its beret centre at x and feet at y (native pixels), scaled by integer k.
// `breath` sinks everything above the waist by that many pixels (a 1px exhale reads as breathing).
export function drawPose(ctx, name, x, y, k, flip = false, breath = 0, src = sheet()) {
  x = Math.round(x); y = Math.round(y);   // whole sprite pixels only: fractional positions sample into mixels
  const [sx, sy, w, hh, ax, by] = SPRITES[name], cut = Math.max(0, by - 22);
  const part = (y0, y1, dy) => y1 > y0 && ctx.drawImage(src, sx, sy + y0, w, y1 - y0, flip ? -ax * k : (x - ax) * k, (y - by + y0 + dy) * k, w * k, (y1 - y0) * k);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) { ctx.translate(x * k, 0); ctx.scale(-1, 1); }
  part(cut, hh, 0);
  part(0, cut, breath);
  ctx.restore();
}

const BOX_W = 92, BOX_H = 76, AX = 36, FLOOR = 74;
const PIV = [46, 13], GRIP = [46, 12];   // where the grab point sits in her box; her brush head in the 'raise' pose

// Behaviour table: poses to cycle (fps), duration (or hold), breathing period (s) and motion flavour.
// `prop` names an extra drawn with the pose (instrument, toy, drawing…); `emote` forces the emote ball.
const STATES = {
  idle: { poses: ['front'], hold: true, breath: 1.8 },
  think: { poses: ['front', 'side', 'front'], fps: 0.8, dur: 3200, breath: 1.8, emote: 'what' },
  glance: { poses: ['front', 'side', 'side', 'side', 'front'], fps: 1.6, dur: 3000, breath: 1.8 },
  peek: { poses: ['side', 'back', 'back', 'back', 'side'], fps: 1.6, dur: 3000, breath: 1.8 },
  stretch: { poses: ['front', 'raise', 'raise', 'front'], fps: 1.4, dur: 2800, breath: 1.2 },
  yawn: { poses: ['drowsy', 'front'], fps: 0.7, dur: 2600 },
  walk: { poses: ['idle0', 'idle1', 'walk', 'idle1'], fps: 6, hold: true, walk: true },
  trip: { poses: ['floor'], dur: 1400, shake: true, emote: 'swirl' },
  wave: { poses: ['raise', 'idle1'], fps: 3, dur: 1600 },
  paint: { poses: ['brush', 'paint'], fps: 4, dur: 1300 },
  spray: { poses: ['spray'], dur: 1100 },
  point: { poses: ['point'], hold: true, breath: 1.8 },
  raise: { poses: ['raise'], hold: true, breath: 1.8 },
  reach: { poses: ['raise', 'point'], fps: 2, hold: true },
  cheer: { poses: ['cheer', 'happy'], fps: 4, dur: 2200, hop: true, emote: 'heart' },
  dance: { poses: ['cheer', 'happy', 'raise', 'happy'], fps: 3, hold: true, hop: true },
  happy: { poses: ['happy'], dur: 1400, hop: true, emote: 'heart' },
  eat: { poses: ['happy', 'idle1'], fps: 3, dur: 2000, emote: 'heart' },
  oops: { poses: ['oops'], dur: 900, shake: true, emote: 'bang' },
  refuse: { poses: ['oops'], dur: 1300, shake: true, emote: 'swirl' },
  tantrum: { poses: ['oops', 'raise'], fps: 5, dur: 2000, shake: true, emote: 'swirl' },
  cry: { poses: ['oops', 'front'], fps: 1.5, dur: 2800, tears: true },
  sit: { poses: ['floor'], hold: true, breath: 2.2 },
  drowsy: { poses: ['drowsy'], hold: true, breath: 2.6 },
  sleep: { poses: ['sleep'], hold: true, breath: 3, zzz: true },
  // in-betweens: nodding off, waking up, sitting down and getting up again
  doze: { poses: ['front', 'drowsy', 'front', 'drowsy', 'drowsy', 'sleep'], fps: 1.8, dur: 3300, emote: 'dots' },
  wake: { poses: ['sleep', 'drowsy', 'drowsy', 'raise', 'raise', 'frontBlink', 'front'], fps: 2.2, dur: 3200, emote: 'what' },
  sitDown: { poses: ['idle1', 'floor'], fps: 2.5, dur: 800 },
  standUp: { poses: ['floor', 'idle1'], fps: 2.5, dur: 800 },
  // care: a happy wiggle when petted, a brave gulp of medicine, walking off to school and back
  purr: { poses: ['happy', 'frontBlink', 'happy', 'front'], fps: 2.5, dur: 1800, sway: true, emote: 'heart' },
  gulp: { poses: ['oops', 'front', 'oops', 'happy'], fps: 2, dur: 1800, shake: true, emote: 'swirl' },
  depart: { poses: ['idle0', 'idle1', 'walk', 'idle1'], fps: 6, dur: 1800, walkOff: 1 },
  arrive: { poses: ['idle0', 'idle1', 'walk', 'idle1'], fps: 6, dur: 1400, walkOff: -1 },
  sick: { poses: ['drowsy'], hold: true, breath: 2 },
  bloom: { poses: ['floor'], dur: 6000, breath: 2, prop: 'bloom', emote: 'heart' },
  // picked up and carried: arms up, legs kicking, swaying under your finger
  held: { poses: ['raise'], hold: true, held: true, emote: 'bang' },
  land: { poses: ['oops', 'happy'], fps: 2, dur: 1300 },
  // kindergarten skills
  instrument: { poses: ['raise', 'brush'], fps: 2.5, dur: 3600, prop: 'instrument', notes: true },
  gogo: { poses: ['cheer', 'happy'], fps: 5, dur: 3200, hop: true, flipEvery: 0.4, notes: true },
  shake: { poses: ['happy', 'cheer'], fps: 2, dur: 3000, shake: true, notes: true },
  spin: { poses: ['front', 'side', 'back', 'side'], fps: 6, dur: 2800, spin: true, notes: true },
  step: { poses: ['idle0', 'walk', 'idle1', 'walk'], fps: 4, dur: 3200, step: true, notes: true },
  exercise: { poses: ['front', 'raise', 'front', 'floor'], fps: 2, dur: 3600, hop: true },
  sing: { poses: ['front', 'happy'], fps: 1.4, dur: 3400, notes: true, breath: 1 },
  draw: { poses: ['brush', 'paint', 'brush'], fps: 2.5, dur: 2600 },
  showDrawing: { poses: ['point'], dur: 3000, prop: 'drawing', emote: 'bang' },
  // toys
  ball: { poses: ['walk', 'cheer', 'walk', 'happy'], fps: 3, dur: 3200, prop: 'ball' },
  box: { poses: ['front', 'front', 'happy'], fps: 1, dur: 3000, prop: 'box' },
  radio: { poses: ['cheer', 'happy'], fps: 4, dur: 3600, hop: true, prop: 'radio', notes: true },
  tv: { poses: ['floor'], dur: 3600, prop: 'tv', breath: 2 },
  // radio on: she sits by it and bobs along to the beat until you switch it off
  vibe: { poses: ['front', 'happy', 'front', 'idle1'], fps: 1.2, hold: true, prop: 'radio', notes: true, sway: true },
  // quiet mode: she won't say a word — just sits there, a little sad, sniffling now and then
  sulk: { poses: ['floor'], hold: true, breath: 3, tears: 'slow', emote: 'drop' },
  crayons: { poses: ['brush', 'paint'], fps: 3, dur: 2400, prop: 'crayons' },
  // life cycle (drawn procedurally, no sprite)
  egg: { poses: ['front'], hold: true, special: 'egg' },
  hatch: { poses: ['front'], dur: 1800, special: 'hatch' },
  cocoon: { poses: ['front'], hold: true, special: 'cocoon' },
  school: { poses: ['front'], hold: true, special: 'school' },
};
const FIDGETS = ['glance', 'walk', 'peek', 'stretch', 'glance', 'walk', 'wave', 'paint', 'think'];
const RANGE = [-10, 20]; // how far (native px) she strolls from her spot
const NEED_ICON = { hungry: 'onigiri', lonely: 'heart', bored: 'dots', tired: 'moon', sad: 'drop' };
const DANCES = { gogo: 'gogo', shake: 'shake', spin: 'spin', step: 'step' };
const DRAWINGS = ['sun', 'flower', 'cake', 'car', 'house'];
const SONGS = ['La la la ♪', 'Do re mi ♪', 'Paint it bright ♪', 'Pixels in a row ♪', 'We make art together ♪'];
const AIMED = new Set(['spray', 'point', 'paint']);
const SICK = { cough: ['drowsy', 'dots'], stomach: ['floor', 'swirl'], cold: ['floor', 'drop'], rash: ['front', 'plus'], hiccups: ['front', 'bang'], nose: ['drowsy', 'drop'] };
// Things she likes to mention while you work (chatty Pyxls mention them more).
const TIPS = ['Tip: [ and ] resize the brush.', 'Tip: hold Space to pan around.', 'Tip: two-finger tap undoes!', 'Tip: Alt-click picks a colour.',
  'Tip: right-click for a quick palette.', 'Tip: Tab hides everything (Focus).', 'Tip: Shift+M mirrors the view.', 'Tip: onion skin shows other frames.',
  'Tip: F1 opens the guide.', 'Tip: Ctrl+J duplicates a layer.', 'Tip: Alt+1 and Alt+2 switch Draw and Notes.'];
const ACTIONS = [
  // [label pattern, reaction, particle, skill trained, amount]
  [/^(Brush|Smudge|Shape|Eraser)$/, 'paint', null, 'line', 6],
  [/^Fill$/, 'spray', 'drop', 'colour', 8],
  [/Replace Colo|Hue|Brightness|Desaturate|Invert/, 'cheer', 'sparkle', 'colour', 8],
  [/^(New Layer|New Group|Group Layer|Duplicate|New Frame|Duplicate Frame|New Tag|New Filter Layer|Import Frames)$/, 'wave', 'plus', 'shape', 3],
  [/^(Delete Layer|Delete Frame|Clear|Cut|Blank Cel|Clear Cel|Clear Canvas)$/, 'oops', 'bang', null, 0],
  [/Select|Lasso|Wand|Marquee|Deselect|Invert Selection|Feather/, 'think', null, 'shape', 4],
  [/Transform|Text|Move/, 'point', 'sparkle', 'shape', 6],
  [/Rotate|Flip|Resize|Crop|Canvas Size|Image Size/, 'spin', null, 'shape', 4],
  [/Blur|Outline|Adjust|Merge|Flatten|Filter/, 'cheer', 'sparkle', 'power', 6],
];
// A friendly name for a colour ("soft pink", "deep blue", "grey"…).
function colourName(hex) {
  const [hh, s, v] = hsv(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  if (s < 0.15) return v > 0.85 ? 'white' : v < 0.2 ? 'black' : 'grey';
  const base = hh < 15 ? 'red' : hh < 40 ? 'orange' : hh < 65 ? 'yellow' : hh < 160 ? 'green' : hh < 195 ? 'teal' : hh < 255 ? 'blue' : hh < 290 ? 'purple' : hh < 335 ? 'pink' : 'red';
  return `${v < 0.45 ? 'deep ' : s < 0.45 && v > 0.8 ? 'soft ' : ''}${base}`;
}
const lum = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255; };

// Pixel ovals for the egg and cocoon: outline, shading and a highlight, drawn pixel by pixel.
function drawOval(ctx, cx, bottom, rx, ry, [fill, shade, light], k, { top = 0.85, spots = null, stripes = null } = {}) {
  const cy = bottom - ry;
  for (let y = -ry; y <= ry; y++) {
    const rxy = rx * (y < 0 ? top : 1);
    for (let x = -Math.ceil(rxy); x <= Math.ceil(rxy); x++) {
      const d = (x * x) / (rxy * rxy) + (y * y) / (ry * ry);
      if (d > 1) continue;
      const edge = (x * x) / ((rxy - 1) ** 2) + (y * y) / ((ry - 1) ** 2) > 1;
      let c = edge ? '#221822' : x + y > rx * 0.6 ? shade : x < -rxy * 0.3 && y < -ry * 0.3 ? light : fill;
      if (!edge && spots?.some(([sx, sy]) => Math.abs(x - sx) + Math.abs(y - sy) < 2)) c = spots.color;
      if (!edge && stripes && (y + ry) % stripes === 0) c = shade;
      ctx.fillStyle = c;
      ctx.fillRect((cx + x) * k, (cy + y) * k, k, k);
    }
  }
}

export class Mascot {
  constructor(app) {
    this.app = app;
    this.stats = new PyxlStats();
    this.canvas = h('canvas.pyxl-canvas');
    this.bubble = h('div.m-bubble');
    this.el = h('div.mascot', { 'data-tip': 'Pyxl — click to care for her' }, this.canvas);
    document.body.append(this.bubble);   // floats above every panel and the canvas; follows her
    this.bubble.addEventListener('click', () => { clearTimeout(this.sayTimer); this.bubble.textContent = ''; });   // tap a bubble to dismiss it
    this.silent = local.get('pp.pyxlSilent', false);
    Object.assign(this, { parts: [], k: 1, flip: false, pets: [], undos: [], lastUndone: 0, lastActive: Date.now(), sessionStart: Date.now(), strokes: 0,
      nextFidget: Date.now() + 6000, nextNeed: 0, nextSymptom: 0, nextTip: Date.now() + 90e3, pos: 0, path: [], blinkAt: Date.now() + 3000, emote: null, taps: 0 });
    this.el.addEventListener('click', () => { if (!this.dragged) this.onClick(); this.dragged = false; });
    this.makeDraggable();
    this.el.addEventListener('pointerenter', () => this.greet());
    this.el.addEventListener('pointerleave', () => { this.hovered = false; });
    addEventListener('pointermove', e => { this.cursor = { x: e.clientX, y: e.clientY, t: Date.now() }; }, { passive: true });
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (Date.now() - hiddenAt > 60000 && this.awake()) {
        if (this.stats.is('lonely')) this.react('cry', { say: 'Where did you go?!' });
        else this.react('happy', { icon: 'heart', n: 2, say: 'You’re back!' });
      }
    });
    atlasReady.then(() => this.app && setOutfit(this.app.color.fg));
    new ResizeObserver(() => this.fit()).observe(this.el);
    this.wire();
    this.base();
    setInterval(() => this.tick(), 1000 / 12);   // behaviour at 12 fps; drawing and the bubble at display rate
    this.hangCv = h('canvas.pyxl-hang');
    let last = 0;
    const frame = now => { requestAnimationFrame(frame); if (document.hidden || now - last < (this.minFrame || 0) - 1) return; last = now; this.render(); if (this.bubble.textContent) this.placeBubble(); };
    requestAnimationFrame(frame);
    setTimeout(() => this.greeting(), 1800);
  }

  get name() { return this.stats.name; }
  awake() { return !this.stats.asleep && !['egg', 'school'].includes(this.stats.need) && !['cocoon', 'hatch'].includes(this.state); }
  // (No measuring here: this runs mid mode-switch; the ResizeObserver re-fits her after layout.)
  mount(host) {
    this.home = host;
    if (this.floating) {   // a spot saved last session that sits on her home is just home
      if (!this.homeChecked) { this.homeChecked = true; requestAnimationFrame(() => requestAnimationFrame(() => this.floating && !this.phys && this.nearHome() && this.goHome())); }
      return;
    }
    if (host && this.el.parentElement !== host) { host.append(this.el); this.el.style.translate = ''; this.box = null; }
    requestAnimationFrame(() => requestAnimationFrame(() => { this.keepInView(); this.placeBubble(); }));   // after the new mode's layout
  }

  // ---- pick her up and put her anywhere ----
  // Press and move to lift her (a plain tap still opens her card). Dropped away from her spot she
  // stays there, in every mode, and is kept on screen; dropped near her spot she goes home.
  makeDraggable() {
    const saved = local.get('pp.pyxlPos', null);
    this.floatBox = h('div.pyxl-float');
    if (saved) this.float(saved.x, saved.y);
    const reclamp = () => (this.floating ? this.float(this.floatPos.x, this.floatPos.y) : this.keepInView());
    addEventListener('resize', reclamp); visualViewport?.addEventListener('resize', reclamp);
    this.el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.phys) return;
      // her school bag or egg just slides where you put it; Pyxl herself hangs from your pointer
      const slide = !this.awake() && !this.stats.asleep, r0 = this.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      let lifting = false;
      // window listeners: moving her into the floating box would drop an element pointer capture
      const move = ev => {
        if (ev.pointerId !== e.pointerId || !lifting && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
        if (!lifting) { lifting = true; if (!slide) this.lift(ev); }
        if (slide) return this.float(r0.left + ev.clientX - x0, r0.top + ev.clientY - y0, false);
        this.grab = { x: ev.clientX, y: ev.clientY };   // the frame loop draws her there
        (this.trail ??= []).push({ x: ev.clientX, y: ev.clientY, t: ev.timeStamp });
        if (this.trail.length > 8) this.trail.shift();
      };
      const up = ev => {
        if (ev.pointerId !== e.pointerId) return;
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (!lifting) return;
        this.dragged = true; setTimeout(() => { this.dragged = false; });
        if (!slide) return this.drop(ev.timeStamp);
        if (this.nearHome()) this.goHome(); else local.set('pp.pyxlPos', this.floatPos);
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
  }
  // She grabs the pen/cursor by her brush and hangs from it (the pivot follows the pointer).
  lift(ev) {
    const s = this.stats;
    this.grab = { x: ev.clientX, y: ev.clientY };
    this.phys = { hang: new Pendulum(), v: [0, 0], a: [0, 0], last: null };
    this.hangAt();
    this.el.classList.add('hanging'); document.body.append(this.hangCv);
    this.runPhysics();
    if (s.asleep) { s.sleep(false); s.feel('anger', 15); }
    this.heldAt = Date.now();
    this.play('held', { say: ['Wheee!', 'Whoa!', 'Up we go!'][Math.floor(Math.random() * 3)] });
    s.change({ fun: 3 }); s.feel('joy', 10);
  }
  // Where her box must be for the grab point to sit under the pointer (not clamped while held).
  hangAt() {
    const sc = this.k / (devicePixelRatio || 1), c = this.canvas;
    this.float(this.grab.x - c.offsetLeft - PIV[0] * sc, this.grab.y - c.offsetTop - PIV[1] * sc, false, true);
  }
  // Let go: a quick flick throws her (she tumbles, bounces off the window's edges and lands in a
  // heap); a slow release sets her down gently where she is.
  drop(t = performance.now()) {
    const tr = (this.trail ?? []).filter(p => t - p.t < 100), a = tr[0], b = tr.at(-1), dt = a && (b.t - a.t) / 1000;
    this.trail = [];
    const v = dt > 0.012 ? [(b.x - a.x) / dt, (b.y - a.y) / dt] : [0, 0];
    if (Math.hypot(...v) > 1100 && document.body.dataset.theme !== 'paper') return this.fling(v);
    this.land(this.hangAngle(), this.phys?.hang?.om ?? 0, -16);
  }
  fling([vx, vy]) {
    const A = this.hangAngle(), [cx, cy] = centreOfMass(sheet(), SPRITES.raise), sc = this.k / (devicePixelRatio || 1), dx = cx - GRIP[0], dy = cy - GRIP[1];
    const cap = v => Math.max(-3500, Math.min(3500, v));
    // she flies about her centre of mass, starting where it hangs now
    this.phys = { fly: { x: this.grab.x + (dx * Math.cos(A) - dy * Math.sin(A)) * sc, y: this.grab.y + (dx * Math.sin(A) + dy * Math.cos(A)) * sc, vx: cap(vx), vy: cap(vy), th: A, om: (this.phys?.hang?.om ?? 0) + vx / 220, hits: 0 } };
    this.say(['Wheeeee!', 'Aaaah!', 'Whoooa!'][Math.floor(Math.random() * 3)]);
    this.stats.feel('fear', 10);
  }
  // One physics step of her flight; true when she has come to rest on the window's floor.
  flyStep(f, dt) {
    const vv = window.visualViewport, sc = this.k / (devicePixelRatio || 1), r = 24 * sc, m = 2;
    const L = (vv?.offsetLeft ?? 0) + m + r, T = (vv?.offsetTop ?? 0) + m + r, R = (vv?.offsetLeft ?? 0) + (vv?.width ?? innerWidth) - m - r, B = (vv?.offsetTop ?? 0) + (vv?.height ?? innerHeight) - m - r;
    f.vy += 2200 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.th += f.om * dt;
    const hit = speed => { if (speed > 350) { f.hits++; sfx('bonk'); this.showEmote('bang', 500); if (f.hits === 2) this.say('Ow!'); } };
    if (f.x < L || f.x > R) { hit(Math.abs(f.vx)); f.x = f.x < L ? L : R; f.vx = -f.vx * 0.55; f.om = -f.om * 0.6 + f.vy / 600; }
    if (f.y < T) { hit(Math.abs(f.vy)); f.y = T; f.vy = Math.abs(f.vy) * 0.5; }
    if (f.y >= B) {
      f.y = B;
      if (f.vy > 260) { hit(f.vy); f.vy = -f.vy * 0.45; f.om = f.om * 0.5 + f.vx / 300; f.vx *= 0.8; }
      else { f.vy = 0; f.vx *= Math.max(0, 1 - 7 * dt); f.om = f.vx / (r * 1.2); }   // rolling to a stop
    }
    return f.y >= B && f.vy === 0 && Math.abs(f.vx) < 50;
  }
  // After a flight: stand her up where she stopped, then wobble upright.
  touchdown(f) {
    const sc = this.k / (devicePixelRatio || 1), B = (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? innerHeight) - 4;
    this.grab = { x: f.x, y: B - (FLOOR - PIV[1]) * sc };
    this.land(f.th, f.om * 0.3, -4);
    const s = this.stats;
    if (f.hits >= 2) setTimeout(() => {
      if (s.personality === 'energetic' || s.emo.joy > 60) this.react('cheer', { icon: 'star', n: 3, say: 'Again! Again!', force: true });
      else { this.react('trip', { say: 'So dizzy… @_@', force: true }); s.feel('anger', 8); }
    }, 900);
  }
  land(angle, om, fall) {
    const ang = Math.atan2(Math.sin(angle), Math.cos(angle));   // -π…π after any loops
    this.hangAt();
    this.el.classList.remove('hanging'); this.hangCv.remove();
    this.pos = PIV[0] - AX;   // stand right under where she hung
    this.phys = document.body.dataset.theme === 'paper' ? null : { settle: new Settle(Math.max(-0.7, Math.min(0.7, ang)), om, fall) };   // e-ink: no wobble
    if (this.phys) this.runPhysics(); else this.keepInView();
    const nearHome = this.nearHome();
    if (nearHome) this.goHome();
    else local.set('pp.pyxlPos', this.floatPos);
    const long = Date.now() - this.heldAt > 6000;
    this.play('land', { say: nearHome ? 'Home sweet home!' : long ? 'Phew, finally!' : Math.random() < 0.5 ? 'I like it here!' : '' });
    if (long) this.stats.feel('anger', 10);
  }
  float(x, y, save = true, free = false) {
    const b = this.floatBox, dpr = devicePixelRatio || 1;
    this.floatPos = { x: Math.round(x * dpr) / dpr, y: Math.round(y * dpr) / dpr };
    Object.assign(b.style, { left: `${this.floatPos.x}px`, top: `${this.floatPos.y}px` });
    if (!this.floating) { this.floating = true; document.body.append(b); b.append(this.el); this.el.classList.add('floating'); this.el.style.translate = ''; bus.emit('pyxl:stats', this.stats); }
    this.box = null;
    if (!free) this.keepInView();
    if (save) local.set('pp.pyxlPos', this.floatPos);
  }

  // Her whole sprite always stays on screen: inside the visible viewport and any panel that clips
  // her. A floating Pyxl moves; a docked one is nudged with a translate (whole device pixels).
  keepInView() {
    if (this.phys) return;
    const cr = this.canvas.getBoundingClientRect(), sb = this.spriteBox;
    if (!cr.width || !sb) return;
    const sc = cr.width / BOX_W, c = { left: cr.left + sb[0] * sc, top: cr.top + sb[1] * sc, right: cr.left + sb[2] * sc, bottom: cr.top + sb[3] * sc };
    const vv = window.visualViewport, m = 4, dpr = devicePixelRatio || 1;
    let L = (vv?.offsetLeft ?? 0) + m, T = (vv?.offsetTop ?? 0) + m, R = L - 2 * m + (vv?.width ?? innerWidth), B = T - 2 * m + (vv?.height ?? innerHeight);
    if (!this.floating) for (let a = this.el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
      const q = a.getBoundingClientRect();
      L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
    }
    const snap = v => Math.round(v * dpr) / dpr;
    const dx = snap(c.left < L ? L - c.left : c.right > R ? Math.max(L - c.left, R - c.right) : 0);
    const dy = snap(c.top < T ? T - c.top : c.bottom > B ? Math.max(T - c.top, B - c.bottom) : 0);
    if (!dx && !dy) return;
    if (this.floating) { this.floatPos.x += dx; this.floatPos.y += dy; Object.assign(this.floatBox.style, { left: `${this.floatPos.x}px`, top: `${this.floatPos.y}px` }); local.set('pp.pyxlPos', this.floatPos); }
    else { const [ox = 0, oy = 0] = (this.el.style.translate || '').split(' ').map(parseFloat); this.el.style.translate = `${snap(ox + dx)}px ${snap(oy + dy)}px`; }
    this.box = null;
    this.placeBubble();
  }

  // Frame-rate physics while she hangs or lands (the 12 fps behaviour tick keeps running too).
  runPhysics() {
    if (this.physRaf) return;
    let last = performance.now();
    const step = now => {
      const ph = this.phys, dt = Math.min(1 / 30, (now - last) / 1000) || 1 / 60;
      last = now;
      if (!ph) { this.physRaf = 0; return; }
      if (ph.hang) {
        const g = this.grab, pv = ph.last ?? g, v = [(g.x - pv.x) / dt, (g.y - pv.y) / dt];
        const a = v.map((vi, i) => (vi - ph.v[i]) / dt);
        ph.a = ph.a.map((ai, i) => ai * 0.6 + a[i] * 0.4); ph.v = v; ph.last = { ...g };
        const [cx, cy] = centreOfMass(sheet(), SPRITES.raise);
        ph.hang.step(dt, ph.a[0], ph.a[1], Math.hypot(cx - GRIP[0], cy - GRIP[1]) * this.k / (devicePixelRatio || 1));
      } else if (ph.fly) { if (this.flyStep(ph.fly, dt)) this.touchdown(ph.fly); }
      else if (!ph.settle.step(dt)) { this.phys = null; this.keepInView(); this.physRaf = 0; return; }
      this.render();   // same frame as the step (the frame loop then finds nothing new)
      if (this.bubble.textContent) this.placeBubble();
      this.physRaf = requestAnimationFrame(step);
    };
    this.physRaf = requestAnimationFrame(step);
  }
  // Her on-screen tilt while hanging: the natural hang of the pose (centre of mass under the grip) plus the swing.
  hangAngle() {
    const [cx, cy] = centreOfMass(sheet(), SPRITES.raise);
    return Math.atan2(cx - GRIP[0], cy - GRIP[1]) + (this.phys?.hang?.th ?? 0);
  }
  // Dropped (or restored) on or next to her spot in this mode counts as home.
  nearHome() {
    const home = this.home?.getBoundingClientRect(), me = this.el.getBoundingClientRect();
    if (!home?.width || !me.width) return false;
    const overlap = me.left < home.right && me.right > home.left && me.top < home.bottom && me.bottom > home.top;
    return overlap || Math.hypot(me.left + me.width / 2 - (home.left + home.width / 2), me.bottom - home.bottom) < 100;
  }
  goHome() {
    this.floating = false;
    bus.emit('pyxl:stats', this.stats);   // her card swaps "Send Pyxl home" for the drag tip
    local.set('pp.pyxlPos', null);
    this.el.classList.remove('floating');
    this.floatBox.remove();
    const host = this.home;
    this.home = null;
    this.mount(host);
  }

  fit() {
    const dpr = devicePixelRatio || 1, r = this.el.getBoundingClientRect();
    if (!r.height) return;
    this.k = Math.max(1, Math.floor(Math.min(r.height * dpr / BOX_H, (r.width + 24) * dpr / BOX_W)));
    Object.assign(this.canvas, { width: BOX_W * this.k, height: BOX_H * this.k });
    this.drawn = null; this.box = null;
    this.placeBubble();
    // 1 canvas pixel = 1 device pixel, centred on a whole device pixel (no resampling)
    Object.assign(this.canvas.style, { width: `${BOX_W * this.k / dpr}px`, height: `${BOX_H * this.k / dpr}px`, left: `${Math.round((r.width * dpr - BOX_W * this.k) / 2) / dpr}px` });
    this.keepInView();
  }

  // Aimed poses (spraying a fill, pointing, painting) face what you just worked on: the last spot
  // you touched on the canvas, else the canvas's middle. They're drawn facing right.
  facesLeft() {
    const me = this.el.getBoundingClientRect(), stage = document.getElementById('stage')?.getBoundingClientRect();
    if (!me.width) return false;
    const c = this.cursor, recent = c && Date.now() - c.t < 4000;
    const tx = recent ? c.x : stage?.width ? stage.left + stage.width / 2 : innerWidth / 2;
    return tx < me.left + me.width / 2;
  }

  // A hello that depends on the time of day and how long you've been away.
  greeting() {
    if (!this.awake()) return;
    const hr = new Date().getHours(), n = this.name;
    if (this.stats.welcomeBack) return this.react('happy', { icon: 'heart', say: `Welcome back! ${n} missed you.` });
    this.react('wave', { say: hr < 5 ? 'Burning the midnight oil?' : hr < 12 ? 'Good morning!' : hr < 18 ? 'Hi there!' : 'Good evening!' });
  }

  // ---- state machine ----
  play(name, { dur, say = '', flip, extra } = {}) {
    const st = STATES[name];
    this.state = name;
    this.extra = extra;
    this.started = performance.now();
    this.until = st.hold && dur == null ? Infinity : Date.now() + (dur ?? st.dur ?? 1500);
    if (flip != null) this.flip = flip; else if (!st.walk && !st.breath) this.flip = false;
    if (st.walk) this.path = [RANGE[0] + Math.random() * (RANGE[1] - RANGE[0]), Math.random() < 0.5 ? 0 : RANGE[0] + Math.random() * (RANGE[1] - RANGE[0])].map(Math.round);
    if (name === 'glance') this.flip = Math.random() < 0.5;
    if (say) this.say(say);
    this.el.dataset.state = name;
  }

  // Quiet Pyxls keep most thoughts to themselves; chatty ones say everything.
  say(text, ms = 1800) {
    if (this.silent && text) return;
    clearTimeout(this.sayTimer);
    this.bubble.textContent = text;
    if (text) this.placeBubble();
    if (text) this.sayTimer = setTimeout(() => { this.bubble.textContent = ''; }, ms + text.length * 25);
  }
  // The bubble lives at the top of the page (no panel can clip it): placed over her head, kept
  // inside the window, its tail pointing at her. Re-placed every tick while it's showing.
  placeBubble() {
    const b = this.bubble;
    if (!b.textContent) return;
    let ax, ay;
    const air = this.phys?.hang ? this.grab : this.phys?.fly;
    if (air) { ax = air.x; ay = air.y - 14 - (this.phys.fly ? 30 * this.k / (devicePixelRatio || 1) : 0); }   // over the hand holding her (or over her, mid-air)
    else {
      // her cached box (re-measured at most twice a second, or after she moves) — no layout per frame
      const e = this.rect(), sc = this.k / (devicePixelRatio || 1);
      if (!e.width) { b.style.visibility = 'hidden'; b.at = null; return; }
      const cl = e.left + (e.width - BOX_W * sc) / 2, ct = e.bottom - BOX_H * sc;   // the canvas: centred, on her box's floor
      ax = cl + (AX + this.pos) * sc; ay = ct + (FLOOR - 60) * sc;
    }
    if (b.sized !== b.textContent) { b.sized = b.textContent; b.size = [b.offsetWidth, b.offsetHeight]; }   // measure once per message
    const [w, hh] = b.size, m = 8, left = Math.round(Math.max(m, Math.min(innerWidth - m - w, ax - w / 2))), top = Math.round(Math.max(m, ay - hh - 6));
    if (b.at === `${left},${top}`) return;
    b.at = `${left},${top}`;
    b.style.visibility = '';
    b.style.transform = `translate(${left}px, ${top}px)`;   // compositor-only: no layout per frame
    b.style.setProperty('--tail', `${Math.max(10, Math.min(w - 10, ax - left))}px`);
  }
  chat(text) { if (!this.stats.is('quiet') || Math.random() < 0.3) this.say(text); }
  showEmote(name, ms = 1500) { this.emote = { name, until: Date.now() + ms }; }

  // Resting behaviour follows her most pressing need.
  base() {
    const need = this.stats.need, from = this.state;
    if (need === 'asleep' && from && !['sleep', 'doze'].includes(from)) return this.play('doze');   // she nods off first
    if (from === 'sleep' && need !== 'asleep') return this.play('wake');
    if (from === 'sit' && !this.silent && (need !== 'bored' || Date.now() - this.lastActive < 20000)) return this.play('standUp');
    if (need === 'egg') return this.play('egg');
    if (need === 'school') return this.play('school');
    if (need === 'asleep') return this.play('sleep');
    if (need === 'sick') return this.play('sick');
    if (need === 'tired') return this.play('drowsy');
    if (this.silent) return this.play('sulk');
    if (radio.on) return this.play('vibe');
    if (need === 'bored' && Date.now() - this.lastActive > 20000) return this.play(from === 'sit' ? 'sit' : 'sitDown');
    this.play('idle');
  }

  react(name, { icon, n = 3, say, color, dur, force, extra } = {}) {
    if (!force && (!this.awake() || this.silent || ['dance', 'held'].includes(this.state))) return;
    this.play(name, { dur, say, extra, flip: AIMED.has(name) ? this.facesLeft() : undefined });
    if (icon) this.burst(icon, n, color);
  }

  burst(icon, n = 3, color) {
    for (let i = 0; i < n; i++) this.parts.push({ icon, color, x: AX - 12 + Math.random() * 24, y: FLOOR - 56 - Math.random() * 6, vx: (Math.random() - 0.5) * 0.6, vy: -0.5 - Math.random() * 0.5, life: 22 + i * 4 });
  }

  tick() {
    const now = Date.now(), st = STATES[this.state], s = this.stats;
    if (now > this.until) this.afterState();
    this.lifeCycle(now);
    if (!this.awake()) return;
    if (s.energy < 10) { this.nap(); this.say('So sleepy…'); }
    if (this.state === 'idle' && now > this.nextFidget) this.fidget(now);
    if (this.state === 'idle' && s.need === 'bored' && now - this.lastActive > 20000) this.play('sitDown');
    if (this.state === 'sleep' && !s.asleep) this.play('wake');   // slept her fill
    if (st?.walk) this.stroll();
    if (now > this.blinkAt + 150) this.blinkAt = now + 2500 + Math.random() * 3500 * (Math.random() < 0.2 ? 0.1 : 1);
    this.symptoms(now);
    this.watchCursor(now);
    if (now > (this.viewCheck ?? 0)) { this.viewCheck = now + 2000; this.keepInView(); }
    const need = s.need;
    if (NEED_ICON[need] && now > this.nextNeed) { this.nextNeed = now + 4000; this.parts.push({ icon: NEED_ICON[need], x: AX + 10, y: FLOOR - 64, vx: 0, vy: -0.15, life: 26 }); }
  }

  // What happens when a timed state ends (some chain into a follow-up).
  afterState() {
    if (this.state === 'draw' || this.state === 'crayons') {
      const lv = Math.max(1, this.stats.learned.drawing ?? 1), pic = DRAWINGS[Math.min(DRAWINGS.length, lv) - 1 - (Math.random() < 0.4 && lv > 1 ? 1 : 0)];
      this.stats.train('colour', 4);
      return this.play('showDrawing', { extra: pic, say: `I drew ${pic === 'car' ? 'a car' : pic === 'house' ? 'a house' : `a ${pic}`}!` });
    }
    const chain = { doze: 'sleep', sitDown: 'sit', depart: 'school' }[this.state];
    if (chain) return this.play(chain);
    if (this.state === 'wake') return this.react('happy', { icon: 'sparkle', say: 'Morning! ☀', force: true });
    if (this.state === 'tv') {   // too much TV: she comes away grumpy and square-eyed
      const s = this.stats;
      s.happy(-2); s.change({ energy: -6 }); s.feel('sorrow', 15); s.nudgeAlign(-2);
      return this.play('refuse', { say: ['My eyes feel all fuzzy…', 'That was boring. Can we draw instead?', 'Too much TV… I feel grumpy.'][Math.floor(Math.random() * 3)] });
    }
    if (this.state === 'hatch') { this.stats.hatch(); return this.react('happy', { icon: 'heart', n: 4, say: `Hi! I’m ${this.name}!`, force: true }); }
    this.base();
  }

  // Idle choices: her fidgets, the skills she's learned at kindergarten, and her personality.
  fidget(now) {
    const s = this.stats, p = s.personality;
    this.nextFidget = now + (p === 'energetic' ? 3500 : 5000) + Math.random() * 7000;
    if (s.need === 'lonely') return this.play('wave', { say: 'Hey! Over here!' });
    if (s.need === 'sad') return this.play('cry');
    if (s.emo.anger > 60) return this.play('tantrum', { say: 'Hmph!' });
    if (s.bloom && now - s.bloom < 3 * 60e3 && Math.random() < 0.5) return this.play('bloom');
    if (s.energy < 40 && Math.random() < 0.3) return this.play('yawn');
    if (now > this.nextTip) { this.nextTip = now + (p === 'chatty' ? 60e3 : 150e3) + Math.random() * 60e3; this.chat(TIPS[Math.floor(Math.random() * TIPS.length)]); }
    const pool = [...FIDGETS];
    if (p === 'energetic') pool.push('walk', 'walk', 'stretch');
    if (p === 'curious') pool.push('peek', 'glance', 'think');
    if (p === 'naive') pool.push('think');
    const inst = s.knows('instrument'), dances = s.knows('dance');
    if (inst.length) pool.push('instrument', 'instrument');
    dances.forEach(d => pool.push(DANCES[d]));
    if (s.learned.exercise) pool.push('exercise');
    if (s.learned.song && p !== 'quiet') pool.push('sing', 'sing');
    if (s.learned.drawing) pool.push('draw', 'draw');
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick === 'instrument') return this.play('instrument', { extra: inst[Math.floor(Math.random() * inst.length)] });
    if (pick === 'sing') return this.play('sing', { say: SONGS[(s.learned.song ?? 1) - 1] });
    this.play(pick);
  }

  // Illness shows: a cough, hiccups, sniffles… every few seconds.
  symptoms(now) {
    const sick = this.stats.sick;
    if (!sick || now < this.nextSymptom || !['sick', 'idle'].includes(this.state)) return;
    this.nextSymptom = now + 3000 + Math.random() * 3000;
    const [, icon] = SICK[sick];
    this.parts.push({ icon, x: AX + 4, y: FLOOR - 44, vx: 0.3, vy: sick === 'nose' ? 0.3 : -0.3, life: 18 });
    if (sick === 'hiccups' || sick === 'cough') { this.hic = now + 300; this.drawn = null; }
  }

  // Egg, evolution cocoon, end-of-life cocoon, kindergarten — the long arcs of her life.
  lifeCycle(now) {
    const s = this.stats;
    if (now < (this.nextLife ?? 0)) return;
    this.nextLife = now + 1000;
    if (s.stage === 'egg' && this.state !== 'egg' && this.state !== 'hatch') { this.play('egg'); this.eggSince = now; }
    if (this.state === 'egg' && now - (this.eggSince ??= now) > 120e3) this.hatchNow();
    if (s.school && now > s.school.until) {
      const r = s.finishSchool(), name = LESSONS.find(l => l[0] === r?.id)?.[1] ?? 'something';
      this.play('arrive');   // she walks back in, then tells you about it
      return setTimeout(() => this.backFromSchool(r, name), 1400);
    }
    if (this.breakUntil && now > this.breakUntil) {
      this.breakUntil = 0; sfx('chime');
      this.react('wave', { say: 'Break’s over — ready for another round?', force: true });
      bus.emit('pyxl:stats', s);
    }
    if (s.school && !['school', 'depart'].includes(this.state)) this.play('school');
    if (this.state === 'school' && !s.school) this.base();
    this.cocoonStep(now);
  }
  backFromSchool(r, name) {
    const s = this.stats;
    if (r?.focus) {   // end of a focus session: a short break, then another round if you like
      sfx('chime');
      this.breakUntil = Date.now() + (s.pomos % 4 === 0 ? 15 : 5) * 60e3;
      this.react('cheer', { icon: 'star', n: 5, say: 'Break time! Great focus ♡ +5 rings', force: true });
      setTimeout(() => this.react(s.learned.exercise ? 'exercise' : 'stretch', { say: 'Stretch with me!' }), 2600);
    } else {
      this.react('cheer', { icon: 'star', n: 4, say: r?.fresh ? `I learned ${name}${r.level > 1 ? ` (level ${r.level})` : ''}!` : 'Class was fun!', force: true });
      setTimeout(() => this.perform(r?.id), 2300);
    }
  }
  // Evolution and end-of-life cocoons.
  cocoonStep(now) {
    const s = this.stats;
    if (this.state === 'cocoon') {
      if (now < this.cocoonUntil) return;
      const kind = this.cocoonKind;
      if (kind === 'evolve') { s.evolve(); return this.react('cheer', { icon: 'sparkle', n: 6, say: `I grew up! I’m a ${TYPES[s.type]}!`, force: true }); }
      const out = s.rebirth();
      if (out === 'chaos') return this.react('cheer', { icon: 'sparkle', n: 8, say: `I’m a Chaos ${s.name} now — forever!`, force: true });
      this.play('egg'); this.eggSince = now;
      return this.say(out === 'reborn' ? 'She left an egg… she’ll remember you ♡' : 'A new egg… a fresh start.', 4000);
    }
    const due = s.due;
    if (due && this.awake() && ['idle', 'sit'].includes(this.state)) {
      this.cocoonKind = due;
      this.cocoonColor = due === 'evolve' ? ['#f4f1ea', '#cfc8ba', '#ffffff'] : s.chaosReady ? ['#ffd23f', '#d99a14', '#fff3b0'] : s.happiness > 50 ? ['#ffb3c7', '#e0859f', '#ffe3ec'] : ['#c9ccd4', '#9aa1b1', '#eef0f4'];
      this.cocoonUntil = now + (due === 'evolve' ? 8000 : 12000);
      this.play('cocoon');
      this.say(due === 'evolve' ? `${s.name} is growing up…` : `${s.name} is resting in a cocoon…`, 4000);
    }
  }

  hatchNow() { if (this.state === 'egg') this.play('hatch'); }

  // Performs a kindergarten skill she knows.
  perform(id) {
    const kind = LESSONS.find(l => l[0] === id)?.[2];
    if (kind === 'instrument') this.react('instrument', { extra: id });
    else if (kind === 'dance') this.react(DANCES[id]);
    else if (kind === 'exercise') this.react('exercise');
    else if (kind === 'song') this.react('sing', { say: SONGS[(this.stats.learned.song ?? 1) - 1] });
    else if (kind === 'drawing') this.react('draw');
  }

  // Walks her along `path` one pixel per tick, turning to face each leg; home again when done.
  // Careless (or unlucky) Pyxls sometimes trip.
  stroll() {
    const to = this.path[0];
    if (to == null) return this.base();
    if (to === this.pos) return void this.path.shift();
    this.flip = to < this.pos;
    this.pos += Math.sign(to - this.pos);
    const luck = this.stats.skills.luck?.pts ?? 0, p = (this.stats.is('careless') ? 0.012 : 0.003) * (1 - Math.min(0.8, luck / 2000));
    if (Math.random() < p) { this.play('trip', { say: this.stats.is('crybaby') ? 'Waaah!' : 'Oof!' }); this.stats.feel('sorrow', 5); }
  }

  render() {
    const ctx = this.canvas.getContext('2d'), k = this.k, st = STATES[this.state], t = (performance.now() - this.started) / 1000;
    if (!atlas.complete || !st) return;
    const still = document.body.dataset.theme === 'paper', now = Date.now(); // e-ink friendly: no breathing, blinking or bobbing
    let pose = st.poses[st.fps ? Math.floor(t * st.fps) % st.poses.length : 0];
    let x = AX + this.pos, y = FLOOR, flip = this.flip;
    if (this.state === 'idle' && this.gaze) { pose = 'side'; flip = this.gaze < 0; }
    if (this.state === 'sick') pose = SICK[this.stats.sick]?.[0] ?? 'drowsy';
    if (pose === 'front' && !still && now > this.blinkAt) pose = 'frontBlink';
    if (st.flipEvery) flip = Math.floor(t / st.flipEvery) % 2 === 1;
    if (st.spin) flip = Math.floor(t * st.fps) % 4 === 3;
    if (st.step) x += Math.floor(t * 2) % 2 ? 3 : -3;
    if (pose === 'side') flip = !flip; // side view is drawn facing left
    if (st.hop) y -= Math.round(Math.abs(Math.sin(t * 9)) * 3);
    if (st.shake) x += Math.floor(t * 18) % 2 ? 1 : -1;
    if (st.sway) y -= Math.floor(t * 2.4) % 2;   // nods along to the radio
    let fade = 1;
    if (st.walkOff === 1) { x += Math.round(t * 22); flip = false; fade = Math.max(0, Math.min(1, (1.8 - t) / 0.6)); }   // off to school, out of sight
    if (st.walkOff === -1) { x += Math.round(Math.max(0, 1.2 - t) * 26); flip = true; fade = Math.min(1, t / 0.4); }        // and back again
    if (st.walk && Math.floor(t * st.fps) % 2) y -= 1; // bob on each step
    if (this.hic > now) y -= 2;
    if (this.stats.sick === 'cold' && this.state === 'sick') x += Math.floor(t * 12) % 2;
    const [, , w, hh, ax, by] = SPRITES[pose], [l, r] = flip ? [w - ax, ax] : [ax, w - ax];
    x = Math.max(l, Math.min(BOX_W - r, x)); // wide poses never clip out of her box
    const breath = st.breath && !still && (t % st.breath) / st.breath > 0.55 ? 1 : 0;
    const emote = this.emoteName(now), bob = still ? 0 : Math.round(Math.sin(t * 2.5));
    const phase = st.special || st.prop || st.tears || st.notes || st.zzz || st.walkOff ? Math.floor(t * 8) : 0;
    // physics: hanging tilt / landing wobble, in 3° steps (each step is a cached pixel-art frame)
    const ph = this.phys, air = ph?.hang ? this.grab : ph?.fly, deg = ph ? Math.round((ph.hang ? this.hangAngle() : ph.fly ? ph.fly.th : ph.settle.th) * 60 / Math.PI) * 3 : 0;
    const kick = ph?.hang && Math.abs(ph.hang.om) < 4 ? (Math.floor(t * 5) % 3) - 1 : 0, drop = ph?.settle ? Math.round(ph.settle.y) : 0;
    // Only repaint when the picture changes (idle: a couple of times a second, not 12).
    const key = `${this.state}|${pose}|${x}|${y}|${flip}|${breath}|${k}|${outfitHex}|${this.canvas.width}|${emote}|${bob}|${phase}|${this.extra}|${deg}|${kick}|${drop}|${air ? `${air.x},${air.y}` : ''}`;
    const dt = Math.min(0.1, (performance.now() - (this.lastDraw ?? 0)) / 1000);
    this.lastDraw = performance.now();
    if (key === this.drawn && !this.parts.length) return;
    this.drawn = this.parts.length ? null : key;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (st.special) this.drawSpecial(ctx, st.special, t, k, still);
    else {
      if (st.prop === 'bloom') for (let i = 0; i < 7; i++) drawIcon(ctx, 'bloom', AX + this.pos + Math.cos(i / 7 * 6.28) * 22 - 1, FLOOR - 3 + Math.sin(i / 7 * 6.28) * 3, k);
      if (air) return this.drawHanging(deg, kick, emote, ph.fly ? centreOfMass(sheet(), SPRITES.raise) : GRIP, air);
      y += drop;
      if (deg && !flip) {   // wobbling upright on her feet
        const f = rotated(sheet(), SPRITES[pose], SPRITES[pose].slice(4), deg);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(f.canvas, (x - f.ox) * k, (y - f.oy) * k, f.canvas.width * k, f.canvas.height * k);
      } else {
        ctx.globalAlpha = still ? 1 : fade;
        drawPose(ctx, pose, x, y, k, flip, breath);
        ctx.globalAlpha = 1;
        if (pose === 'sleep' && !still) this.drawZzz(ctx, x, y, flip, t, k);
      }
      const [, , pw, ph2, pax, pby] = SPRITES[pose];
      this.spriteBox = [x - (flip ? pw - pax : pax), y - pby, x + (flip ? pax : pw - pax), y - pby + ph2];   // what keepInView keeps on screen
      this.drawProp(ctx, st, x, y - by, t, k);
      if (st.tears && (st.tears === 'slow' ? Math.floor(t * 3) % 14 < 3 : Math.floor(t * 3) % 2)) { drawIcon(ctx, 'drop', x - 8, y - by + 22, k); drawIcon(ctx, 'drop', x + 5, y - by + 22, k); }
      if (st.notes && Math.floor(t * 2) % 2 && !still) this.parts.length < 3 && this.parts.push({ icon: 'note', x: AX + (Math.random() - 0.5) * 30, y: FLOOR - 58, vx: (Math.random() - 0.5) * 0.4, vy: -0.4, life: 18 });
      if (emote) { const [ew] = iconSize(emote); drawIcon(ctx, emote, x - Math.floor(ew / 2), y - by - 7 + bob, k, this.stats.chaos && emote === 'emDot' ? '#ffd23f' : null); }
    }
    this.drawParts(ctx, k, dt);
  }
  // Sleeping Z's: each one drifts up from her head, growing, then pops; three in a cycle.
  // (The sheet's drawn Z's are wiped first, so only the animated ones show.)
  drawZzz(ctx, x, y, flip, t, k) {
    const [, , , , ax, by] = SPRITES.sleep, left = flip ? x + ax - 71 : x - ax + 52;
    ctx.clearRect(left * k, (y - by + 1) * k, 19 * k, 21 * k);
    const px = (a, b, c) => { ctx.fillStyle = c; ctx.fillRect(a * k, b * k, k, k); };
    for (let i = 0; i < 3; i++) {
      const p = (t / 2.7 + i / 3) % 1, hx = x + (flip ? -1 : 1) * (18 + Math.round(p * 12)), hy = y - by + 14 - Math.round(p * 22);
      if (p > 0.86) {   // pop!
        const r = Math.round((p - 0.86) * 40) + 2;
        [[-r, 0], [r, 0], [0, -r], [0, r], [-r + 1, -r + 1], [r - 1, -r + 1], [-r + 1, r - 1], [r - 1, r - 1]].forEach(([dx, dy]) => px(hx + dx, hy + dy, '#8fb8ff'));
        continue;
      }
      const n = 3 + Math.round(p * 4), cells = [];
      for (let j = 0; j < n; j++) cells.push([j, 0], [j, n - 1], [n - 1 - j, j]);
      const ox = hx - (n >> 1), oy = hy - (n >> 1);
      for (const [cx, cy] of cells) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) px(ox + cx + dx, oy + cy + dy, '#1b2a55');
      for (const [cx, cy] of cells) px(ox + cx, oy + cy, n > 5 ? '#5b8cff' : '#8fb8ff');
    }
  }
  // She hangs on her own small overlay canvas centred on the pointer, so she can loop right round
  // it; it moves by a compositor-only transform each frame (snapped to whole device pixels).
  drawHanging(deg, kick, emote, pivot = GRIP, at = this.grab) {
    const c = this.hangCv, k = this.k, dpr = devicePixelRatio || 1, f = rotated(sheet(), SPRITES.raise, pivot, deg, kick), S = f.r * 2 + 1;
    if (c.width !== S * k) { c.width = c.height = S * k; c.style.width = c.style.height = `${S * k / dpr}px`; }
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = false;
    x.drawImage(f.canvas, (f.r - f.ox) * k, (f.r - f.oy) * k, f.canvas.width * k, f.canvas.height * k);
    if (emote) drawIcon(x, emote, f.r + 9, f.r - 12, k);
    c.dataset.deg = deg;
    const snap = v => Math.round(v * dpr) / dpr;
    c.style.transform = `translate(${snap(at.x - (f.r + 0.5) * k / dpr)}px, ${snap(at.y - (f.r + 0.5) * k / dpr)}px)`;
  }
  // Particles move by time, not frames (the canvas repaints every frame while they're alive).
  drawParts(ctx, k, dt = 1 / 12) {
    const f = dt * 12;
    this.parts = this.parts.filter(p => (p.life -= f) > 0);
    for (const p of this.parts) {
      p.x += p.vx * f; p.y += p.vy * f;
      ctx.globalAlpha = Math.min(1, p.life / 8);
      const [pw] = iconSize(p.icon);
      drawIcon(ctx, p.icon, p.x + this.pos - pw / 2, p.y, k, p.color);
    }
    ctx.globalAlpha = 1;
  }

  // The Chao-style emote ball: its shape follows her alignment; it turns into a heart, ?, ! or
  // swirl with her feelings.
  emoteName(now) {
    const s = this.stats, st = STATES[this.state];
    if (this.emote && now < this.emote.until) return this.emote.name;
    if (st.held) return now - this.heldAt > 6000 ? 'swirl' : now - this.heldAt > 1500 ? 'heart' : 'bang';
    if (st.emote) return st.emote;
    if (this.state === 'sleep') return null;
    if (s.emo.anger > 50) return 'swirl';
    if (s.emo.fear > 50) return 'bang';
    if (s.emo.joy > 70) return 'heart';
    return s.alignment === 'Bright' ? 'emHalo' : s.alignment === 'Moody' ? 'emSpike' : 'emDot';
  }

  // Held instruments, toys and finished drawings.
  drawProp(ctx, st, x, top, t, k) {
    const e = this.extra;
    const art = (name, px, py) => { ctx.imageSmoothingEnabled = false; ctx.drawImage(artCanvas(name, k), Math.round(px) * k, Math.round(py) * k); };   // 16×16 toy art at her pixel scale
    switch (st.prop) {
      case 'instrument': return drawIcon(ctx, e ?? 'bell', x + 12, top + 18 + (Math.floor(t * 5) % 2), k);
      case 'drawing': ctx.fillStyle = '#221822'; ctx.fillRect((x + 12) * k, (top + 2) * k, 13 * k, 12 * k); ctx.fillStyle = '#fff'; ctx.fillRect((x + 13) * k, (top + 3) * k, 11 * k, 10 * k); return drawIcon(ctx, e ?? 'sun', x + 14, top + 4, k);
      case 'ball': { const bx = AX + 10 + Math.abs(((t * 18) % 40) - 20); return art('ball', bx, FLOOR - 16 - Math.round(Math.abs(Math.sin(t * 6)) * 5)); }
      case 'box': return t < 2 ? art('box', x - 8, FLOOR - 22) : art('box', x + 12, FLOOR - 16);
      case 'radio': return art('radio', 1, FLOOR - 16);
      case 'tv': return art('tv', BOX_W - 17, FLOOR - 16);
      case 'crayons': return art('crayons', x + 8, FLOOR - 15);
    }
  }

  drawSpecial(ctx, kind, t, k, still) {
    const cx = AX + this.pos + 4;
    if (kind === 'egg' || kind === 'hatch') {
      const wob = kind === 'hatch' || this.wobbleUntil > Date.now() ? (Math.floor(t * 10) % 2 ? 1 : -1) : 0;
      const spots = Object.assign([[-3, -4], [3, 2], [-2, 6], [4, -8]], { color: outfitHex ?? '#2fb3a4' });
      if (kind === 'hatch' && t > 1) {                                  // crack open
        drawOval(ctx, cx, FLOOR, 10, 13, ['#f6efe4', '#d9cdb8', '#ffffff'], k, { spots });
        ctx.clearRect((cx - 11) * k, (FLOOR - 27) * k, 23 * k, (13 - Math.floor((t - 1) * 8)) * k);
        return;
      }
      drawOval(ctx, cx + wob, FLOOR, 10, 13, ['#f6efe4', '#d9cdb8', '#ffffff'], k, { spots });
      if (kind === 'hatch' && t > 0.6) { ctx.fillStyle = '#221822'; for (let i = -8; i <= 8; i++) ctx.fillRect((cx + wob + i) * k, (FLOOR - 13 + (i % 2 ? 1 : -1)) * k, k, k); }
      return;
    }
    if (kind === 'cocoon') {
      const [a, b, c] = this.cocoonColor ?? ['#f4f1ea', '#cfc8ba', '#fff'], pulse = !still && Math.floor(t * 2) % 2;
      drawOval(ctx, cx, FLOOR, 12, 20, pulse ? [c, b, '#ffffff'] : [a, b, c], k, { top: 0.9, stripes: 5 });
      return;
    }
    if (kind === 'school') {
      drawIcon(ctx, 'bag', Math.round((AX - 6) / 3), Math.round((FLOOR - 16) / 3), k * 3);
    }
  }

  // ---- reactions to what the user does ----
  wire() {
    const s = this.stats;
    const active = () => { this.lastActive = Date.now(); s.touch(); if (this.state === 'sit' && s.need !== 'bored') this.base(); };
    ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, active, { passive: true }));
    bus.on('history', hist => {
      const undone = hist.undone.length, top = hist.done.at(-1), label = top?.label ?? '', now = Date.now();
      if (undone > this.lastUndone) {
        this.undos = this.undos.filter(u => now - u < 3000).concat(now);
        if (this.undos.length >= 4) { this.react('think', { say: 'Changed your mind?' }); this.undos = []; }
        else if (s.is('crybaby') && Math.random() < 0.3) this.react('cry');
        else this.react('oops', { icon: 'drop', n: 1 });
      } else if (top && top === this.redoTop) this.react('happy', { icon: 'sparkle', n: 2 });
      else for (const [re, state, icon, skill, amt] of ACTIONS) if (re.test(label)) {
        if (skill) s.train(skill, amt * (skill === 'line' && (this.app?.brush?.size ?? 0) > 60 ? 0.6 : 1));
        if (skill === 'line' && (this.app?.brush?.size ?? 0) > 60) s.train('power', 4);
        if (state === 'oops') { s.feel('fear', 25); if (s.is('crybaby') && Math.random() < 0.4) { this.react('cry'); break; } }
        this.react(state, { icon, color: state === 'spray' ? this.app?.color.fg : null });
        if (state === 'paint') { this.painted(); this.noteStroke(label); }
        break;
      }
      this.lastUndone = undone;
      this.redoTop = hist.undone.at(-1);
    });
    bus.on('saved', e => { if (!e?.auto) { s.gainXp(5); s.earn(3); this.react('cheer', { icon: 'star', n: 4, say: 'Saved!' }); } });
    bus.on('mode', () => this.react('walk'));
    bus.on('play', on => (on ? this.react('dance') : this.state === 'dance' && this.base()));
    bus.on('pyxl:level', lv => this.react('cheer', { icon: 'star', n: 6, say: `Level ${lv}! +10 rings`, force: true }));
    bus.on('pyxl:skill', ({ k, level }) => { if (level % 5 === 0) this.showEmote('bang', 1200); });
    bus.on('pyxl:sick', kind => this.say(`Achoo… I don’t feel well.`));
    let colorAt = 0;
    bus.on('color', c => setOutfit(c.fg));
    bus.on('color', c => {
      const L = lum(c.fg);
      s.nudgeAlign(L > 0.7 ? 0.4 : L < 0.3 ? -0.4 : 0);
      s.train('colour', 1.5);
      if (Date.now() - colorAt > 2500 && this.state === 'idle') { colorAt = Date.now(); this.react('paint', { icon: 'drop', n: 1, color: c.fg, dur: 900 }); }
    });
    bus.on('tip', r => this.aim(r));
    bus.on('untip', () => ['point', 'raise'].includes(this.state) && this.base());
  }

  // Painting together: rings, happiness, and a stretch break in long sessions.
  painted() {
    const s = this.stats, now = Date.now();
    s.change({ fun: 0.6 }, 0.5);
    s.happy(0.1); s.feel('joy', 2);
    if (++this.strokes % 8 === 0) s.earn(1);
    if (this.state === 'sit') this.base();
    if (now - this.sessionStart > 25 * 60e3 && now - (this.breakAt ?? 0) > 25 * 60e3) {
      this.breakAt = now;
      setTimeout(() => this.react(s.learned.exercise ? 'exercise' : 'stretch', { say: 'Time for a stretch break? Move with me!' }), 1500);
    }
  }

  // ---- what you're drawing ----
  // A running tally of your strokes; every so often (never often) she comments on it.
  noteStroke(label) {
    const a = this.app, t = this.art ??= { strokes: 0, erase: 0, colours: new Map(), big: 0, tiny: 0, long: 0 }, now = Date.now();
    t.strokes++;
    if (label === 'Eraser') t.erase++;
    else t.colours.set(a.color.fg, (t.colours.get(a.color.fg) ?? 0) + 1);
    const size = a.brush?.size ?? 0, r = a.tool?.total, d = a.doc;
    if (size > 80) t.big++;
    if (size < 6) t.tiny++;
    if (r && d && Math.hypot(r.w, r.h) > 0.45 * Math.hypot(d.w, d.h)) t.long++;
    this.nextCritique ??= now + 40e3;
    if (now > this.nextCritique && t.strokes >= 5 && this.awake() && ['idle', 'sit', 'glance', 'peek', 'paint'].includes(this.state)) this.critique(now);
  }

  critique(now) {
    const s = this.stats, t = this.art, p = s.personality, lines = [];
    this.nextCritique = now + (70 + Math.random() * 90) * 1000 * (p === 'chatty' ? 0.6 : p === 'quiet' ? 2 : 1);
    this.art = null;
    const top = [...t.colours].sort((a, b) => b[1] - a[1])[0]?.[0], name = top && colourName(top);
    if (t.erase >= 4) lines.push('Happy little accidents!', 'Erasing is part of making art.');
    if (name) lines.push(`I love this ${name}!`, `Ooh, that ${name} is so pretty.`, `That ${name} really pops!`);
    if (t.colours.size >= 4) lines.push('So many colours! ✿', 'What a rainbow!');
    if (t.big >= 3) lines.push('Big, bold strokes — nice!');
    if (t.tiny >= 6) lines.push('Such tiny details!', 'Careful work… I like it.');
    if (t.long >= 2) lines.push('Whoa, what a long line!', 'Such confident lines!');
    if (this.app.opts?.symmetry && this.app.opts.symmetry !== 'none') lines.push('Ooh, symmetrical!');
    const look = this.lookAtCanvas();
    if (look) lines.push(look, look);
    if (!lines.length) return;
    const text = lines[Math.floor(Math.random() * lines.length)];
    this.play('peek');                                                   // she turns to look at your canvas…
    setTimeout(() => this.awake() && this.react(Math.random() < 0.5 ? 'point' : 'happy', { say: text, icon: 'heart', n: 1, dur: 1800 }), 1300);
    s.train('smarts', 3); s.feel('joy', 10);
  }

  // A 16×16 glance at the whole picture (scaled on the GPU, so only 256 pixels are read back):
  // how full it is, and its main colour or mood.
  lookAtCanvas() {
    const comp = this.app.view?.comp;
    if (!comp) return null;
    const c = (this.sampler ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 })), x = c.getContext('2d');
    x.clearRect(0, 0, 16, 16);
    x.drawImage(comp, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data, hues = new Array(8).fill(0);
    let inked = 0, dark = 0;
    for (let i = 0; i < 1024; i += 4) {
      const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (a < 40 || (r > 235 && g > 235 && b > 235)) continue;
      inked++;
      const [hh, sat, v] = hsv(r, g, b);
      if (v < 0.3) dark++;
      if (sat > 0.3 && v > 0.25) hues[Math.floor(hh / 45) % 8]++;
    }
    if (inked < 12) return null;
    if (inked > 170) return 'Your canvas is really filling up!';
    if (dark > inked * 0.6) return 'A moody piece. I like it.';
    const hi = hues.indexOf(Math.max(...hues));
    return hues[hi] > inked * 0.4 ? ['So warm and red!', 'Such a sunny picture!', 'Lots of green… a forest?', 'So fresh and green!', 'Lots of teal — so calm.', 'So much blue! Is that the sky?', 'Purple dreams…', 'Pink and lovely!'][hi] : null;
  }

  // Points her brush at a tooltip: raised when it's above her, mirrored when it's to her left.
  aim(r) {
    if (!this.awake() || !['idle', 'glance', 'peek', 'point', 'raise', 'sit', 'think'].includes(this.state)) return;
    const m = this.el.getBoundingClientRect();
    if (!m.width) return;
    const dx = r.left + r.width / 2 - (m.left + m.width / 2), dy = r.top + r.height / 2 - (m.top + m.height / 2);
    this.play(dy < -Math.abs(dx) ? 'raise' : 'point', { flip: dx < 0 });
  }

  // Hovering over her: a wave, or a shy giggle if you linger or keep coming back.
  greet() {
    this.hovered = true;
    if (!this.awake() || !['idle', 'glance', 'peek', 'sit', 'reach', 'think'].includes(this.state)) return;
    this.greets = (this.greets ?? 0) + 1;
    if (this.greets % 3 === 0) this.react('happy', { icon: 'heart', n: 1, say: 'Hehe…', dur: 1200 });
    else this.react('wave', { dur: 1200 });
  }

  // Her on-screen box, re-measured at most twice a second (it only moves when panels do).
  rect() { const now = performance.now(); if (!this.box || now - this.boxAt > 500) { this.box = this.el.getBoundingClientRect(); this.boxAt = now; } return this.box; }

  // Self-aware idling: she turns to face the cursor when it's near, reaches up when it hovers
  // above her head, and looks toward wherever you're working otherwise.
  watchCursor(now) {
    const c = this.cursor;
    this.gaze = 0;
    if (!c || now - c.t > 4000 || !['idle', 'reach'].includes(this.state)) return;
    const r = this.rect(now), cx = r.left + (AX + this.pos) * this.k / (devicePixelRatio || 1), head = r.bottom - 50 * this.k / (devicePixelRatio || 1);
    const dx = c.x - cx, dy = c.y - head, near = Math.hypot(dx, dy) < (this.stats.is('curious') ? 320 : 220);
    if (near && dy < -12 && Math.abs(dx) < 70 && !this.hovered) { if (this.state !== 'reach') this.play('reach', { flip: dx < 0 }); else this.flip = dx < 0; return; }
    if (this.state === 'reach') return this.base();
    if (this.state === 'idle' && near && Math.abs(dx) > 40) this.gaze = Math.sign(dx);
  }

  // ---- care ----
  // `openCare` can be swapped by the host (e.g. to show her docked panel instead of the popup).
  onClick() {
    if (this.state === 'egg') {                                          // help her hatch
      this.wobbleUntil = Date.now() + 500; this.drawn = null;
      if (++this.taps >= 5) { this.taps = 0; this.hatchNow(); }
      return;
    }
    if (this.awake()) this.pet();
    (this.openCare ?? (() => openCareCard(this)))();
  }

  pet() {
    const now = Date.now(), s = this.stats;
    if (s.asleep) {                                                      // waking her makes her cross
      s.sleep(false); s.change({ love: s.energy < 40 ? -2 : 2 }); s.happy(-2); s.feel('anger', 30);
      return this.react('refuse', { say: 'Huh?! I was sleeping…', force: true });
    }
    this.pets = this.pets.filter(t => now - t < 4000).concat(now);
    if (this.pets.length > 6) {
      s.change({ love: -3 }); s.happy(-3); s.feel('anger', 20);
      return s.is('crybaby') ? this.react('cry', { say: 'Stop it!' }) : this.react('refuse', { icon: 'bang', n: 1, say: 'Hey, that tickles!' });
    }
    s.change({ love: s.is('gentle') ? 12 : 8, fun: 2 }, 1);
    if (this.pets.length === 1) s.happy(1);
    s.feel('joy', 15); s.feel('sorrow', -20); s.feel('anger', -10);
    this.react(this.pets.length > 2 ? 'purr' : 'happy', { icon: 'heart', n: 3 });
  }

  feed([icon, name, delta]) {
    const s = this.stats;
    if (!this.awake()) return this.say('Zzz…');
    if (s.food > 92) return this.react('refuse', { say: 'I’m full!' });
    if (s.is('naughty') && Math.random() < 0.15) return this.react('refuse', { say: 'Nope! Not that one.' });
    const fav = s.eat(icon, delta);
    this.parts.push({ icon, x: AX + 16, y: FLOOR - 40, vx: -0.4, vy: 0.2, life: 16 });
    setTimeout(() => this.react('eat', { icon: 'heart', n: fav ? 5 : 2, say: fav ? `My favourite! ${name}!` : `Yum, ${name.toLowerCase()}!` }), 700);
  }

  buy([icon, name, price, effect]) {
    const s = this.stats;
    if (!this.awake()) return this.say('Zzz…');
    if (!s.spend(price)) return this.say(`That needs ${price} rings.`);
    this.parts.push({ icon, x: AX + 16, y: FLOOR - 40, vx: -0.4, vy: 0.2, life: 16 });
    s.shopEffect(effect);
    if (icon === s.fav) s.happy(3);
    setTimeout(() => {
      if (effect === 'love') this.react('bloom', { say: 'I feel all warm and floaty ♡' });
      else if (effect === 'skills') this.react('cheer', { icon: 'sparkle', n: 6, say: 'I feel so much smarter!' });
      else if (effect === 'party') this.react('dance', { dur: 3000, say: 'Party time!' });
      else if (effect === 'calm') this.react('purr', { say: 'Ahh… so calm.' });
      else if (effect === 'luck') this.react('cheer', { icon: 'star', n: 6, say: 'I feel lucky!' });
      else this.react('eat', { icon: effect === 'bright' ? 'sparkle' : effect === 'moody' ? 'moon' : 'heart', n: 3, say: `${name}!` });
    }, 700);
  }

  toy(id) {
    if (!this.awake()) return this.say('Zzz…');
    if (id === 'radio') return this.setRadio(!radio.on);
    if (id === 'tv') { sfx('tv'); this.stats.change({ fun: 3 }); return this.react('tv', { say: 'Cartoons… I guess.', force: true }); }
    this.stats.change({ fun: 12, energy: -2 }, 1);
    this.stats.happy(0.5); this.stats.feel('joy', 20);
    this.react(id, { say: { ball: 'Catch!', box: 'Where am I?', crayons: 'Let me draw!' }[id] });
  }
  // The radio plays lofi until you switch it off; she sits by it, nodding along.
  setRadio(on, track) {
    if (on) { radio.play(track); this.stats.change({ fun: 10 }, 1); this.stats.feel('joy', 15); this.play('vibe', { say: `♪ ${radio.name}` }); }
    else { radio.stop(); if (this.state === 'vibe') this.base(); }
    bus.emit('pyxl:stats', this.stats);
  }
  // Quiet mode: no chatter, no reactions — she just sits there, sad.
  setSilent(on) {
    this.silent = on; local.set('pp.pyxlSilent', on);
    if (on) { this.say(''); this.base(); this.stats.feel('sorrow', 20); }
    else { this.stats.feel('sorrow', -30); this.react('cheer', { icon: 'heart', n: 4, say: 'Yay! You want to talk again!', force: true }); }
    bus.emit('pyxl:stats', this.stats);
  }

  // Kindergarten, or a focus session (pomodoro): she studies while you work, and a break follows.
  school(focusMin) {
    const s = this.stats;
    if (!this.awake()) return this.say('Zzz…');
    this.setRadio(false);
    s.attend(currentLesson()[0], Date.now(), focusMin ? focusMin * 60e3 : undefined, !!focusMin);
    this.breakUntil = 0;
    this.play('depart', { say: focusMin ? `Focus time! See you in ${focusMin} minutes.` : 'Off to kindergarten!' });
  }
  leaveSchool() {
    if (!this.stats.school) return;
    this.stats.school = null; this.stats.save();
    this.play('arrive', { say: 'Back already?' });
  }

  doctor() {
    const s = this.stats;
    if (!s.sick) return this.react('happy', { say: 'The doctor says I’m healthy!' });
    this.parts.push({ icon: 'pill', x: AX + 16, y: FLOOR - 40, vx: -0.4, vy: 0.2, life: 16 });
    setTimeout(() => this.react('gulp', { say: 'Bleh… medicine!', force: true }), 700);
    setTimeout(() => { s.cure(); this.react('cheer', { icon: 'sparkle', n: 4, say: 'All better! Thank you!', force: true }); }, 2600);
  }

  playGame(id = 'stars') {
    if (!this.awake()) return this.say('Zzz…');
    if (this.stats.energy < 20) return this.react('refuse', { say: 'Too tired to play…' });
    this.react('wave', { say: 'Let’s play!' });
    startGame(this, id);
  }

  race(level) {
    if (!this.awake()) return this.say('Zzz…');
    if (this.stats.energy < 25) return this.react('refuse', { say: 'Too tired to race…' });
    this.react('cheer', { say: 'Let’s race!' });
    startRace(this, level);
  }

  raceOver(place, level, rings = 0) {
    const s = this.stats;
    if (place < 0) return this.say('Maybe next time!');
    const id = RACES[level][0];
    s.races++; if (place === 0) s.wins++;
    if (place < 3) s.medals[id] = Math.min(s.medals[id] ?? 9, place);
    s.earn(rings); s.change({ fun: 15, energy: -15 }, 5 - Math.min(4, place));
    s.train('luck', 10); s.train('smarts', 6); s.happy(place === 0 ? 3 : 1);
    const medal = medalName(place);
    if (place === 0) this.react('cheer', { icon: 'medal', n: 4, say: `I won! Gold medal! +${rings} rings`, force: true });
    else if (medal) this.react('happy', { icon: 'medal', n: 2, say: `${medal} medal! +${rings} rings`, force: true });
    else this.react(s.is('crybaby') ? 'cry' : 'oops', { say: 'Aww… I’ll train harder!', force: true });
  }

  // Any mini-game's result: `score` of `max`, training `skill`; `line` is what she says about it.
  gameOver(score, max = 8, skill = 'luck', line) {
    const s = this.stats, k = Math.round(score / max * 8);
    s.change({ fun: 8 + k * 6, energy: -10, love: 4 }, k * 2);
    s.earn(k); s.happy(k >= 6 ? 2 : 1); s.train(skill, k * 5);
    if (k >= 6) this.react('cheer', { icon: 'star', n: 5, say: line ?? `${score} / ${max}! Amazing! +${k} rings`, force: true });
    else if (k >= 3) this.react('happy', { icon: 'star', n: 3, say: line ?? `${score} / ${max}, nice! +${k} rings`, force: true });
    else this.react(s.is('crybaby') ? 'cry' : 'oops', { say: line ?? (score ? `Only ${score}… again?` : 'Aww, none!'), force: true });
  }

  nap() { this.setRadio(false); this.stats.sleep(true); this.play('doze', { say: 'Night night…' }); }
  wake() { this.stats.sleep(false); this.play('wake', { say: 'Mmh… I’m up!' }); }
}
