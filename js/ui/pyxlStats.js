import { local } from '../core/storage.js';
import { bus } from '../core/bus.js';

// Pyxl's care model, after the Chao Garden (chao-island.com/info-center):
// - four needs that drift over real time (gently while the app is closed);
// - skills with a grade (E–S), level (0–99), points and a 10-step progress bar, trained by what
//   you do in the app — Line (strokes), Colour (colours & fills), Shape (shapes, selections,
//   transforms), Power (big brushes, filters), Stamina (food only) — plus hidden Luck and Smarts;
// - hidden happiness (−100…100) and emotions (joy, anger, fear, sorrow) that fade over time;
// - alignment (Bright / Neutral / Moody), a personality, a favourite fruit, illnesses;
// - a life cycle measured in active app time: egg → child → cocoon → adult → cocoon → rebirth
//   (happy: she keeps 10% of her skills) — or, fully cared for, the immortal Chaos Pyxl;
// - kindergarten lessons, rings to spend in the shop, race medals.
const KEY = 'pp.pyxl';
const HOUR = 3600e3, MIN = 60e3;
export const YEAR = 2 * HOUR;               // one Pyxl-year of active use
const CHILD_YEARS = 1, ADULT_YEARS = 4;

// Need change per hour while awake / asleep.
const AWAKE = { food: -7, fun: -9, love: -5, energy: -5 };
const ASLEEP = { food: -3, fun: -2, love: -1, energy: 30 };
export const NEEDS = [['food', 'Fullness', 'onigiri', '#ff9f2b'], ['fun', 'Fun', 'ball', '#3b7bff'], ['love', 'Love', 'heart', '#e0485a'], ['energy', 'Energy', 'moon', '#9d86ff']];

export const GRADES = ['E', 'D', 'C', 'B', 'A', 'S'];
const GAIN = [12, 15, 18, 21, 24, 27];     // points per level-up, by grade
export const SKILLS = [
  ['line', 'Line', 'pencilPx', '#17c06b'], ['colour', 'Colour', 'drop', '#ffd23f'], ['shape', 'Shape', 'star', '#a445ff'],
  ['power', 'Power', 'bolt', '#ff3b47'], ['stamina', 'Stamina', 'onigiri', '#ff9f2b'],
];
const HIDDEN = ['luck', 'smarts'];
export const TYPES = { line: 'Sketcher', colour: 'Colourist', shape: 'Designer', power: 'Bold', normal: 'All-rounder' };

// [id, name, description, per-hour need multipliers, emotion tweaks]
export const PERSONALITIES = {
  gentle: ['Gentle', 'Soft-hearted; petting means the world to her.', { love: 0.8 }],
  naughty: ['Naughty', 'A little rascal. Stays cross a while.', { fun: 1.2 }],
  energetic: ['Energetic', 'Always on the move; tires slowly.', { energy: 0.7, fun: 1.2 }],
  quiet: ['Quiet', 'Says little, notices a lot.', {}],
  bigEater: ['Big eater', 'Hungry all the time!', { food: 1.5 }],
  chatty: ['Chatty', 'Has something to say about everything.', {}],
  bored: ['Easily bored', 'Needs new things to do.', { fun: 1.6 }],
  curious: ['Curious', 'Watches everything you do; shakes off sadness fast.', {}],
  carefree: ['Carefree', 'Nothing bothers her for long.', {}],
  careless: ['Careless', 'Trips over her own feet.', {}],
  smart: ['Smart', 'Learns everything faster.', {}],
  crybaby: ['Cry baby', 'Tears up at the smallest thing.', {}],
  lonely: ['Lonely', 'Misses you the moment you look away.', { love: 1.6 }],
  naive: ['Naive', 'Surprised by everything, trusting of everyone.', {}],
  none: ['No personality', 'A blank canvas.', {}],
};

