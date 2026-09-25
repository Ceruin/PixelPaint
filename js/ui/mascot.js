import { h } from './dom.js';
import { bus } from '../core/bus.js';
import { drawIcon, iconSize } from './pixelIcons.js';
import { PyxlStats, LESSONS, TYPES, currentLesson } from './pyxlStats.js';
import { openCareCard, startStarGame } from './pyxlCare.js';
import { startRace, RACES, medalName } from './pyxlRace.js';

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
  sleep: { poses: ['sleep'], hold: true, breath: 3 },
  sick: { poses: ['drowsy'], hold: true, breath: 2 },
  bloom: { poses: ['floor'], dur: 6000, breath: 2, prop: 'bloom', emote: 'heart' },
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
  tv: { poses: ['floor'], dur: 5000, prop: 'tv', breath: 2 },
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
const SICK = { cough: ['drowsy', 'dots'], stomach: ['floor', 'swirl'], cold: ['floor', 'drop'], rash: ['front', 'plus'], hiccups: ['front', 'bang'], nose: ['drowsy', 'drop'] };
// Things she likes to mention while you work (chatty Pyxls mention them more).
const TIPS = ['Tip: [ and ] resize the brush.', 'Tip: hold Space to pan around.', 'Tip: two-finger tap undoes!', 'Tip: Alt-click picks a colour.',
  'Tip: right-click for a quick palette.', 'Tip: Tab hides everything (Zen).', 'Tip: Shift+M mirrors the view.', 'Tip: onion skin shows other frames.',
  'Tip: F1 opens the guide.', 'Tip: Ctrl+J duplicates a layer.', 'Tip: Alt+1…5 switch modes.'];
