import { h, icon } from './dom.js';
import { drawPose, tinted } from './mascot.js';
import { pixelText } from './pixelFont.js';
import { LUCKY_NAMES } from './pyxlStats.js';
import { stageBox } from './pyxlGames.js';
import { generateCourse, prepareTrack, buildField, makeRacer, stepRacer, atFinish, placeAtFraction, drawTrack } from './raceCourse.js';

// Pyxl races, Line Rider style: Pyxl draws a course of lines right over your drawing (it shows
// through as the backdrop; nothing is added to your document), then four racers ride it with real
// physics — running the slopes, jumping gaps, swimming the water, climbing walls. Each move runs on
// its skill: Line = running, Colour = swimming, Shape = jumping and gliding, Power = climbing, Luck =
// not tripping. A wide canvas area races left to right; a tall one zig-zags top to bottom. Turn the
// device mid-race and the course re-lays for the new shape while gravity keeps pointing down — so
// everyone drops onto it. Tap / Space cheers (a burst of speed that costs stamina).
// Courses you build (or are sent) race the same way: `startRace(pyxl, -1, { course })`, or
// `mode: 'test'` for a solo test ride from the course builder.
export const RACES = [
  ['beginner', 'Beginner', [0, 90], 15],
  ['jewel', 'Jewel', [260, 900], 40],
  ['challenge', 'Challenge', [900, 1900], 90],
];
const CUSTOM = ['custom', 'Custom', [120, 700], 3];
const MEDALS = ['Gold', 'Silver', 'Bronze'];
export const raceUnlocked = (stats, i) => i === 0 || (stats.medals?.[RACES[i - 1][0]] ?? 9) === 0;
export const medalName = i => MEDALS[i] ?? null;

