import { h } from './dom.js';
import { bus } from '../core/bus.js';

// Pip — the painter girl from the character sheet, drawn from a sprite atlas (assets/).
export const ATLAS = { src: 'assets/pip-sprites.webp', w: 2164, h: 151 };
export const SPRITES = {
  idle0: [0, 13, 107, 138], idle1: [109, 12, 104, 139], walk: [215, 10, 105, 141], brush: [322, 10, 134, 141],
  paint: [458, 9, 231, 142], raise: [691, 14, 139, 137], point: [832, 19, 134, 132], floor: [968, 27, 149, 124],
  cheer: [1119, 16, 149, 135], spray: [1270, 9, 226, 142], happy: [1498, 0, 164, 151], oops: [1664, 3, 157, 148],
  drowsy: [1823, 22, 146, 129], sleep: [1971, 65, 191, 86],
};
const REF_H = 142;   // standing height: every pose is scaled by the same factor

// Places one atlas frame into `el` (a positioned box), bottom-left anchored, at `height` px tall.
export function showSprite(el, name, height, flip = false) {
  const [x, y, w, hh] = SPRITES[name], k = height / REF_H;
  Object.assign(el.style, {
    width: `${w * k}px`, height: `${hh * k}px`,
    backgroundImage: `url(${ATLAS.src})`, backgroundSize: `${ATLAS.w * k}px ${ATLAS.h * k}px`,
    backgroundPosition: `${-x * k}px ${-y * k}px`, transform: flip ? 'scaleX(-1)' : '',
  });
}

// Behaviour is a data table: poses to cycle, frame rate, and which events lead where.
const STATES = {
  idle: { poses: ['idle0', 'idle1'], fps: 1.4, after: [20000, 'doodle'], on: { wake: 'idle', paint: 'painting', save: 'cheering', tip: 'pointing', undo: 'oops', sleep: 'drowsy', pet: 'happy' } },
  doodle: { poses: ['floor'], fps: 0, after: [25000, 'drowsy'], on: { paint: 'painting', save: 'cheering', tip: 'pointing', wake: 'idle', pet: 'happy' } },
  painting: { poses: ['brush', 'paint'], fps: 3, after: [1200, 'idle'], on: { save: 'cheering', undo: 'oops', paint: 'painting' } },
  pointing: { poses: ['point'], fps: 0, on: { untip: 'idle', save: 'cheering' } },
  cheering: { poses: ['cheer', 'happy', 'cheer', 'spray'], fps: 3, after: [2000, 'idle'], on: { tip: 'pointing' } },
  happy: { poses: ['happy'], fps: 0, after: [1400, 'idle'], on: { save: 'cheering' } },
  oops: { poses: ['oops'], fps: 0, after: [900, 'idle'], on: { save: 'cheering', undo: 'oops' } },
  drowsy: { poses: ['drowsy'], fps: 0, after: [6000, 'sleeping'], on: { wake: 'idle', paint: 'painting', save: 'cheering', tip: 'pointing', pet: 'happy' } },
  sleeping: { poses: ['sleep'], fps: 0, on: { wake: 'idle', save: 'cheering', pet: 'happy' } },
};
const BUBBLES = { cheering: 'Saved! ✨', happy: '♪', oops: 'Oops!' };

export class Mascot {
  constructor() {
    this.sprite = h('div.m-sprite');
    this.bubble = h('div.m-bubble');
    this.el = h('div.mascot', { 'data-tip': 'Pip — your painting buddy (click to say hi)' }, this.sprite, this.bubble);
    this.el.addEventListener('click', () => this.send('pet'));
    this.height = 64;
    this.flip = false;
    this.enter('idle');
    bus.on('saved', e => !e?.auto && this.send('save'));
    bus.on('tip', r => { this.aim(r); this.send('tip'); });
    bus.on('untip', () => this.send('untip'));
    bus.on('history', hist => {
      const last = hist.done.at(-1)?.label;
      if (['Brush', 'Eraser', 'Smudge', 'Fill', 'Shape'].includes(last) && hist.undone.length === 0) this.send('paint');
      else if (hist.undone.length && this.lastUndone !== hist.undone.length) this.send('undo');
      this.lastUndone = hist.undone.length;
    });
    ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => this.send('wake'), { passive: true }));
    new ResizeObserver(() => this.fit()).observe(this.el);
  }

  mount(host) { if (host && this.el.parentElement !== host) { host.append(this.el); this.fit(); } }
  fit() { const hh = this.el.clientHeight; if (hh && hh !== this.height) { this.height = hh; this.draw(); } }
  send(ev) { const next = STATES[this.state]?.on[ev]; if (next) this.enter(next); }

  enter(s) {
    clearTimeout(this.timer); clearInterval(this.ticker);
    const st = STATES[s];
    this.state = s; this.frame = 0;
    this.el.dataset.state = s;
    this.bubble.textContent = BUBBLES[s] ?? '';
    if (s !== 'pointing') this.flip = false;
    if (st.fps) this.ticker = setInterval(() => { this.frame = (this.frame + 1) % st.poses.length; this.draw(); }, 1000 / st.fps);
    if (st.after) this.timer = setTimeout(() => this.enter(st.after[1]), st.after[0]);
    this.draw();
  }

  draw() { showSprite(this.sprite, STATES[this.state].poses[this.frame], this.height, this.flip); }

  // Points her brush at the tooltip: raised when it's above her, mirrored when it's to her left.
  aim(r) {
    const m = this.el.getBoundingClientRect();
    if (!m.width) return;
    const dx = r.left + r.width / 2 - (m.left + m.width / 2), dy = r.top + r.height / 2 - (m.top + m.height / 2);
    STATES.pointing.poses = [dy < -Math.abs(dx) ? 'raise' : 'point'];
    this.flip = dx < 0;
  }
}
