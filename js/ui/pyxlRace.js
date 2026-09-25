import { h, icon } from './dom.js';
import { drawPose, tinted, SPRITES } from './mascot.js';
import { drawIcon } from './pixelIcons.js';
import { LUCKY_NAMES } from './pyxlStats.js';

// Pyxl races (after the Chao Races): four racers over a course of Line (running), Colour
// (swimming a paint river), Shape (flying over a gap) and Power (climbing a wall) sections —
// each section runs on the matching skill. Stamina drains as they go; tap or press Space to
// cheer (a burst of speed that costs stamina). Luck keeps them from tripping.
export const RACES = [
  ['beginner', 'Beginner', [0, 140], 15],
  ['jewel', 'Jewel', [260, 900], 40],
  ['challenge', 'Challenge', [900, 1900], 90],
];
const COURSE = [['line', 260], ['colour', 150], ['line', 120], ['shape', 110], ['line', 140], ['power', 110], ['line', 170]];
const LENGTH = COURSE.reduce((a, [, l]) => a + l, 0);
const RIVAL_COLOURS = ['#ff5a7a', '#ffb02e', '#8b5cff', '#2fb36b', '#3b7bff', '#ff7a3b'];
const W = 320, H = 200, LANES = [96, 128, 160, 192];   // feet lines, back to front
const segAt = d => { let a = 0; for (const [t, l] of COURSE) { if (d < a + l) return t; a += l; } return 'line'; };
const MEDALS = ['Gold', 'Silver', 'Bronze'];

export const raceUnlocked = (stats, i) => i === 0 || (stats.medals?.[RACES[i - 1][0]] ?? 9) === 0;