export const SNACKS = [
  ['onigiri', 'Onigiri', { food: 35 }], ['strawberry', 'Strawberry', { food: 15, fun: 10 }],
  ['dango', 'Dango', { food: 25, love: 8 }], ['tea', 'Tea', { food: 8, energy: 18 }],
];
// Shop fruit: [icon, name, price in rings, effect key]
export const SHOP = [
  ['heartFruit', 'Heart Fruit', 30, 'love'], ['brightFruit', 'Bright Fruit', 20, 'bright'], ['moodyFruit', 'Moody Fruit', 20, 'moody'],
  ['chaoFruit', 'Chao Fruit', 60, 'skills'], ['mushroom', 'Mushroom', 15, 'energy'],
];
export const ILLNESSES = { cough: 'a cough', stomach: 'a stomach ache', cold: 'a cold', rash: 'a rash', hiccups: 'the hiccups', nose: 'a runny nose' };

// Kindergarten classroom (lessons run in a fixed rotation, like the Chao Kindergarten).
export const LESSONS = [
  ['bell', 'Bell', 'instrument'], ['castanets', 'Castanets', 'instrument'], ['gogo', 'Gogo Dance', 'dance'], ['song', 'Singing', 'song'],
  ['cymbals', 'Cymbals', 'instrument'], ['drum', 'Drum', 'instrument'], ['shake', 'Shake Dance', 'dance'], ['drawing', 'Drawing', 'drawing'],
  ['flute', 'Flute', 'instrument'], ['maracas', 'Maracas', 'instrument'], ['spin', 'Spin Dance', 'dance'], ['exercise', 'Exercise', 'exercise'],
  ['tambourine', 'Tambourine', 'instrument'], ['trumpet', 'Trumpet', 'instrument'], ['step', 'Step Dance', 'dance'],
];
export const LESSON_SLOT = 3 * MIN, LESSON_TIME = 90e3;
export const currentLesson = (t = Date.now()) => LESSONS[Math.floor(t / LESSON_SLOT) % LESSONS.length];

// The fortune teller's lucky names (from the Chao Kindergarten).
export const LUCKY_NAMES = ['Ajax', 'Atom', 'Bingo', 'Bruno', 'Bubbles', 'Buddy', 'Buzzy', 'Chacha', 'Chai', 'Chalulu', 'Champ', 'Chaofun', 'Chaoko', 'Chappy', 'Chaz',
  'Choc', 'Cody', 'Cuckoo', 'Dash', 'Dixie', 'Echo', 'Emmy', 'Fuzzie', 'Hiya', 'Honey', 'Jojo', 'Kosmo', 'Melody', 'Peaches', 'Pebbles', 'Pinky', 'Quartz', 'Rascal',
  'Rocky', 'Roxy', 'Star', 'Tango', 'Tiny', 'Zippy', 'Pyxl', 'Pixie', 'Doodle', 'Crayon', 'Sketchy', 'Palette', 'Brushy'];

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pick = a => a[Math.floor(Math.random() * a.length)];
const freshSkill = () => ({ grade: Math.floor(Math.random() * 3), level: 0, pts: 0, prog: 0 });
const allFruit = () => [...SNACKS.map(s => s[0]), ...SHOP.map(s => s[0])];

function newLife(prev) {
  const skills = {};
  for (const k of [...SKILLS.map(s => s[0]), ...HIDDEN]) {
    const p = prev?.skills?.[k];
    skills[k] = p ? { grade: p.grade, level: 1, pts: Math.floor(p.pts * 0.1), prog: 0 } : freshSkill();
  }
  return {
    stage: 'egg', active: 0, skills, recent: { line: 0, colour: 0, shape: 0, power: 0 }, type: null,
    personality: pick(Object.keys(PERSONALITIES)), fav: pick(allFruit()),
    happiness: prev ? 10 : 20, align: 0, emo: { joy: 0, anger: 0, fear: 0, sorrow: 0 },
    learned: {}, sick: null, school: null, eatenRecently: 0,
  };
}

