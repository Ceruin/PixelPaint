import { h } from './dom.js';
import { bus } from '../core/bus.js';
import { drawIcon, iconSize } from './pixelIcons.js';
import { PyxlStats } from './pyxlStats.js';
import { openCareCard, startStarGame } from './pyxlCare.js';

// Pyxl — pixel sprites rebuilt from the character sheet at their native resolution (one art pixel
// per sprite pixel, shared palette, 1px outline). Always drawn at an integer scale so she stays crisp.
const atlas = new Image();
atlas.src = 'assets/pyxl-pixel.webp';
export const atlasReady = atlas.decode().catch(() => {});

// Outfit: her teal smock (and the teal paint on her beret) is recoloured to the colour you're
// painting with. Greys keep her last colourful outfit; the default is her original teal.
const outfitAtlas = document.createElement('canvas');
let outfitHex = null;
const hsv = (r, g, b) => { const v = Math.max(r, g, b), d = v - Math.min(r, g, b); return [d === 0 ? 0 : v === r ? ((g - b) / d + 6) % 6 * 60 : v === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60, v ? d / v : 0, v / 255]; };
const rgb = (hh, s, v) => { const f = n => { const k = (n + hh / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); }; return [f(5), f(3), f(1)]; };
const isTeal = (hh, s, v) => hh > 150 && hh < 205 && s > 0.25 && v > 0.2;
export function setOutfit(hex) {
  if (!atlas.complete || hex === outfitHex) return;
  const [th, ts, tv] = hsv(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  if (ts < 0.25 || tv < 0.3) return;
  outfitHex = hex;
  Object.assign(outfitAtlas, { width: atlas.width, height: atlas.height });
  const c = outfitAtlas.getContext('2d');
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
}
const sheet = () => (outfitHex ? outfitAtlas : atlas);
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
export function drawPose(ctx, name, x, y, k, flip = false, breath = 0) {
  const [sx, sy, w, hh, ax, by] = SPRITES[name], cut = Math.max(0, by - 22);
  const part = (y0, y1, dy) => y1 > y0 && ctx.drawImage(sheet(), sx, sy + y0, w, y1 - y0, flip ? -ax * k : (x - ax) * k, (y - by + y0 + dy) * k, w * k, (y1 - y0) * k);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) { ctx.translate(x * k, 0); ctx.scale(-1, 1); }
  part(cut, hh, 0);
  part(0, cut, breath);
  ctx.restore();
}

const BOX_W = 92, BOX_H = 76, AX = 36, FLOOR = 74;

// Behaviour table: poses to cycle (fps), duration (or hold), breathing period (s) and motion flavour.
const STATES = {
  idle: { poses: ['front'], hold: true, breath: 1.8 },
  glance: { poses: ['front', 'side', 'side', 'side', 'front'], fps: 1.6, dur: 3000, breath: 1.8 },
  peek: { poses: ['side', 'back', 'back', 'back', 'side'], fps: 1.6, dur: 3000, breath: 1.8 },
  stretch: { poses: ['front', 'raise', 'raise', 'front'], fps: 1.4, dur: 2800, breath: 1.2 },
  walk: { poses: ['idle0', 'idle1', 'walk', 'idle1'], fps: 6, hold: true, walk: true },
  wave: { poses: ['raise', 'idle1'], fps: 3, dur: 1600 },
  paint: { poses: ['brush', 'paint'], fps: 4, dur: 1300 },
  spray: { poses: ['spray'], dur: 1100 },
  point: { poses: ['point'], hold: true, breath: 1.8 },
  raise: { poses: ['raise'], hold: true, breath: 1.8 },
  reach: { poses: ['raise', 'point'], fps: 2, hold: true },
  cheer: { poses: ['cheer', 'happy'], fps: 4, dur: 2200, hop: true },
  dance: { poses: ['cheer', 'happy', 'raise', 'happy'], fps: 3, hold: true, hop: true },
  happy: { poses: ['happy'], dur: 1400, hop: true },
  eat: { poses: ['happy', 'idle1'], fps: 3, dur: 2000 },
  oops: { poses: ['oops'], dur: 900, shake: true },
  refuse: { poses: ['oops'], dur: 1300, shake: true },
  sit: { poses: ['floor'], hold: true, breath: 2.2 },
  drowsy: { poses: ['drowsy'], hold: true, breath: 2.6 },
  sleep: { poses: ['sleep'], hold: true, breath: 3 },
};
const FIDGETS = ['glance', 'walk', 'peek', 'stretch', 'glance', 'walk', 'wave', 'paint'];
const RANGE = [-10, 20]; // how far (native px) she strolls from her spot
const NEED_ICON = { hungry: 'onigiri', lonely: 'heart', bored: 'dots', tired: 'moon' };
const ACTIONS = [
  [/^(Brush|Smudge|Shape|Eraser)$/, 'paint', null],
  [/^Fill$/, 'spray', 'drop'],
  [/^(New Layer|New Group|Group Layer|Duplicate|New Frame|Duplicate Frame|New Tag|New Filter Layer|Import Frames)$/, 'wave', 'plus'],
  [/^(Delete Layer|Delete Frame|Clear|Cut|Blank Cel)$/, 'oops', 'bang'],
  [/Blur|Hue|Brightness|Invert|Desaturate|Outline|Adjust|Transform|Merge|Flatten|Replace/, 'cheer', 'sparkle'],
];