const ACTIONS = [
  // [label pattern, reaction, particle, skill trained, amount]
  [/^(Brush|Smudge|Shape|Eraser)$/, 'paint', null, 'line', 6],
  [/^Fill$/, 'spray', 'drop', 'colour', 8],
  [/Replace Colo|Hue|Brightness|Desaturate|Invert/, 'cheer', 'sparkle', 'colour', 8],
  [/^(New Layer|New Group|Group Layer|Duplicate|New Frame|Duplicate Frame|New Tag|New Filter Layer|Import Frames)$/, 'wave', 'plus', 'shape', 3],
  [/^(Delete Layer|Delete Frame|Clear|Cut|Blank Cel|Clear Cel)$/, 'oops', 'bang', null, 0],
  [/Select|Lasso|Wand|Marquee|Deselect|Invert Selection|Feather/, 'think', null, 'shape', 4],
  [/Transform|Text|Move/, 'point', 'sparkle', 'shape', 6],
  [/Rotate|Flip|Resize|Crop|Canvas Size|Image Size/, 'spin', null, 'shape', 4],
  [/Blur|Outline|Adjust|Merge|Flatten|Filter/, 'cheer', 'sparkle', 'power', 6],
];
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
    this.el = h('div.mascot', { 'data-tip': 'Pyxl — click to care for her' }, this.canvas, this.bubble);
    Object.assign(this, { parts: [], k: 1, flip: false, pets: [], undos: [], lastUndone: 0, lastActive: Date.now(), sessionStart: Date.now(), strokes: 0,
      nextFidget: Date.now() + 6000, nextNeed: 0, nextSymptom: 0, nextTip: Date.now() + 90e3, pos: 0, path: [], blinkAt: Date.now() + 3000, emote: null, taps: 0 });
    this.el.addEventListener('click', () => this.onClick());
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
    setInterval(() => this.tick(), 1000 / 12);
    setTimeout(() => this.greeting(), 1800);
  }

  get name() { return this.stats.name; }
  awake() { return !this.stats.asleep && !['egg', 'school'].includes(this.stats.need) && !['cocoon', 'hatch'].includes(this.state); }
  mount(host) { if (host && this.el.parentElement !== host) { host.append(this.el); this.fit(); requestAnimationFrame(() => this.placeBubble()); } }

  fit() {
    const dpr = devicePixelRatio || 1, r = this.el.getBoundingClientRect();
    if (!r.height) return;
    this.k = Math.max(1, Math.floor(Math.min(r.height * dpr / BOX_H, (r.width + 24) * dpr / BOX_W)));
    Object.assign(this.canvas, { width: BOX_W * this.k, height: BOX_H * this.k });
    this.drawn = null;
    this.placeBubble();
    Object.assign(this.canvas.style, { width: `${BOX_W * this.k / dpr}px`, height: `${BOX_H * this.k / dpr}px` });
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
    clearTimeout(this.sayTimer);
    this.bubble.textContent = text;
    if (text) requestAnimationFrame(() => this.placeBubble());
    if (text) this.sayTimer = setTimeout(() => { this.bubble.textContent = ''; }, ms + text.length * 25);
  }
  // Keeps the bubble inside the window (re-run when she moves); its tail still points at her.
  placeBubble() {
    const b = this.bubble;
    if (!b.textContent) return;
    b.style.setProperty('--dx', '0px');
    const r = b.getBoundingClientRect(), m = 8;
    const dx = r.left < m ? m - r.left : r.right > innerWidth - m ? innerWidth - m - r.right : 0;
    b.style.setProperty('--dx', `${dx}px`);
    b.style.setProperty('--tail', `${Math.max(10, Math.min(r.width - 10, r.width / 2 - dx))}px`);
  }
  chat(text) { if (!this.stats.is('quiet') || Math.random() < 0.3) this.say(text); }
  showEmote(name, ms = 1500) { this.emote = { name, until: Date.now() + ms }; }

  // Resting behaviour follows her most pressing need.
  base() {
    const need = this.stats.need;
    if (need === 'egg') return this.play('egg');
    if (need === 'school') return this.play('school');
    if (need === 'asleep') return this.play('sleep');
    if (need === 'sick') return this.play('sick');
    if (need === 'tired') return this.play('drowsy');
    if (need === 'bored' && Date.now() - this.lastActive > 20000) return this.play('sit');
    this.play('idle');
  }

  react(name, { icon, n = 3, say, color, dur, force, extra } = {}) {
    if (!force && (!this.awake() || this.state === 'dance')) return;
    this.play(name, { dur, say, extra });
    if (icon) this.burst(icon, n, color);
  }

  burst(icon, n = 3, color) {
    for (let i = 0; i < n; i++) this.parts.push({ icon, color, x: AX - 12 + Math.random() * 24, y: FLOOR - 56 - Math.random() * 6, vx: (Math.random() - 0.5) * 0.6, vy: -0.5 - Math.random() * 0.5, life: 22 + i * 4 });
  }

  tick() {
    const now = Date.now(), st = STATES[this.state], s = this.stats;
    if (now > this.until) this.afterState();
    this.lifeCycle(now);
    if (!this.awake()) return this.render();
    if (s.energy < 10) { s.sleep(true); this.say('So sleepy…'); this.play('sleep'); }
    if (this.state === 'idle' && now > this.nextFidget) this.fidget(now);
    if (this.state === 'idle' && s.need === 'bored' && now - this.lastActive > 20000) this.play('sit');
    if (st?.walk) this.stroll();
    if (now > this.blinkAt + 150) this.blinkAt = now + 2500 + Math.random() * 3500 * (Math.random() < 0.2 ? 0.1 : 1);
    this.symptoms(now);
    this.watchCursor(now);
    const need = s.need;
    if (NEED_ICON[need] && now > this.nextNeed) { this.nextNeed = now + 4000; this.parts.push({ icon: NEED_ICON[need], x: AX + 10, y: FLOOR - 64, vx: 0, vy: -0.15, life: 26 }); }
    this.render();
  }

  // What happens when a timed state ends (some chain into a follow-up).
  afterState() {
    if (this.state === 'draw' || this.state === 'crayons') {
      const lv = Math.max(1, this.stats.learned.drawing ?? 1), pic = DRAWINGS[Math.min(DRAWINGS.length, lv) - 1 - (Math.random() < 0.4 && lv > 1 ? 1 : 0)];
      this.stats.train('colour', 4);
      return this.play('showDrawing', { extra: pic, say: `I drew ${pic === 'car' ? 'a car' : pic === 'house' ? 'a house' : `a ${pic}`}!` });
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
    if (this.bubble.textContent) this.placeBubble();
    if (s.stage === 'egg' && this.state !== 'egg' && this.state !== 'hatch') { this.play('egg'); this.eggSince = now; }
    if (this.state === 'egg' && now - (this.eggSince ??= now) > 120e3) this.hatchNow();
    if (s.school && now > s.school.until) {
      const r = s.finishSchool(), name = LESSONS.find(l => l[0] === r?.id)?.[1] ?? 'something';
      this.react('cheer', { icon: 'star', n: 4, say: r?.fresh ? `I learned ${name}${r.level > 1 ? ` (level ${r.level})` : ''}!` : `Class was fun!`, force: true });
      setTimeout(() => this.perform(r?.id), 2300);
    }
    if (s.school && this.state !== 'school') this.play('school');
    if (this.state === 'school' && !s.school) this.base();
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
    const still = document.body.dataset.mode === 'paper', now = Date.now(); // e-ink friendly: no breathing, blinking or bobbing
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
    if (st.walk && Math.floor(t * st.fps) % 2) y -= 1; // bob on each step
    if (this.hic > now) y -= 2;
    if (this.stats.sick === 'cold' && this.state === 'sick') x += Math.floor(t * 12) % 2;
    const [, , w, hh, ax, by] = SPRITES[pose], [l, r] = flip ? [w - ax, ax] : [ax, w - ax];
    x = Math.max(l, Math.min(BOX_W - r, x)); // wide poses never clip out of her box
    const breath = st.breath && !still && (t % st.breath) / st.breath > 0.55 ? 1 : 0;
    const emote = this.emoteName(now), bob = still ? 0 : Math.round(Math.sin(t * 2.5));
    const phase = st.special || st.prop || st.tears || st.notes ? Math.floor(t * 4) : 0;
    // Only repaint when the picture changes (idle: a couple of times a second, not 12).
    const key = `${this.state}|${pose}|${x}|${y}|${flip}|${breath}|${k}|${outfitHex}|${this.canvas.width}|${emote}|${bob}|${phase}|${this.extra}`;
    if (key === this.drawn && !this.parts.length) return;
    this.drawn = this.parts.length ? null : key;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (st.special) this.drawSpecial(ctx, st.special, t, k, still);
    else {
      if (st.prop === 'bloom') for (let i = 0; i < 7; i++) drawIcon(ctx, 'bloom', AX + this.pos + Math.cos(i / 7 * 6.28) * 22 - 1, FLOOR - 3 + Math.sin(i / 7 * 6.28) * 3, k);
      drawPose(ctx, pose, x, y, k, flip, breath);
      this.drawProp(ctx, st, x, y - by, t, k);
      if (st.tears && Math.floor(t * 3) % 2) { drawIcon(ctx, 'drop', x - 8, y - by + 22, k); drawIcon(ctx, 'drop', x + 5, y - by + 22, k); }
      if (st.notes && Math.floor(t * 2) % 2 && !still) this.parts.length < 3 && this.parts.push({ icon: 'note', x: AX + (Math.random() - 0.5) * 30, y: FLOOR - 58, vx: (Math.random() - 0.5) * 0.4, vy: -0.4, life: 18 });
      if (emote) { const [ew] = iconSize(emote); drawIcon(ctx, emote, x - Math.floor(ew / 2), y - by - 7 + bob, k, this.stats.chaos && emote === 'emDot' ? '#ffd23f' : null); }
    }
    this.parts = this.parts.filter(p => p.life-- > 0);
    for (const p of this.parts) {
      p.x += p.vx; p.y += p.vy;
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
    const big = (name, px, py, sc) => drawIcon(ctx, name, Math.round(px / sc), Math.round(py / sc), k * sc);
    switch (st.prop) {
      case 'instrument': return drawIcon(ctx, e ?? 'bell', x + 12, top + 18 + (Math.floor(t * 5) % 2), k);
      case 'drawing': ctx.fillStyle = '#221822'; ctx.fillRect((x + 12) * k, (top + 2) * k, 13 * k, 12 * k); ctx.fillStyle = '#fff'; ctx.fillRect((x + 13) * k, (top + 3) * k, 11 * k, 10 * k); return drawIcon(ctx, e ?? 'sun', x + 14, top + 4, k);
      case 'ball': { const bx = AX + 14 + Math.abs(((t * 18) % 40) - 20); return drawIcon(ctx, 'ball', bx, FLOOR - 6 - Math.round(Math.abs(Math.sin(t * 6)) * 5), k); }
      case 'box': return t < 2 ? big('box', x - 10, FLOOR - 24, 3) : big('box', x + 16, FLOOR - 15, 3);
      case 'radio': return big('radio', 2, FLOOR - 12, 2);
      case 'tv': return big('tv', BOX_W - 16, FLOOR - 16, 2);
      case 'crayons': return drawIcon(ctx, 'crayons', x + 10, FLOOR - 4, k);
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
        if (state === 'paint') this.painted();
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
  rect(now) { if (!this.box || now - this.boxAt > 500) { this.box = this.el.getBoundingClientRect(); this.boxAt = now; } return this.box; }

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
    this.react('happy', { icon: 'heart', n: 3 });
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
      else this.react('eat', { icon: effect === 'bright' ? 'sparkle' : effect === 'moody' ? 'moon' : 'heart', n: 3, say: `${name}!` });
    }, 700);
  }

  toy(id) {
    if (!this.awake()) return this.say('Zzz…');
    this.stats.change({ fun: 12, energy: -2 }, 1);
    this.stats.happy(0.5); this.stats.feel('joy', 20);
    this.react(id, { say: { ball: 'Catch!', box: 'Where am I?', radio: 'I love this song!', tv: 'Ooh, cartoons!', crayons: 'Let me draw!' }[id] });
  }

  school() {
    const s = this.stats;
    if (!this.awake()) return this.say('Zzz…');
    s.attend(currentLesson()[0]);
    this.react('wave', { say: 'Off to kindergarten!' });
    setTimeout(() => this.play('school'), 1500);
  }

  doctor() {
    const s = this.stats;
    if (!s.sick) return this.react('happy', { say: 'The doctor says I’m healthy!' });
    this.parts.push({ icon: 'pill', x: AX + 16, y: FLOOR - 40, vx: -0.4, vy: 0.2, life: 16 });
    setTimeout(() => { s.cure(); this.react('cheer', { icon: 'sparkle', n: 4, say: 'All better! Thank you!', force: true }); }, 900);
  }

  playGame() {
    if (!this.awake()) return this.say('Zzz…');
    if (this.stats.energy < 20) return this.react('refuse', { say: 'Too tired to play…' });
    this.react('wave', { say: 'Catch the stars!' });
    startStarGame(this);
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

  gameOver(score) {
    const s = this.stats;
    s.change({ fun: 8 + score * 6, energy: -10, love: 4 }, score * 2);
    s.earn(score); s.happy(score >= 6 ? 2 : 1); s.train('luck', score * 5);
    if (score >= 6) this.react('cheer', { icon: 'star', n: 5, say: `${score} stars! Amazing!`, force: true });
    else if (score >= 3) this.react('happy', { icon: 'star', n: 3, say: `${score} stars, nice!` });
    else this.react(s.is('crybaby') ? 'cry' : 'oops', { say: score ? `Only ${score}… again?` : 'Aww, missed them all!' });
  }

  nap() { this.stats.sleep(true); this.say('Night night…'); this.play('sleep'); }
  wake() { this.stats.sleep(false); this.react('happy', { icon: 'sparkle', say: 'I’m up!', force: true }); }
}