const RIVAL_COLOURS = ['#ff5a7a', '#ffb02e', '#8b5cff', '#2fb36b', '#3b7bff', '#ff7a3b'];
const DT = 1 / 120, TIME_LIMIT = 90, TEST_LIMIT = 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const POSE = { run: ['walk', 'idle1'], air: ['raise'], climb: ['raise', 'point'], swim: ['floor'], trip: ['oops'], done: ['cheer', 'happy'], wait: ['idle0', 'idle1'] };
const ordinal = i => `${i}${['th', 'st', 'nd', 'rd'][i % 10 < 4 && Math.floor(i / 10) !== 1 ? i % 10 : 0]}`;
const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor(s * 10 % 10)}`;

// Fit an overlay canvas to the canvas area: a whole number of device pixels per scene pixel, ~620
// scene px on the short side. Calls onSize(W, H) when the scene size changes. Shared with the builder.
export function arena(app, layer, cv, onSize) {
  let W = 0, H = 0;
  const a = { scale: 1 };
  const fit = () => {
    const b = stageBox(app, { page: false }), dpr = devicePixelRatio || 1;
    const dw = Math.round(b.width * dpr), dh = Math.round(b.height * dpr);
    const n = Math.max(1, Math.round(Math.min(dw, dh) / 620));
    const nw = Math.floor(dw / n), nh = Math.floor(dh / n);
    Object.assign(layer.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    Object.assign(cv, { width: nw, height: nh }); Object.assign(cv.style, { width: `${nw * n / dpr}px`, height: `${nh * n / dpr}px` });
    a.scale = n / dpr;   // CSS px per scene px
    if (nw === W && nh === H) return;
    W = nw; H = nh; onSize(W, H);
  };
  addEventListener('resize', fit);
  // the docks re-flow a moment after a rotate / resize: follow the canvas area itself as it settles
  const stageEl = document.getElementById('pxStage')?.offsetParent ? document.getElementById('pxStage') : document.getElementById('stage');
  const ro = stageEl ? new ResizeObserver(() => fit()) : null; ro?.observe(stageEl);
  a.fit = fit;
  a.stop = () => { removeEventListener('resize', fit); ro?.disconnect(); };
  fit();
  return a;
}

// ---------------------------------------------------------------- the race
export function startRace(pyxl, level = 0, { course = null, mode = 'race', onDone } = {}) {
  const test = mode === 'test', custom = !!course;
  const s = pyxl.stats, [levelId, title, [lo, hi], prize] = custom ? CUSTOM : RACES[level];
  const skill = k => s.skills[k]?.pts ?? 0;
  const me = makeRacer({ name: s.name, me: true, sk: { line: skill('line'), colour: skill('colour'), shape: skill('shape'), power: skill('power'), luck: skill('luck') }, max: 80 + skill('stamina') / 10 });
  const names = LUCKY_NAMES.filter(n => n !== s.name).sort(() => Math.random() - 0.5);
  const rivals = test ? [] : [0, 1, 2].map(i => {
    const r = () => lo + Math.random() * (hi - lo);
    return makeRacer({ name: names[i], colour: RIVAL_COLOURS[(Math.max(0, level) * 2 + i) % RIVAL_COLOURS.length], sk: { line: r(), colour: r(), shape: r(), power: r(), luck: r() }, max: 80 + r() / 10 });
  });
  const racers = test ? [me] : [rivals[0], me, rivals[1], rivals[2]];
  racers.forEach((r, i) => { r.lag = i * 0.12; });

  const cv = h('canvas.race-canvas'), ctx = cv.getContext('2d');
  const cheer = h('button.btn.primary', { type: 'button' }, icon('sparkle'), 'Cheer!');
  const close = h('button.ibtn.sm', { type: 'button', 'aria-label': test ? 'Back to the builder' : 'Close', 'data-tip': test ? 'Back to the builder' : 'Quit the race' }, icon('x'));
  const again = test && h('button.ibtn.sm', { type: 'button', 'aria-label': 'Ride again', 'data-tip': 'Ride again (R)' }, icon('undo'));
  const board = h('ol.race-board');
  const name = custom ? course.name || 'Custom course' : `${title} Race`;
  const layer = h('div.race-layer.course', {}, cv, test ? '' : board,
    h('div.race-head', {}, icon('film'), h('strong', {}, test ? `Test ride · ${name}` : name), again || '', close),
    h('div.race-foot', {}, cheer, h('small', {}, 'Tap or Space to cheer — it costs stamina')));
  document.body.append(layer);
  document.body.dataset.game = '';

  const seed = 1 + Math.floor(Math.random() * 2e9);
  let T = null, W = 0, H = 0, phase = test ? 'count' : 'draw';
  const lay = (w, hh) => {
    W = w; H = hh;
    const old = T;
    // Pyxl's courses are laid fresh for the arena's shape; a drawn course is fitted (and turned if need be)
    T = prepareTrack(custom ? course : generateCourse(W, H, levelId, seed), W, H);
    buildField(T);
    if (!old || phase === 'draw') return;
    // re-laid mid-race: everyone keeps their progress and drops onto the new course (a flip tumbles them)
    const flipped = (old.H > old.W) !== (H > W);
    for (const r of racers) {
      const q = clamp(r.best / (old.field.max || 1), 0, 1), [x, y] = placeAtFraction(T, q);
      Object.assign(r, { x, y: y - (flipped ? 44 : 4), vx: flipped ? (Math.random() - 0.5) * 80 : 0, vy: flipped ? -60 : 0, best: q * T.field.max, prog: q * T.field.max, safe: [x, y - 2], tumble: flipped ? 0.7 : 0, dead: 0, took: -1 });
    }
  };
  const area = arena(pyxl.app, layer, cv, lay);

  const DRAW_T = 2.8, COUNT_T = test ? 1.5 : 3;
  let t = 0, raf = 0, last = performance.now(), acc = 0, over = false, finished = [], resultsAt = 0, raceT = 0;
  const startLine = () => racers.forEach((r, i) => Object.assign(r, { x: T.start[0] + i * 5, y: T.start[1] - 2, vx: 0, vy: 0, best: 0, prog: 0, safe: null, done: 0, dead: 0, trip: 0, tumble: 0, took: -1, st: r.max, pose: 'wait' }));
  if (test) startLine();
  const restart = () => { finished = []; resultsAt = 0; raceT = 0; phase = 'count'; t = 0; startLine(); };
  const boostMe = () => { if (phase === 'race' && me.st > 6 && !me.done) { me.boost = 0.6; me.st -= 7; } };
  cheer.onclick = boostMe;
  if (again) again.onclick = restart;
  layer.addEventListener('pointerdown', e => { if (!e.target.closest('button')) boostMe(); });
  const key = e => {
    if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); boostMe(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(true); }
    else if (test && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); e.stopPropagation(); restart(); }
  };
  addEventListener('keydown', key, true);
  close.onclick = () => end(true);

  const standing = () => racers.slice().sort((a, b) => (a.done && b.done ? a.done - b.done : a.done ? -1 : b.done ? 1 : b.best - a.best));
  let boardAt = 0;
  const syncBoard = () => board.replaceChildren(...standing().map((r, i) => h('li', { className: r.me ? 'me' : '' }, h('i', { style: { background: r.me ? 'var(--accent)' : r.colour } }), `${ordinal(i + 1)} ${r.name}`)));

  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (phase === 'draw' && t > DRAW_T) { phase = 'count'; t = 0; startLine(); }
    else if (phase === 'count' && t > COUNT_T) { phase = 'race'; t = 0; }
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      const racing = phase === 'race';
      if (racing && !resultsAt) raceT += DT;
      if (phase === 'draw') continue;
      for (const r of racers) {
        if (r.done) continue;   // over the line: they stay there celebrating
        if (racing && !r.me && !r.done && r.st > r.max * 0.45 && Math.random() < DT * 0.5) { r.boost = 0.6; r.st -= 7; }   // rivals cheer themselves on
        stepRacer(r, T, DT, racing && raceT > r.lag);
        if (racing && !r.done && atFinish(T, r)) { finished.push(r); r.done = finished.length; r.time = raceT; r.pose = 'done'; }
      }
    }
    if (phase === 'race' && !resultsAt && (finished.length === racers.length || me.done && finished.length >= 3 || raceT > (test ? TEST_LIMIT : TIME_LIMIT))) resultsAt = now;
    if (resultsAt && !test && now - resultsAt > 2600) return end(false);
    if (!test && now - boardAt > 250) { boardAt = now; syncBoard(); }
    draw(now);
  };

  const draw = now => {
    ctx.clearRect(0, 0, W, H);
    const reveal = phase === 'draw' ? T.inkLen * Math.min(1, t / (DRAW_T - 0.3)) : Infinity, tip = drawTrack(ctx, T, { now, reveal });
    if (phase === 'draw') {   // Pyxl draws the course: she's at the pen tip
      if (tip) drawPose(ctx, 'brush', tip[0] - 14, tip[1] + 2, 1);
      return;
    }
    const frameNo = Math.floor(now / 140);
    for (const r of [...racers.filter(x => !x.me), me]) {
      if (r.dead > 0 && Math.floor(now / 90) % 2) continue;   // blinking while respawning
      const pose = r.trip > 0 ? 'trip' : r.tumble > 0 ? 'air' : r.done ? 'done' : phase === 'count' ? 'wait' : r.pose, list = POSE[pose] ?? POSE.wait;
      const nm = list[frameNo % list.length];
      drawPose(ctx, nm, r.x, r.y + (nm === 'floor' ? 4 : 0), 1, r.dir < 0, 0, r.me ? undefined : tinted(r.colour));
      if (r.me && !test) { ctx.fillStyle = '#ffd23f'; const ty = Math.round(r.y - 60); ctx.fillRect(Math.round(r.x) - 2, ty, 5, 1); ctx.fillRect(Math.round(r.x) - 1, ty + 1, 3, 1); ctx.fillRect(Math.round(r.x), ty + 2, 1, 1); }   // a little "you" marker
      if (phase === 'race' && !r.done) { const bw = 14, fill = Math.round(bw * clamp(r.st / r.max, 0, 1)); ctx.fillStyle = 'rgba(34,24,34,.7)'; ctx.fillRect(Math.round(r.x) - 7, Math.round(r.y) + 3, bw, 2); ctx.fillStyle = r.st < r.max * 0.25 ? '#e0485a' : '#2fb36b'; ctx.fillRect(Math.round(r.x) - 7, Math.round(r.y) + 3, fill, 2); }
    }
    const big = (str, y) => pixelText(ctx, str, W / 2, y, '#ffd23f', { size: 16, align: 'center', outline: '#221822' });
    if (phase === 'count') { const c = Math.ceil(COUNT_T - t); big(c > 0 ? String(c) : 'GO!', H * 0.3); }
    else if (phase === 'race' && t < 0.8) big('GO!', H * 0.3);
    if (test && phase === 'race') {
      pixelText(ctx, clock(raceT), 10, 10, '#ffffff', { outline: '#221822' });
      if (resultsAt) {
        big(me.done ? 'FINISH!' : 'OUT OF TIME', H * 0.22);
        pixelText(ctx, me.done ? `${clock(me.time)}  -  R to ride again` : 'Can she reach the flag? R to retry', W / 2, H * 0.22 + 36, '#ffffff', { align: 'center', outline: '#221822' });
      }
    } else if (resultsAt) {
      const rows = standing(), bw = 150, bh = 22 + rows.length * 12, bx = Math.round(W / 2 - bw / 2), by = Math.round(H * 0.18);
      ctx.fillStyle = 'rgba(34,24,34,.88)'; ctx.fillRect(bx, by, bw, bh);
      pixelText(ctx, 'RESULTS', W / 2, by + 5, '#ffd23f', { align: 'center' });
      rows.forEach((r, i) => pixelText(ctx, `${ordinal(i + 1)}  ${r.name}${r.done ? '' : ' DNF'}`, bx + 10, by + 18 + i * 12, r.me ? '#ffd23f' : '#ffffff'));
    }
  };

  const end = quit => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', key, true); area.stop();
    layer.remove(); delete document.body.dataset.game;   // nothing was added to the drawing: it's just as it was
    if (test) return onDone?.({ finished: !!me.done, time: me.time });
    const place = quit ? -1 : me.done ? me.done - 1 : finished.length;
    if (custom) pyxl.raceOver(place, -1, place < 0 ? 0 : place < 3 ? prize * (3 - place) : 1);
    else pyxl.raceOver(place, level, place < 3 ? prize * (3 - place) : 2);
    onDone?.({ place });
  };
  syncBoard();
  raf = requestAnimationFrame(frame);
  return { end };
}