export class Mascot {
  constructor(app) {
    this.app = app;
    this.stats = new PyxlStats();
    this.canvas = h('canvas.pyxl-canvas');
    this.bubble = h('div.m-bubble');
    this.el = h('div.mascot', { 'data-tip': 'Pyxl — click to care for her' }, this.canvas, this.bubble);
    Object.assign(this, { parts: [], k: 1, flip: false, pets: [], lastUndone: 0, lastActive: Date.now(), nextFidget: Date.now() + 6000, nextNeed: 0, pos: 0, path: [], blinkAt: Date.now() + 3000 });
    this.el.addEventListener('click', () => this.onClick());
    this.el.addEventListener('pointerenter', () => this.greet());
    this.el.addEventListener('pointerleave', () => { this.hovered = false; });
    addEventListener('pointermove', e => { this.cursor = { x: e.clientX, y: e.clientY, t: Date.now() }; }, { passive: true });
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (Date.now() - hiddenAt > 60000 && !this.stats.asleep) this.react('happy', { icon: 'heart', n: 2, say: 'You’re back!' });
    });
    atlasReady.then(() => this.app && setOutfit(this.app.color.fg));
    new ResizeObserver(() => this.fit()).observe(this.el);
    this.wire();
    this.base();
    setInterval(() => this.tick(), 1000 / 12);
    if (this.stats.welcomeBack) setTimeout(() => this.react('happy', { icon: 'heart', say: 'Welcome back!' }), 1800);
  }

  mount(host) { if (host && this.el.parentElement !== host) { host.append(this.el); this.fit(); } }

  fit() {
    const dpr = devicePixelRatio || 1, r = this.el.getBoundingClientRect();
    if (!r.height) return;
    this.k = Math.max(1, Math.floor(Math.min(r.height * dpr / BOX_H, (r.width + 24) * dpr / BOX_W)));
    Object.assign(this.canvas, { width: BOX_W * this.k, height: BOX_H * this.k });
    Object.assign(this.canvas.style, { width: `${BOX_W * this.k / dpr}px`, height: `${BOX_H * this.k / dpr}px` });
  }

  // ---- state machine ----
  play(name, { dur, say = '', flip } = {}) {
    const st = STATES[name];
    this.state = name;
    this.started = performance.now();
    this.until = st.hold && dur == null ? Infinity : Date.now() + (dur ?? st.dur ?? 1500);
    if (flip != null) this.flip = flip; else if (!st.walk && !st.breath) this.flip = false;
    if (st.walk) this.path = [RANGE[0] + Math.random() * (RANGE[1] - RANGE[0]), Math.random() < 0.5 ? 0 : RANGE[0] + Math.random() * (RANGE[1] - RANGE[0])].map(Math.round);
    if (name === 'glance') this.flip = Math.random() < 0.5;
    this.say(say);
    this.el.dataset.state = name;
  }

  say(text, ms = 1800) {
    clearTimeout(this.sayTimer);
    this.bubble.textContent = text;
    if (text) this.sayTimer = setTimeout(() => { this.bubble.textContent = ''; }, ms);
  }

  // Resting behaviour follows her most pressing need.
  base() {
    const need = this.stats.need;
    if (need === 'asleep') return this.play('sleep');
    if (need === 'tired') return this.play('drowsy');
    if (need === 'bored' && Date.now() - this.lastActive > 20000) return this.play('sit');
    this.play('idle');
  }

  react(name, { icon, n = 3, say, color, dur, force } = {}) {
    if (this.stats.asleep && !force) return;
    if (this.state === 'dance' && !force) return;
    this.play(name, { dur, say });
    if (icon) this.burst(icon, n, color);
  }

  burst(icon, n = 3, color) {
    for (let i = 0; i < n; i++) this.parts.push({ icon, color, x: AX - 12 + Math.random() * 24, y: FLOOR - 56 - Math.random() * 6, vx: (Math.random() - 0.5) * 0.6, vy: -0.5 - Math.random() * 0.5, life: 22 + i * 4 });
  }

  tick() {
    const now = Date.now(), st = STATES[this.state];
    if (now > this.until) this.base();
    if (this.stats.energy < 10 && !this.stats.asleep) { this.stats.sleep(true); this.say('So sleepy…'); this.play('sleep'); }
    if (this.stats.asleep && this.stats.energy >= 100) { this.stats.sleep(false); this.react('happy', { icon: 'sparkle', say: 'Good morning!' }); }
    if (this.state === 'idle' && now > this.nextFidget) {
      this.nextFidget = now + 5000 + Math.random() * 7000;
      const pick = this.stats.need === 'lonely' ? 'wave' : FIDGETS[Math.floor(Math.random() * FIDGETS.length)];
      this.play(pick, pick === 'wave' && this.stats.need === 'lonely' ? { say: 'Hey! Over here!' } : {});
    }
    if (this.state === 'idle' && this.stats.need === 'bored' && now - this.lastActive > 20000) this.play('sit');
    if (st?.walk) this.stroll();
    if (now > this.blinkAt + 150) this.blinkAt = now + 2500 + Math.random() * 3500 * (Math.random() < 0.2 ? 0.1 : 1);
    this.watchCursor(now);
    const need = this.stats.need;
    if (NEED_ICON[need] && now > this.nextNeed && !this.stats.asleep) { this.nextNeed = now + 4000; this.parts.push({ icon: NEED_ICON[need], x: AX + 10, y: FLOOR - 64, vx: 0, vy: -0.15, life: 26 }); }
    this.render();
  }

  // Walks her along `path` one pixel per tick, turning to face each leg; home again when done.
  stroll() {
    const to = this.path[0];
    if (to == null) return this.base();
    if (to === this.pos) return void this.path.shift();
    this.flip = to < this.pos;
    this.pos += Math.sign(to - this.pos);
  }

  render() {
    const ctx = this.canvas.getContext('2d'), k = this.k, st = STATES[this.state], t = (performance.now() - this.started) / 1000;
    if (!atlas.complete || !st) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let pose = st.poses[st.fps ? Math.floor(t * st.fps) % st.poses.length : 0];
    let x = AX + this.pos, y = FLOOR, flip = this.flip;
    if (this.state === 'idle' && this.gaze) { pose = 'side'; flip = this.gaze < 0; }
    if (pose === 'front' && Date.now() > this.blinkAt) pose = 'frontBlink';
    if (pose === 'side') flip = !flip; // side view is drawn facing left
    if (st.hop) y -= Math.round(Math.abs(Math.sin(t * 9)) * 3);
    if (st.shake) x += Math.floor(t * 18) % 2 ? 1 : -1;
    if (st.walk && Math.floor(t * st.fps) % 2) y -= 1; // bob on each step
    const [, , w, , ax] = SPRITES[pose], [l, r] = flip ? [w - ax, ax] : [ax, w - ax];
    x = Math.max(l, Math.min(BOX_W - r, x)); // wide poses never clip out of her box
    const breath = st.breath && (t % st.breath) / st.breath > 0.55 ? 1 : 0;
    drawPose(ctx, pose, x, y, k, flip, breath);
    this.parts = this.parts.filter(p => p.life-- > 0);
    for (const p of this.parts) {
      p.x += p.vx; p.y += p.vy;
      ctx.globalAlpha = Math.min(1, p.life / 8);
      const [w] = iconSize(p.icon);
      drawIcon(ctx, p.icon, p.x + this.pos - w / 2, p.y, k, p.color);
    }
    ctx.globalAlpha = 1;
  }

  // ---- reactions to what the user does ----
  wire() {
    const active = () => { this.lastActive = Date.now(); if (this.state === 'sit' && this.stats.need !== 'bored') this.base(); };
    ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, active, { passive: true }));
    bus.on('history', hist => {
      const undone = hist.undone.length, top = hist.done.at(-1), label = top?.label ?? '';
      if (undone > this.lastUndone) this.react('oops', { icon: 'drop', n: 1 });
      else if (top && top === this.redoTop) this.react('happy', { icon: 'sparkle', n: 2 });
      else for (const [re, state, icon] of ACTIONS) if (re.test(label)) {
        this.react(state, { icon, color: state === 'spray' ? this.app?.color.fg : null });
        if (state === 'paint') { this.stats.change({ fun: 0.6 }, 0.5); if (this.state === 'sit') this.base(); }
        break;
      }
      this.lastUndone = undone;
      this.redoTop = hist.undone.at(-1);
    });
    bus.on('saved', e => { if (!e?.auto) { this.stats.gainXp(5); this.react('cheer', { icon: 'star', n: 4, say: 'Saved!' }); } });
    bus.on('mode', () => this.react('walk'));
    bus.on('play', on => (on ? this.react('dance') : this.state === 'dance' && this.base()));
    bus.on('pyxl:level', lv => this.react('cheer', { icon: 'star', n: 6, say: `Level ${lv}!`, force: true }));
    let colorAt = 0;
    bus.on('color', c => setOutfit(c.fg));
    bus.on('color', c => { if (Date.now() - colorAt > 2500 && this.state === 'idle') { colorAt = Date.now(); this.react('paint', { icon: 'drop', n: 1, color: c.fg, dur: 900 }); } });
    bus.on('tip', r => this.aim(r));
    bus.on('untip', () => ['point', 'raise'].includes(this.state) && this.base());
  }

  // Points her brush at a tooltip: raised when it's above her, mirrored when it's to her left.
  aim(r) {
    if (this.stats.asleep || !['idle', 'glance', 'peek', 'point', 'raise', 'sit'].includes(this.state)) return;
    const m = this.el.getBoundingClientRect();
    if (!m.width) return;
    const dx = r.left + r.width / 2 - (m.left + m.width / 2), dy = r.top + r.height / 2 - (m.top + m.height / 2);
    this.play(dy < -Math.abs(dx) ? 'raise' : 'point', { flip: dx < 0 });
  }

  // Hovering over her: a wave, or a shy giggle if you linger or keep coming back.
  greet() {
    this.hovered = true;
    if (!['idle', 'glance', 'peek', 'sit', 'reach'].includes(this.state)) return;
    this.greets = (this.greets ?? 0) + 1;
    if (this.greets % 3 === 0) this.react('happy', { icon: 'heart', n: 1, say: 'Hehe…', dur: 1200 });
    else this.react('wave', { dur: 1200 });
  }

  // Self-aware idling: she turns to face the cursor when it's near, reaches up when it hovers
  // above her head, and looks toward wherever you're working otherwise.
  watchCursor(now) {
    const c = this.cursor;
    this.gaze = 0;
    if (!c || now - c.t > 4000 || this.stats.asleep || !['idle', 'reach'].includes(this.state)) return;
    const r = this.el.getBoundingClientRect(), cx = r.left + (AX + this.pos) * this.k / (devicePixelRatio || 1), head = r.bottom - 50 * this.k / (devicePixelRatio || 1);
    const dx = c.x - cx, dy = c.y - head, near = Math.hypot(dx, dy) < 220;
    if (near && dy < -12 && Math.abs(dx) < 70 && !this.hovered) { if (this.state !== 'reach') this.play('reach', { flip: dx < 0 }); else this.flip = dx < 0; return; }
    if (this.state === 'reach') return this.base();
    if (this.state === 'idle' && near && Math.abs(dx) > 40) this.gaze = Math.sign(dx);
  }

  // ---- care ----
  onClick() { this.pet(); openCareCard(this); }

  pet() {
    const now = Date.now();
    if (this.stats.asleep) { this.stats.sleep(false); this.stats.change({ love: this.stats.energy < 40 ? -2 : 2 }); return this.react('oops', { icon: 'bang', n: 1, say: 'Huh?!', force: true }); }
    this.pets = this.pets.filter(t => now - t < 4000).concat(now);
    if (this.pets.length > 6) { this.stats.change({ love: -3 }); return this.react('refuse', { icon: 'bang', n: 1, say: 'Hey, that tickles!' }); }
    this.stats.change({ love: 8, fun: 2 }, 1);
    this.react('happy', { icon: 'heart', n: 3 });
  }

  feed([icon, name, delta]) {
    if (this.stats.asleep) return this.say('Zzz…');
    if (this.stats.food > 92) return this.react('refuse', { say: 'I’m full!' });
    this.stats.change(delta, 3);
    this.parts.push({ icon, x: AX + 16, y: FLOOR - 40, vx: -0.4, vy: 0.2, life: 16 });
    setTimeout(() => this.react('eat', { icon: 'heart', n: 2, say: `Yum, ${name.toLowerCase()}!` }), 700);
  }

  playGame() {
    if (this.stats.asleep) return this.say('Zzz…');
    if (this.stats.energy < 20) return this.react('refuse', { say: 'Too tired to play…' });
    this.react('wave', { say: 'Catch the stars!' });
    startStarGame(this);
  }

  gameOver(score) {
    this.stats.change({ fun: 8 + score * 6, energy: -10, love: 4 }, score * 2);
    if (score >= 6) this.react('cheer', { icon: 'star', n: 5, say: `${score} stars! Amazing!`, force: true });
    else if (score >= 3) this.react('happy', { icon: 'star', n: 3, say: `${score} stars, nice!` });
    else this.react('oops', { say: score ? `Only ${score}… again?` : 'Aww, missed them all!' });
  }

  nap() { this.stats.sleep(true); this.say('Night night…'); this.play('sleep'); }
  wake() { this.stats.sleep(false); this.react('happy', { icon: 'sparkle', say: 'I’m up!', force: true }); }
}
