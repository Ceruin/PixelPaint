import { local } from '../core/storage.js';
import { bus } from '../core/bus.js';

// Pip's care model (Tamagotchi-style): four needs that drift over real time — including while
// the app is closed, gently — plus experience and levels earned by caring for her and by painting.
const KEY = 'pp.pip';
const HOUR = 3600e3;
// Change per hour while awake / asleep.
const AWAKE = { food: -7, fun: -9, love: -5, energy: -5 };
const ASLEEP = { food: -3, fun: -2, love: -1, energy: 30 };
export const NEEDS = [['food', 'Fullness', 'onigiri', '#ff9f2b'], ['fun', 'Fun', 'ball', '#3b7bff'], ['love', 'Love', 'heart', '#e0485a'], ['energy', 'Energy', 'moon', '#9d86ff']];
export const SNACKS = [
  ['onigiri', 'Onigiri', { food: 35 }], ['strawberry', 'Strawberry', { food: 15, fun: 10 }],
  ['dango', 'Dango', { food: 25, love: 8 }], ['tea', 'Tea', { food: 8, energy: 18 }],
];

const clamp = v => Math.max(0, Math.min(100, v));

export class PipStats {
  constructor() {
    const now = Date.now();
    Object.assign(this, { food: 80, fun: 80, love: 70, energy: 90, asleep: false, xp: 0, level: 1, born: now, t: now }, local.get(KEY, {}));
    const away = now - this.t;
    this.update(Math.min(away, 24 * HOUR), true);
    this.welcomeBack = away > 2 * HOUR;
    setInterval(() => this.update(Date.now() - this.t), 20e3);
  }

  // Applies elapsed time. Absence never drops a need below 15: she misses you, she doesn't starve.
  update(ms, offline = false) {
    const rates = this.asleep ? ASLEEP : AWAKE, h = ms / HOUR;
    for (const k of ['food', 'fun', 'love', 'energy']) this[k] = clamp(offline ? Math.max(Math.min(this[k], 15), this[k] + rates[k] * h) : this[k] + rates[k] * h);
    if (this.asleep && this.energy >= 100) this.asleep = false;
    this.t = Date.now();
    this.save();
  }

  change(delta, xp = 0) {
    for (const [k, v] of Object.entries(delta)) this[k] = clamp(this[k] + v);
    this.gainXp(xp);
    this.save();
  }

  gainXp(n) {
    if (!n) return;
    this.xp += n;
    const need = this.level * 40;
    if (this.xp >= need) { this.xp -= need; this.level++; bus.emit('pip:level', this.level); }
  }

  sleep(on) { this.asleep = on; this.save(); }
  get ageDays() { return Math.floor((Date.now() - this.born) / (24 * HOUR)); }

  // The most pressing need, if any, drives her mood and idle behaviour.
  get need() {
    if (this.asleep) return 'asleep';
    if (this.energy < 18) return 'tired';
    if (this.food < 28) return 'hungry';
    if (this.love < 28) return 'lonely';
    if (this.fun < 28) return 'bored';
    return null;
  }

  get mood() {
    return {
      asleep: 'Pip is fast asleep. Zzz…', tired: 'Pip can barely keep her eyes open.', hungry: 'Pip’s tummy is rumbling…',
      lonely: 'Pip wants some attention!', bored: 'Pip is bored. Paint something, or play with her!',
    }[this.need] ?? (this.food + this.fun + this.love + this.energy > 330 ? 'Pip is having a wonderful time ✿' : 'Pip is happy and ready to paint.');
  }

  save() { const { food, fun, love, energy, asleep, xp, level, born, t } = this; local.set(KEY, { food, fun, love, energy, asleep, xp, level, born, t }); bus.emit('pip:stats', this); }
}
