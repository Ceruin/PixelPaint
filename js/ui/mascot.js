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
<svg viewBox="0 0 64 64" aria-hidden="true">
  <g class="m-z"><text x="46" y="13">z</text><text x="52" y="7">z</text></g>
  <g class="m-sparks"><path d="M8 10l1.3 3 3 1.3-3 1.3L8 18.6l-1.3-3-3-1.3 3-1.3z"/><path d="M55 20l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/><path d="M50 4l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/></g>
  <g class="m-body">
    <path class="o shoe" d="M24 57.5h7v3.5h-8.2c-.9 0-1.2-1-.6-1.6zM33 57.5h7l1.8 1.9c.6.6.3 1.6-.6 1.6H33z"/>
    <path class="o sock" d="M26 53h4v4.5h-4zM34 53h4v4.5h-4z"/>
    <path class="o skirt" d="M23.5 49.5h17l1.2 4.5H22.3z"/>
    <g class="m-arm-l">
      <path class="o smock" d="M24.5 39.5 19 45.5l2.6 2 4.4-4.4z"/>
      <path class="o palette" d="M9.5 44.5c1.5-3.8 7-5 10.5-3 3 1.7 3.3 5.3.6 7.2-1.4 1-1.2 2.4-2.8 3.1-3.8 1.6-9.9-2.8-8.3-7.3z"/>
      <circle class="hole" cx="17.5" cy="47.5" r="1.1"/>
      <circle class="dab r" cx="12.6" cy="45.3" r="1.4"/><circle class="dab y" cx="15.8" cy="43.2" r="1.3"/><circle class="dab b" cx="13.6" cy="48.6" r="1.3"/>
    </g>
    <path class="o smock" d="M25.5 37h13l4.5 13.5H21z"/>
    <path class="fold" d="M29 41l-1.5 9M35 41l1.5 9"/>
    <path class="o collar" d="M26 36.2l6 3.2 6-3.2-1 3.3-5 2-5-2z"/>
    <circle class="o button" cx="32" cy="44.5" r="1.7"/>
    <g class="m-arm-r">
      <path class="o smock" d="M38.5 38.5l6.5 5.2-2.4 2.6-5.6-4z"/>
      <circle class="o skin" cx="44.6" cy="45.2" r="2"/>
      <path class="handle" d="M43.6 46.6 55.5 34.7"/>
      <path class="ferrule" d="M54.6 35.6l2.2-2.2"/>
      <path class="o tip" d="M56 34.2l2.3-4.4c1.2-2.1 4.1-.2 2.9 1.9l-3.4 3.6z"/>
    </g>
    <g class="m-head">
      <path class="o hair" d="M18.5 28c-1.2-9 4.5-16 13.5-16s14.7 7 13.5 16l-.6 6.2-3.4-1.8V27h-19v5.4l-3.4 1.8z"/>
      <path class="o skin" d="M20.5 26.5c0-6.5 5-10.5 11.5-10.5s11.5 4 11.5 10.5c0 6.8-5 10.8-11.5 10.8s-11.5-4-11.5-10.8z"/>
      <path class="hair" d="M20.3 25c.8-6 5.4-9.8 11.7-9.8s10.9 3.8 11.7 9.8c-2.6-.6-4.6-2.4-5.6-4.6-2.2 2-5.8 2.9-8.9 2.2-1.9 1.9-5 2.7-8.9 2.4z"/>
      <path class="o hair" d="M20.6 30.5l-3.8 3.1 4.2-.6zM43.4 30.5l3.8 3.1-4.2-.6z"/>
      <g class="m-eyes">
        <path class="eye" d="M25.3 25.8c0-1.6 1-2.7 2.3-2.7s2.3 1.1 2.3 2.7v1.5c0 1.6-1 2.7-2.3 2.7s-2.3-1.1-2.3-2.7z"/>
        <path class="eye" d="M34.1 25.8c0-1.6 1-2.7 2.3-2.7s2.3 1.1 2.3 2.7v1.5c0 1.6-1 2.7-2.3 2.7s-2.3-1.1-2.3-2.7z"/>
        <circle class="glint" cx="28.3" cy="25" r=".9"/><circle class="glint" cx="37.1" cy="25" r=".9"/>
      </g>
      <path class="m-shut" d="M25.2 27.4q2.4 1.8 4.8 0M34 27.4q2.4 1.8 4.8 0"/>
      <ellipse class="cheek" cx="23.6" cy="31" rx="2.1" ry="1.1"/><ellipse class="cheek" cx="40.4" cy="31" rx="2.1" ry="1.1"/>
      <path class="m-mouth" d="M30.4 32.2q1.6 1.5 3.2 0"/>
      <path class="o beret" d="M16.5 18.5c.4-6.5 8.8-10.6 17-10.1 7.3.4 13.6 3.8 13.2 8-.2 2.3-4 2.9-8.7 2.8-7.7-.1-14.7-2.2-21.5-.7z"/>
      <path class="stem" d="M31.5 8.6l.7-2.6"/>
    </g>
  </g>
</svg>`;

export class Mascot {
  constructor() {
    this.el = h('div.mascot', { 'data-tip': 'Pip — your painting buddy', title: '' });
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
