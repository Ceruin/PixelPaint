import { h } from './dom.js';
import { bus } from '../core/bus.js';

// "Pip", a Tamagotchi-style helper living in the UI chrome (never over the canvas).
// State machine: transitions are data; each state's enter() sets timers & visuals.
const MACHINE = {
  idle: { sleep: 'sleeping', save: 'cheering', tip: 'pointing', pet: 'cheering' },
  sleeping: { wake: 'idle', save: 'cheering', tip: 'pointing', pet: 'idle' },
  cheering: { done: 'idle', tip: 'pointing' },
  pointing: { untip: 'idle', save: 'cheering' },
};
const SLEEP_AFTER = 45000;

const SVG = `
<svg viewBox="0 0 48 48" aria-hidden="true">
  <g class="m-z"><text x="34" y="12">z</text><text x="39" y="6">z</text></g>
  <g class="m-sparks"><path d="M6 8l1.2 2.6L10 12l-2.8 1.2L6 16l-1.2-2.8L2 12l2.8-1.4z"/><path d="M42 14l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/></g>
  <g class="m-body">
    <path class="m-leaf" d="M24 11c-.6-3.5 1.4-6.6 5.2-7.2.4 3.7-1.8 6.6-5.2 7.2z"/>
    <path class="m-blob" d="M24 10c9.5 0 16 6.5 16 16 0 9-6.8 14-16 14S8 35 8 26c0-9.5 6.5-16 16-16z"/>
    <g class="m-eyes"><ellipse cx="18.5" cy="25" rx="2.3" ry="3"/><ellipse cx="29.5" cy="25" rx="2.3" ry="3"/></g>
    <path class="m-shut" d="M16 25.5q2.5 1.8 5 0M27 25.5q2.5 1.8 5 0"/>
    <ellipse class="m-cheek" cx="14.5" cy="30" rx="2.2" ry="1.3"/><ellipse class="m-cheek" cx="33.5" cy="30" rx="2.2" ry="1.3"/>
    <path class="m-mouth" d="M21 31q3 2.6 6 0"/>
    <path class="m-arm m-arm-l" d="M9.5 29q-4 1.5-5 5"/>
    <path class="m-arm m-arm-r" d="M38.5 29q4 1.5 5 5"/>
  </g>
</svg>`;

export class Mascot {
  constructor() {
    this.el = h('div.mascot', { 'data-tip': 'Pip — your studio buddy', title: '' });
    this.el.innerHTML = SVG;
    this.bubble = h('div.m-bubble');
    this.el.append(this.bubble);
    this.el.addEventListener('click', () => this.send('pet'));
    this.state = null;
    this.enter('idle');
    bus.on('saved', e => !e?.auto && this.send('save'));
    bus.on('tip', r => { this.aim(r); this.send('tip'); });
    bus.on('untip', () => this.send('untip'));
    bus.on('activity', () => this.poke());
    ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => this.poke(), { passive: true }));
  }

  mount(host) { if (host && this.el.parentElement !== host) host.append(this.el); }
  send(ev) { const next = MACHINE[this.state]?.[ev]; if (next) this.enter(next); }

  enter(s) {
    clearTimeout(this.timer);
    this.state = s;
    this.el.dataset.state = s;
    this.bubble.textContent = s === 'cheering' ? 'Saved! ✨' : '';
    if (s === 'cheering') this.timer = setTimeout(() => this.send('done'), 1800);
    if (s === 'idle') this.timer = setTimeout(() => this.send('sleep'), SLEEP_AFTER);
  }

  poke() {
    if (this.state === 'sleeping') this.send('wake');
    else if (this.state === 'idle') this.enter('idle');
  }

  // Rotates the right arm toward the tooltip's centre.
  aim(r) {
    const m = this.el.getBoundingClientRect();
    if (!m.width) return;
    const a = Math.atan2(r.top + r.height / 2 - (m.top + m.height * 0.6), r.left + r.width / 2 - (m.left + m.width * 0.8)) * 180 / Math.PI;
    this.el.style.setProperty('--aim', `${a - 50}deg`);
  }
}