export class PyxlStats {
  constructor() {
    const now = Date.now(), saved = local.get(KEY, null) ?? local.get('pp.pip', null);
    Object.assign(this, {
      name: 'Pyxl', food: 80, fun: 80, love: 70, energy: 90, asleep: false, xp: 0, level: 1, born: now, t: now,
      lives: 1, rings: 20, medals: {}, wins: 0, races: 0, chaos: false,
    }, newLife(), saved ?? {});
    // Saves from before the life cycle: she's already a grown-up friend.
    if (saved && !saved.skills) Object.assign(this, newLife(), { stage: 'adult', type: 'normal', active: YEAR * CHILD_YEARS });
    if (!saved) this.stage = 'child';   // a new friend arrives already hatched; eggs come with rebirth
    this.emo = { joy: 0, anger: 0, fear: 0, sorrow: 0, ...this.emo };
    const away = now - this.t;
    this.update(Math.min(away, 24 * HOUR), { offline: true });
    this.welcomeBack = away > 2 * HOUR;
    setInterval(() => this.update(Date.now() - this.t, { active: this.isActive() }), 20e3);
    addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => document.hidden && this.flush());
  }

  // "Active" = the app is visible and you did something in the last two minutes; only that ages her.
  isActive() { return !document.hidden && Date.now() - (this.lastInput ?? 0) < 2 * MIN; }
  touch() { this.lastInput = Date.now(); }

  trait(k) { return PERSONALITIES[this.personality]?.[2]?.[k] ?? 1; }
  is(p) { return this.personality === p; }

  // Applies elapsed time. Absence never drops a need below 15: she misses you, she doesn't starve.
  update(ms, { offline = false, active = false } = {}) {
    const rates = this.asleep ? ASLEEP : AWAKE, h = ms / HOUR;
    for (const k of ['food', 'fun', 'love', 'energy']) {
      const d = rates[k] * h * (rates[k] < 0 ? this.trait(k) : 1);
      this[k] = clamp(offline ? Math.max(Math.min(this[k], 15), this[k] + d) : this[k] + d);
    }
    if (this.asleep && this.energy >= 100) this.asleep = false;
    // Emotions fade toward calm (personality sets the pace, like Chao kindness/aggression/curiosity).
    const m = ms / MIN, fade = this.is('carefree') ? 2 : 1;
    this.emo.joy = clamp(this.emo.joy - 1.5 * m * fade);
    this.emo.anger = clamp(this.emo.anger - (this.is('naughty') ? 0.6 : 1.2) * m * fade);
    this.emo.fear = clamp(this.emo.fear - 1.5 * m * fade);
    this.emo.sorrow = clamp(this.emo.sorrow - (this.is('curious') ? 2 : 1) * m * fade + (this.love < 20 ? 0.8 * m : 0));
    if (!offline) {
      if (this.food < 10) this.happy(-2 * h);
      if (this.love < 15) this.happy(-2 * h);
      if (this.sick) this.happy(-1 * h);
      this.eatenRecently = Math.max(0, this.eatenRecently - m / 10);
    }
    if (active && !this.asleep && this.stage !== 'egg') {
      this.active += ms;
      // Falling ill: rare, likelier when she's run down or has overeaten.
      const risk = h * (0.03 + (this.energy < 25 || this.food < 20 ? 0.08 : 0));
      if (!this.sick && this.stage !== 'chaos' && Math.random() < risk) this.fallIll();
    }
    this.t = Date.now();
    this.save();
  }

  change(delta, xp = 0) {
    for (const [k, v] of Object.entries(delta)) this[k] = clamp(this[k] + v);
    this.gainXp(xp);
    this.save();
  }
  happy(d) { this.happiness = clamp(this.happiness + d, -100, 100); }
  feel(k, d) { this.emo[k] = clamp(this.emo[k] + d); }

  // Overall friendship level (kept from the first version) — also pays rings.
  gainXp(n) {
    if (!n) return;
    this.xp += n;
    const need = this.level * 40;
    if (this.xp >= need) { this.xp -= need; this.level++; this.rings += 10; bus.emit('pyxl:level', this.level); }
  }

  // Skill training: progress fills a 10-step bar; each full bar is a level worth GAIN[grade] points.
  train(k, amount) {
    const s = this.skills[k];
    if (!s || this.stage === 'egg') return;
    amount *= this.is('smart') ? 1.3 : 1;
    s.prog += amount;
    while (s.prog >= 100 && s.level < 99) {
      s.prog -= 100; s.level++;
      s.pts = Math.min(k in { luck: 1, smarts: 1 } ? 4000 : 3266, s.pts + GAIN[s.grade] + Math.floor(Math.random() * 4));
      if (!(k in { luck: 1, smarts: 1 })) bus.emit('pyxl:skill', { k, level: s.level });
    }
    if (k in this.recent) { for (const r in this.recent) this.recent[r] *= 0.98; this.recent[k] += amount; }
    if (!(k in { luck: 1, smarts: 1 })) HIDDEN.forEach(hk => this.train(hk, amount * 0.2));
    this.save();
  }

  // ---- alignment & traits ----
  get alignment() { return this.align > 33 ? 'Bright' : this.align < -33 ? 'Moody' : 'Neutral'; }
  nudgeAlign(d) { this.align = clamp(this.align + d, -100, 100); }

  // ---- feeding (stamina only ever comes from food) ----
  eat(icon, delta) {
    const fav = icon === this.fav;
    this.change(delta, 3);
    this.train('stamina', fav ? 40 : 25);
    this.happy(fav ? 3 : 1);
    this.feel('joy', fav ? 30 : 15);
    this.eatenRecently += 1;
    if (this.eatenRecently > 4 && !this.sick && Math.random() < 0.35) this.fallIll('stomach');
    return fav;
  }
  shopEffect(effect) {
    if (effect === 'love') { this.change({ love: 40, fun: 10 }); this.feel('joy', 50); this.happy(4); this.bloom = Date.now(); }
    if (effect === 'bright') this.nudgeAlign(12);
    if (effect === 'moody') this.nudgeAlign(-12);
    if (effect === 'skills') SKILLS.forEach(([k]) => this.train(k, 60));
    if (effect === 'energy') { this.change({ energy: 30, food: 10 }); this.train('stamina', 20); }
    this.save();
  }
  spend(n) { if (this.rings < n) return false; this.rings -= n; this.save(); return true; }
  earn(n) { this.rings += Math.round(n); this.save(); }

  // ---- health ----
  fallIll(kind) {
    this.sick = kind ?? pick(Object.keys(ILLNESSES));
    this.feel('sorrow', 20);
    bus.emit('pyxl:sick', this.sick);
    this.save();
  }
  cure() { this.sick = null; this.happy(2); this.feel('joy', 20); this.save(); }

  // ---- kindergarten ----
  attend(id, now = Date.now()) { this.school = { id, until: now + LESSON_TIME }; this.save(); }
  finishSchool() {
    const id = this.school?.id;
    this.school = null;
    if (!id) return null;
    const lv = this.learned[id] ?? 0, max = id === 'song' || id === 'drawing' ? 5 : 1;
    this.learned[id] = Math.min(max, lv + 1);
    this.happy(1); this.feel('joy', 25);
    this.save();
    return { id, level: this.learned[id], fresh: lv < this.learned[id] };
  }
  knows(kind) { return LESSONS.filter(l => l[2] === kind && this.learned[l[0]]).map(l => l[0]); }

  // ---- life cycle ----
  get years() { return this.active / YEAR; }
  get ageLabel() {
    if (this.stage === 'egg') return 'An egg';
    if (this.stage === 'chaos') return 'Timeless';
    const y = Math.floor(this.years);
    return `${this.stage === 'child' ? 'Child' : 'Adult'} · ${y} year${y === 1 ? '' : 's'}`;
  }
  // What the life cycle is waiting on: 'evolve' (child → adult) or 'end' (adult's last cocoon).
  get due() {
    if (this.stage === 'child' && this.years >= CHILD_YEARS) return 'evolve';
    if (this.stage === 'adult' && this.years >= CHILD_YEARS + ADULT_YEARS) return 'end';
    return null;
  }
  hatch() { this.stage = 'child'; this.feel('joy', 40); this.save(); bus.emit('pyxl:stage', 'child'); }
  evolve() {
    const r = this.recent, top = Object.entries(r).sort((a, b) => b[1] - a[1])[0], mean = Object.values(r).reduce((a, b) => a + b, 0) / 4;
    this.type = top[1] > mean * 1.4 ? top[0] : 'normal';
    for (const s of Object.values(this.skills)) s.grade = Math.min(5, s.grade + 1);
    this.stage = 'adult';
    this.save();
    bus.emit('pyxl:stage', 'adult');
  }
  get chaosReady() {
    const all = ['instrument', 'dance'].every(k => this.knows(k).length >= (k === 'dance' ? 4 : 1)) && ['exercise', 'song', 'drawing'].every(k => this.learned[k]);
    return this.lives >= 3 && this.happiness > 50 && all && this.type === 'normal';
  }
  // End of life: a Chaos Pyxl if she's earned it; a new egg that remembers you if she's happy;
  // otherwise a fresh start (she never just disappears).
  rebirth() {
    let outcome;
    if (this.chaosReady) { this.stage = 'chaos'; this.chaos = true; outcome = 'chaos'; }
    else if (this.happiness > 50) { Object.assign(this, newLife(this)); this.lives++; outcome = 'reborn'; }
    else { Object.assign(this, newLife()); this.lives = 1; outcome = 'fresh'; }
    Object.assign(this, { food: 80, fun: 80, love: 70, energy: 90, asleep: false });
    this.save();
    bus.emit('pyxl:stage', this.stage);
    return outcome;
  }

  sleep(on) { this.asleep = on; this.save(); }
  get ageDays() { return Math.floor((Date.now() - this.born) / (24 * HOUR)); }

  // The most pressing need, if any, drives her mood and idle behaviour.
  get need() {
    if (this.stage === 'egg') return 'egg';
    if (this.school) return 'school';
    if (this.asleep) return 'asleep';
    if (this.sick) return 'sick';
    if (this.energy < 18) return 'tired';
    if (this.food < 28) return 'hungry';
    if (this.emo.sorrow > 60) return 'sad';
    if (this.love < 28) return 'lonely';
    if (this.fun < 28) return 'bored';
    return null;
  }

  get mood() {
    const n = this.name;
    return {
      egg: `${n}’s egg is warm… tap it to help her hatch!`, school: `${n} is at kindergarten.`,
      asleep: `${n} is fast asleep. Zzz…`, sick: `${n} has ${ILLNESSES[this.sick]}. The doctor can help.`,
      tired: `${n} can barely keep her eyes open.`, hungry: `${n}’s tummy is rumbling…`, sad: `${n} is feeling blue…`,
      lonely: `${n} wants some attention!`, bored: `${n} is bored. Paint something, or play with her!`,
    }[this.need] ?? (this.emo.anger > 50 ? `${n} is cross with you!` : this.happiness > 60 ? `${n} adores painting with you ✿` : this.food + this.fun + this.love + this.energy > 330 ? `${n} is having a wonderful time ✿` : `${n} is happy and ready to paint.`);
  }

  // Batched: many changes a second (every stroke trains a skill) cost one write and one update
  // for the UI. `flush` writes now (on hide/close).
  save() {
    this.dirty = true;
    this.saveTimer ||= setTimeout(() => this.flush(), 500);
  }
  flush() {
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    if (!this.dirty) return;
    this.dirty = false;
    const keys = ['name', 'food', 'fun', 'love', 'energy', 'asleep', 'xp', 'level', 'born', 't', 'lives', 'rings', 'medals', 'wins', 'races', 'chaos',
      'stage', 'active', 'skills', 'recent', 'type', 'personality', 'fav', 'happiness', 'align', 'emo', 'learned', 'sick', 'school', 'eatenRecently', 'bloom'];
    local.set(KEY, Object.fromEntries(keys.map(k => [k, this[k]])));
    bus.emit('pyxl:stats', this);
  }
}
