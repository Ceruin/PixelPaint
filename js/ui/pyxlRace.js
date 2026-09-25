import { h, icon } from './dom.js';
import { drawPose, tinted, SPRITES } from './mascot.js';
import { drawIcon } from './pixelIcons.js';
import { LUCKY_NAMES } from './pyxlStats.js';

// Pyxl races (after the Chao Races): four racers over a course of Line (running), Colour
// (swimming a paint river), Shape (flying over a gap) and Power (climbing a wall) sections —
// each section runs on the matching skill. Stamina drains as they go; tap or press Space to
// cheer (a burst of speed that costs stamina). Luck keeps them from tripping.
export const RACES = [
  ['beginner', 'Beginner', [0, 90], 15],
  ['jewel', 'Jewel', [260, 900], 40],
  ['challenge', 'Challenge', [900, 1900], 90],
];
const COURSE = [['line', 260], ['colour', 150], ['line', 120], ['shape', 110], ['line', 140], ['power', 110], ['line', 170]];
const LENGTH = COURSE.reduce((a, [, l]) => a + l, 0);
const RIVAL_COLOURS = ['#ff5a7a', '#ffb02e', '#8b5cff', '#2fb36b', '#3b7bff', '#ff7a3b'];
const W = 320, H = 200, TRACK = 72, LANE_H = 32, LANES = [0, 1, 2, 3].map(i => TRACK + (i + 1) * LANE_H - 5);   // feet lines, back to front
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
  const cheer = h('button.btn.primary', { type: 'button' }, icon('sparkle'), 'Cheer!');
  const close = h('button.ibtn.sm', { type: 'button', 'aria-label': 'Close' }, icon('x'));
  const card = h('div.race-card', {}, h('div.race-head', {}, icon('film'), h('strong', {}, `${title} Race`), h('span.spacer'), close), cv, h('div.race-foot', {}, cheer, h('small.muted', {}, 'Tap, click or press Space to cheer — it costs stamina!')));
  const layer = h('div.race-layer', {}, card);
  document.body.append(layer);
  const fitScale = () => { const k = Math.max(1, Math.floor(Math.min(Math.min(innerWidth * 0.92, 960) / W, innerHeight * 0.66 / H))); cv.style.width = `${W * k}px`; cv.style.height = `${H * k}px`; };
  fitScale(); addEventListener('resize', fitScale);

  let t0 = performance.now(), last = t0, raf = 0, finished = [], over = false, results = 0;
  document.fonts?.load("8px 'Pixelify Sans'");
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
    if (!results && (finished.length === racers.length || (me.done && finished.length >= 3))) { results = now; }
    if (results && now - results > 2200) return end(false);
    raf = requestAnimationFrame(step);
  };

  // ---- the scene, in pixel art at 320×200 (shown at an integer scale) ----
  const SEC = { colour: 'drop', shape: 'star', power: 'bang' };
  const clouds = [[20, 14, 3], [110, 26, 2], [190, 10, 3], [270, 30, 2], [350, 18, 3]];
  const rect = (x, y, w, hh, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, hh); };
  const cloud = (x, y, k) => { rect(x + k, y, 6 * k, k, '#fff'); rect(x, y + k, 8 * k, 2 * k, '#fff'); rect(x + k, y + 3 * k, 6 * k, k, '#e3f1ff'); };
  const text = (str, x, y, col = '#221822', size = 8, align = 'left', outline = null) => {
    ctx.font = `${size}px 'Pixelify Sans', monospace`; ctx.textAlign = align; ctx.textBaseline = 'top';
    if (outline) { ctx.fillStyle = outline; for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(str, x + ox, y + oy); }
    ctx.fillStyle = col; ctx.fillText(str, x, y);
  };
  const checker = (x, y0, y1, cols = 2) => { for (let y = y0; y < y1; y += 3) for (let c = 0; c < cols; c++) rect(x + c * 3, y, 3, 3, ((y / 3 + c) | 0) % 2 ? '#221822' : '#ffffff'); };
  const ordinal = n => `${n}${['st', 'nd', 'rd'][n - 1] ?? 'th'}`;
  const standing = () => [...racers].sort((p, q) => (p.done && q.done ? p.done - q.done : p.done ? -1 : q.done ? 1 : q.d - p.d));

  const draw = (now, running) => {
    const lead = Math.max(...racers.map(r => r.d)), cam = Math.max(0, Math.min(LENGTH - 250, Math.max(me.d, lead - 140) - 70)), T = now / 1000;
    ctx.imageSmoothingEnabled = false;
    // sky, clouds, hills (parallax)
    ['#8ccdff', '#9fd6ff', '#b2dfff', '#c6e8ff'].forEach((c, i) => rect(0, i * 14, W, 14, c));
    rect(0, 56, W, 16, '#d6efff');
    for (const [cx, cy, k] of clouds) cloud(((cx - cam * 0.15 + T * 3) % (W + 60) + W + 60) % (W + 60) - 40, cy, k);
    for (let x = 0; x < W; x += 2) {
      const X = x + cam * 0.4, hgt = 9 + Math.round(5 * Math.sin(X / 26) + 3 * Math.sin(X / 9));
      rect(x, TRACK - hgt, 2, hgt, '#79c27c'); rect(x, TRACK - hgt, 2, 1, '#9bd89a');
    }
    rect(0, TRACK - 3, W, 3, '#5aa65f');
    // track lanes
    for (let i = 0; i < 4; i++) {
      const y = TRACK + i * LANE_H;
      rect(0, y, W, LANE_H, i % 2 ? '#e8d1a4' : '#efdcb4');
      rect(0, y + LANE_H - 1, W, 1, '#cdb286');
      for (let x = -((cam | 0) % 16); x < W; x += 16) rect(x + (i % 2) * 8, y + 12, 1, 1, '#d9bf92');
    }
    // sections
    let a = 0;
    for (const [t, l] of COURSE) {
      const x0 = Math.round(a - cam) + 40, x1 = Math.round(a + l - cam) + 40;
      a += l;
      if (x1 < -20 || x0 > W + 20 || t === 'line') continue;
      if (t === 'colour') {                                                 // paint river
        for (let i = 0; i < 4; i++) rect(x0, TRACK + i * LANE_H, x1 - x0, LANE_H, i % 2 ? '#45a2ea' : '#4fb0f7');
        for (let i = 0; i < 4; i++) for (let x = x0 + 4; x < x1 - 6; x += 14) rect(x + ((T * 12 + i * 5) % 8), TRACK + i * LANE_H + 8 + (i % 2) * 6, 5, 1, '#bfe6ff');
        rect(x0, TRACK, 2, H - TRACK, '#2f7fc0'); rect(x1 - 2, TRACK, 2, H - TRACK, '#2f7fc0');
        for (let y = TRACK; y < H; y += 5) { rect(x0 + 2, y, 1, 2, '#e8f7ff'); rect(x1 - 3, y + 2, 1, 2, '#e8f7ff'); }
      }
      if (t === 'shape') {                                                  // a gap in the world: fly across on clouds
        ['#c6e8ff', '#b8e2ff', '#aadcff', '#9dd5ff'].forEach((c, i) => rect(x0, TRACK - 3 + i * 33, x1 - x0, 34, c));
        for (let y = TRACK; y < H; y += 6) { rect(x0 - 4, y, 4, 6, (y / 6) % 2 ? '#9a6b45' : '#86593a'); rect(x1, y + 3, 4, 6, (y / 6) % 2 ? '#86593a' : '#9a6b45'); }
        rect(x0 - 4, TRACK - 3, 4, 3, '#5aa65f'); rect(x1, TRACK - 3, 4, 3, '#5aa65f');
        for (let i = 0; i < 4; i++) for (let x = x0 + 4 + (i % 2) * 12; x < x1 - 20; x += 34) cloud(x, LANES[i] - 4, 2);
      }
      if (t === 'power') {                                                  // climbing wall
        rect(x0, TRACK - 12, x1 - x0, H - TRACK + 12, '#b7825a');
        for (let y = TRACK - 12, row = 0; y < H; y += 5, row++) { rect(x0, y, x1 - x0, 1, '#8f6445'); for (let x = x0 + (row % 2) * 5; x < x1; x += 10) rect(x, y, 1, 5, '#8f6445'); }
        rect(x0, TRACK - 13, x1 - x0, 1, '#d6a47a');
      }
      // signpost at the section's start
      rect(x0 + 2, TRACK - 16, 1, 14, '#6b4a31'); rect(x0 - 4, TRACK - 26, 13, 11, '#6b4a31'); rect(x0 - 3, TRACK - 25, 11, 9, '#f6efe4');
      drawIcon(ctx, SEC[t], x0 - 1, TRACK - 24, 1);
    }
    // start and finish
    const sx = Math.round(40 - cam), fx = Math.round(LENGTH - cam) + 40;
    if (sx > -8) checker(sx, TRACK, H, 1);
    if (fx < W + 10) {
      checker(fx, TRACK, H, 2);
      rect(fx - 1, TRACK - 30, 2, 30, '#6b4a31'); rect(fx + 6, TRACK - 30, 2, 30, '#6b4a31');
      rect(fx - 14, TRACK - 34, 35, 10, '#ff3b47'); text('GOAL', fx + 3, TRACK - 34, '#fff', 8, 'center');
    }
    // racers, back lane first
    for (const r of racers) {
      const seg = segAt(r.d), x = Math.round(r.d - cam) + 40, base = LANES[r.lane], moving = running && !r.done && r.trip <= 0;
      let pose = !running ? 'front' : r.done ? 'cheer' : r.trip > 0 ? 'floor' : seg === 'shape' ? 'cheer' : seg === 'power' ? 'raise' : ['idle0', 'idle1', 'walk', 'idle1'][Math.floor(now / 110) % 4];
      if (r.st <= 0 && moving && seg === 'line') pose = 'drowsy';
      const lift = seg === 'shape' && moving ? 7 + Math.round(Math.sin(T * 6 + r.lane)) : seg === 'power' && moving ? 10 : 0, y = base - lift;
      if (seg !== 'shape') { rect(x - 7, base - 1, 14, 2, 'rgba(0,0,0,.18)'); rect(x - 5, base, 10, 1, 'rgba(0,0,0,.12)'); }
      ctx.save();
      if (seg === 'colour' && moving) { ctx.beginPath(); ctx.rect(0, 0, W, base - 16); ctx.clip(); }   // swimming: only her top shows
      drawPose(ctx, pose, x, y, 1, false, 0, tinted(r.colour ?? '#2fb3a4'));
      ctx.restore();
      if (seg === 'colour' && moving) { rect(x - 9, base - 16, 18, 1, '#e8f7ff'); if (Math.floor(T * 8) % 2) { rect(x - 12, base - 19, 1, 1, '#e8f7ff'); rect(x + 11, base - 20, 1, 1, '#e8f7ff'); } }
      if (seg === 'line' && moving && Math.floor(T * 10 + r.lane) % 3 === 0) { rect(x - 12, base - 3, 2, 2, '#d9bf92'); rect(x - 16, base - 5, 1, 1, '#d9bf92'); }
      if (r.boost > 0) { drawIcon(ctx, 'sparkle', x + 12, y - 34, 1); drawIcon(ctx, 'sparkle', x - 18, y - 22, 1); }
      // name tag
      const top = y - SPRITES[pose][5] - 9, label = r.me ? `★ ${r.name}` : r.name;
      ctx.font = "8px 'Pixelify Sans', monospace";
      const tw = Math.ceil(ctx.measureText(label).width) + 6;
      rect(x - tw / 2, top, tw, 9, r.me ? '#221822' : 'rgba(34,24,34,.55)');
      rect(x - tw / 2, top + 9, tw, 1, r.colour ?? '#2fb3a4');
      text(label, x, top + 1, r.me ? '#ffd23f' : '#ffffff', 8, 'center');
    }
    // HUD: course map with everyone on it, stamina, place
    const mx0 = 96, mx1 = 300;
    rect(mx0 - 2, 3, mx1 - mx0 + 4, 7, 'rgba(34,24,34,.55)');
    a = 0;
    for (const [t, l] of COURSE) { rect(mx0 + (a / LENGTH) * (mx1 - mx0), 6, Math.ceil((l / LENGTH) * (mx1 - mx0)), 2, { line: '#efdcb4', colour: '#4fb0f7', shape: '#ffffff', power: '#b7825a' }[t]); a += l; }
    for (const r of racers) rect(mx0 + (r.d / LENGTH) * (mx1 - mx0) - 1, r.me ? 3 : 4, r.me ? 3 : 2, r.me ? 7 : 5, r.me ? '#ffd23f' : r.colour);
    rect(4, 3, 84, 11, 'rgba(34,24,34,.55)');
    drawIcon(ctx, 'onigiri', 6, 4, 1);
    rect(16, 6, 50, 4, '#3a2f3a'); rect(16, 6, Math.round(50 * me.st / me.max), 4, me.st < me.max * 0.25 ? '#ff5a5a' : '#ff9f2b');
    text(ordinal(standing().indexOf(me) + 1), 84, 3, '#ffffff', 8, 'right');
    if (!running) {
      const n = 3 - Math.floor((now - t0) / 1000);
      rect(W / 2 - 26, 24, 52, 34, 'rgba(34,24,34,.7)');
      text(n > 0 ? String(n) : 'GO!', W / 2, 28, n > 0 ? '#ffffff' : '#ffd23f', 24, 'center', '#221822');
    }
    if (results) {
      rect(W / 2 - 70, 30, 140, 20 + racers.length * 12, 'rgba(34,24,34,.85)');
      text('RESULTS', W / 2, 34, '#ffd23f', 8, 'center');
      standing().forEach((r, i) => text(`${ordinal(i + 1)}  ${r.name}`, W / 2 - 58, 46 + i * 12, r.me ? '#ffd23f' : '#ffffff'));
    }
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