export function startRace(pyxl, level = 0) {
  const s = pyxl.stats, [id, title, [lo, hi], prize] = RACES[level];
  const skill = k => s.skills[k]?.pts ?? 0;
  const me = { name: s.name, me: true, colour: null, sk: { line: skill('line'), colour: skill('colour'), shape: skill('shape'), power: skill('power') }, stamina: 80 + skill('stamina') / 10, luck: skill('luck') };
  const names = LUCKY_NAMES.filter(n => n !== s.name).sort(() => Math.random() - 0.5);
  const rivals = [0, 1, 2].map(i => {
    const r = () => lo + Math.random() * (hi - lo);
    return { name: names[i], colour: RIVAL_COLOURS[(level * 2 + i) % RIVAL_COLOURS.length], sk: { line: r(), colour: r(), shape: r(), power: r() }, stamina: 80 + r() / 10, luck: r() };
  });
  const racers = [rivals[0], me, rivals[1], rivals[2]].map((r, i) => Object.assign(r, { lane: i, d: 0, st: r.stamina, max: r.stamina, boost: 0, trip: 0, done: 0 }));

  const cv = h('canvas.race-canvas', { width: W, height: H }), ctx = cv.getContext('2d');
  const hud = h('div.race-hud'), cheer = h('button.btn.primary', { type: 'button' }, icon('sparkle'), 'Cheer!');
  const close = h('button.ibtn.sm', { type: 'button', 'aria-label': 'Close' }, icon('x'));
  const card = h('div.race-card', {}, h('div.race-head', {}, icon('film'), h('strong', {}, `${title} Race`), h('span.spacer'), close), cv, hud, h('div.race-foot', {}, cheer, h('small.muted', {}, 'Tap, click or press Space to cheer — it costs stamina!')));
  const layer = h('div.race-layer', {}, card);
  document.body.append(layer);
  const fitScale = () => { const k = Math.max(1, Math.floor(Math.min(Math.min(innerWidth * 0.92, 960) / W, innerHeight * 0.66 / H))); cv.style.width = `${W * k}px`; cv.style.height = `${H * k}px`; };
  fitScale(); addEventListener('resize', fitScale);

  let t0 = performance.now(), last = t0, raf = 0, finished = [], over = false;
  const boost = () => { if (me.st > 6 && !me.done && performance.now() - t0 > 3000) { me.boost = 0.6; me.st -= 7; } };
  cheer.onclick = boost;
  cv.addEventListener('pointerdown', boost);
  const key = e => { if (e.code === 'Space') { e.preventDefault(); boost(); } if (e.key === 'Escape') end(true); };
  addEventListener('keydown', key, true);
  close.onclick = () => end(true);

  const speed = (r, seg) => {
    let v = 44 + r.sk[seg] / 40;                     // units / s, from the section's skill (~20 s races)
    if (r.st <= 0) v *= 0.45;                        // out of stamina: plodding
    if (r.boost > 0) v *= 1.45;
    return r.trip > 0 ? 0 : v;
  };
  const step = now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const running = now - t0 > 3000;
    for (const r of racers) {
      if (!running || r.done) continue;
      const seg = segAt(r.d);
      r.d = Math.min(LENGTH, r.d + speed(r, seg) * dt);
      r.st = Math.max(0, r.st - dt * (seg === 'line' ? 1.6 : 2.8));
      if (r.st === 0) r.st = Math.min(r.max * 0.3, r.st + dt * 1.5);
      r.boost -= dt; r.trip -= dt;
      if (Math.random() < dt * 0.05 * (1 - Math.min(0.85, r.luck / 2000))) r.trip = 0.9;
      if (!r.me && r.st > r.max * 0.4 && Math.random() < dt * 0.6) { r.boost = 0.6; r.st -= 7; }   // rivals cheer themselves on
      if (r.d >= LENGTH) { r.done = now; finished.push(r); }
    }
    draw(now, running);
    if (finished.length === racers.length || (me.done && finished.length >= 3)) return end(false);
    raf = requestAnimationFrame(step);
  };

  const draw = (now, running) => {
    const lead = Math.max(...racers.map(r => r.d)), cam = Math.max(0, Math.min(LENGTH - 260, Math.max(me.d, lead - 120) - 80));
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#bfe3ff'; ctx.fillRect(0, 0, W, 64);
    // the course, drawn section by section
    let a = 0;
    for (const [t, l] of COURSE) {
      const x0 = Math.round(a - cam), x1 = Math.round(a + l - cam);
      a += l;
      if (x1 < 0 || x0 > W) continue;
      ctx.fillStyle = { line: '#f2e3c6', colour: '#5fb8ff', shape: '#bfe3ff', power: '#b9926a' }[t];
      ctx.fillRect(x0, 64, x1 - x0, H - 64);
      if (t === 'line') { ctx.fillStyle = '#e0cfa9'; LANES.forEach(y => { for (let x = x0 - (x0 % 12); x < x1; x += 12) ctx.fillRect(x, y + 2, 6, 1); }); }
      if (t === 'colour') { ctx.fillStyle = '#9fd6ff'; for (let x = x0; x < x1; x += 10) LANES.forEach((y, i) => ctx.fillRect(x + ((now / 90 + i * 3) % 10), y - 4, 4, 1)); }
      if (t === 'shape') { ctx.fillStyle = '#8fc9f5'; ctx.fillRect(x0, 64, x1 - x0, H - 64); ctx.fillStyle = '#ffffff'; for (let x = x0 + 8; x < x1; x += 40) ctx.fillRect(x, 20 + (x % 17), 14, 4); }
      if (t === 'power') { ctx.fillStyle = '#8f6c4c'; for (let y = 68; y < H; y += 8) ctx.fillRect(x0, y, x1 - x0, 1); }
    }
    const fx = Math.round(LENGTH - cam);
    if (fx < W) for (let y = 64; y < H; y += 4) { ctx.fillStyle = (y / 4) % 2 ? '#221822' : '#ffffff'; ctx.fillRect(fx, y, 3, 4); }
    // racers, back lane first
    for (const r of racers) {
      const seg = segAt(r.d), x = Math.round(r.d - cam) + 20, y = LANES[r.lane], moving = running && !r.done && r.trip <= 0;
      let pose = !running ? 'front' : r.done ? 'cheer' : r.trip > 0 ? 'floor' : seg === 'shape' ? 'cheer' : seg === 'power' ? 'raise' : ['idle0', 'idle1', 'walk', 'idle1'][Math.floor(now / 110) % 4];
      let yy = y + (seg === 'shape' && moving ? -10 : seg === 'power' && moving ? -6 : 0);
      if (r.st <= 0 && moving) pose = 'drowsy';
      ctx.save();
      if (seg === 'colour' && moving) { ctx.beginPath(); ctx.rect(0, 0, W, y - 14); ctx.clip(); }   // swimming: only her top shows
      drawPose(ctx, pose, x, yy, 1, false, 0, tinted(r.colour ?? '#2fb3a4'));
      ctx.restore();
      if (r.me) drawIcon(ctx, 'emDot', x - 2, yy - (SPRITES[pose][5] + 6), 1);
      if (r.boost > 0) drawIcon(ctx, 'sparkle', x + 14, yy - 30, 1);
    }
    if (!running) { const n = 3 - Math.floor((now - t0) / 1000); ctx.fillStyle = '#221822'; ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center'; ctx.fillText(n > 0 ? n : 'Go!', W / 2, 44); }
    hud.replaceChildren(
      h('span.race-st', {}, 'Stamina', h('i', {}, h('b', { style: { width: `${(me.st / me.max) * 100}%` } }))),
      h('span', {}, `${Math.round((me.d / LENGTH) * 100)}%`),
      h('span.muted', {}, racers.filter(r => !r.me).map(r => r.name).join(' · ')));
  };

  const end = quit => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', key, true); removeEventListener('resize', fitScale);
    layer.remove();
    if (quit) return pyxl.raceOver(-1, level);
    const place = finished.indexOf(me) >= 0 ? finished.indexOf(me) : finished.length;
    pyxl.raceOver(place, level, place < 3 ? prize * (3 - place) : 2);
  };
  raf = requestAnimationFrame(step);
}

export const medalName = i => MEDALS[i] ?? null;
