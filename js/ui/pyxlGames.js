import { h, icon } from './dom.js';
import { iconCanvas } from './pixelIcons.js';
import { sfx } from './pyxlAudio.js';

// Pyxl's mini-games. They play right on the canvas area (Draw's stage, or the Notes board): an
// overlay covers it, so painting is locked until the game ends.
export const GAMES = [
  ['stars', 'Catch the Stars', 'star', 'She draws stars — tap them before they fade.'],
  ['trace', 'Trace It', 'pencilPx', 'She draws a shape; trace over it.'],
  ['colour', 'Colour Memory', 'drop', 'Remember her colour, then find it.'],
  ['doodle', 'Draw This!', 'sparkle', 'She names a thing; you have 30 s.'],
];

// The canvas area on screen (the whole window if there's none).
export function stageBox() {
  const el = [...document.querySelectorAll('#stage, .board')].find(e => e.offsetParent && e.getBoundingClientRect().width > 120);
  const r = el?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: innerWidth, height: innerHeight };
}

// The overlay a game plays in: a bar (title, status, close) and a full-size drawing canvas.
function arena(title, onQuit) {
  const b = stageBox(), dpr = devicePixelRatio || 1;
  const status = h('span.ga-status'), cv = h('canvas.ga-canvas', { width: Math.round(b.width * dpr), height: Math.round(b.height * dpr) });
  const quit = h('button.ibtn.sm', { type: 'button', 'aria-label': 'Quit game', 'data-tip': 'Quit (Esc)', onclick: () => onQuit() }, icon('x'));
  const bar = h('div.ga-bar', {}, h('b', {}, title), status, quit);
  const el = h('div.game-arena', { style: { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` } }, cv, bar);
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); onQuit(); } };
  addEventListener('keydown', key, true);
  document.body.append(el);
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  return { el, cv, ctx, w: b.width, h: b.height, box: b, bar, status: t => { status.textContent = t; }, done: () => { removeEventListener('keydown', key, true); el.remove(); } };
}

// Where her brush is on screen (games draw from there).
const brushAt = pyxl => { const r = pyxl.el.getBoundingClientRect(); return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.25 }; };
// She turns toward what she's about to draw, and paints.
const aimAt = (pyxl, x, y) => { pyxl.cursor = { x, y, t: Date.now() }; pyxl.react('paint', { dur: 700, force: true }); };

// A sparkly line from her brush to (x, y), drawn over `ms` — how she "draws" things into a game.
function sparkLine(a, from, to, ms, colour = '#ffd23f') {
  const t0 = performance.now(), fx = from.x - a.box.left, fy = from.y - a.box.top, mx = (fx + to.x) / 2, my = Math.min(fy, to.y) - 60;
  return new Promise(res => {
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      a.fx.push({ k, fx, fy, mx, my, tx: to.x, ty: to.y, colour, life: 1 });
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}
// Fading sparkle trails, repainted with the rest of a game's frame.
function drawFx(a) {
  const c = a.ctx;
  a.fx = a.fx.filter(f => (f.life -= 0.06) > 0);
  for (const f of a.fx) {
    const q = t => [(1 - t) ** 2 * f.fx + 2 * (1 - t) * t * f.mx + t * t * f.tx, (1 - t) ** 2 * f.fy + 2 * (1 - t) * t * f.my + t * t * f.ty];
    c.globalAlpha = f.life * 0.8; c.fillStyle = f.colour;
    for (let i = 0; i <= 12; i++) { const [x, y] = q(f.k * i / 12); c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3); }
  }
  c.globalAlpha = 1;
}

// ---- Catch the Stars: she draws each star; catch it before it fades ----
function stars(pyxl) {
  const N = 8;
  let caught = 0, shown = 0, over = false;
  const a = arena('Catch the Stars', () => end(true));
  a.fx = [];
  const loop = () => { if (over) return; a.ctx.clearRect(0, 0, a.w, a.h); drawFx(a); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  a.status(`0 / ${N}`);
  const spawn = async () => {
    if (over) return;
    if (shown >= N) return setTimeout(() => end(false), 500);
    shown++;
    const x = 30 + Math.random() * (a.w - 60), y = 56 + Math.random() * (a.h - 100);
    aimAt(pyxl, a.box.left + x, a.box.top + y); sfx('draw');
    await sparkLine(a, brushAt(pyxl), { x, y }, 260);
    if (over) return;
    const star = h('button.sg-star', { type: 'button', style: { left: `${x - 20}px`, top: `${y - 20}px` } }, iconCanvas('star', 4));
    const gone = setTimeout(() => { star.remove(); spawn(); }, 1300);
    star.addEventListener('pointerdown', e => {
      e.stopPropagation(); clearTimeout(gone);
      a.status(`${++caught} / ${N}`); sfx('pop');
      star.classList.add('pop'); pyxl.burst('sparkle', 2);
      setTimeout(() => { star.remove(); spawn(); }, 180);
    });
    a.el.append(star);
  };
  const end = quit => { if (over) return; over = true; a.done(); if (!quit) { if (caught >= 6) sfx('win'); pyxl.gameOver(caught, N, 'luck'); } };
  setTimeout(spawn, 400);
}

// ---- Trace It: she draws a dotted shape; trace it in time ----
const SHAPES = {
  circle: t => [Math.cos(t * 2 * Math.PI), Math.sin(t * 2 * Math.PI)],
  heart: t => { const u = t * 2 * Math.PI; return [16 * Math.sin(u) ** 3 / 17, -(13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u)) / 17]; },
  star: t => { const i = t * 10, j = Math.floor(i) % 10, f = i - Math.floor(i), p = k => { const r = k % 2 ? 0.42 : 1, a = -Math.PI / 2 + k * Math.PI / 5; return [Math.cos(a) * r, Math.sin(a) * r]; }, [x0, y0] = p(j), [x1, y1] = p(j + 1); return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]; },
  zigzag: t => [t * 2 - 1, (Math.abs(((t * 4) % 1) - 0.5) * 4 - 1) * 0.6],
  spiral: t => { const u = t * 4 * Math.PI; return [Math.cos(u) * t, Math.sin(u) * t]; },
  wave: t => [t * 2 - 1, Math.sin(t * 3 * 2 * Math.PI) * 0.45],
};
function trace(pyxl) {
  const names = Object.keys(SHAPES), name = names[Math.floor(Math.random() * names.length)];
  const a = arena('Trace It', () => end(true)), R = Math.min(a.w, a.h) * 0.32, cx = a.w / 2, cy = a.h / 2 + 12;
  const pts = Array.from({ length: 120 }, (_, i) => { const [x, y] = SHAPES[name](i / 119); return [cx + x * R, cy + y * R]; });
  const ink = [], tol = Math.max(12, R * 0.08);
  let shown = 0, over = false, drawing = false, left = 12;
  a.fx = [];
  const paint = () => {
    const c = a.ctx;
    c.clearRect(0, 0, a.w, a.h);
    c.fillStyle = '#9aa1b1';
    for (let i = 0; i < shown; i += 2) c.fillRect(Math.round(pts[i][0]) - 2, Math.round(pts[i][1]) - 2, 4, 4);
    c.strokeStyle = '#3b7bff'; c.lineWidth = 5; c.lineCap = c.lineJoin = 'round';
    for (const s of ink) { c.beginPath(); s.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); }
    drawFx(a);
  };
  const loop = () => { if (over) return; paint(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  a.status(`She’s drawing a ${name}…`);
  const b0 = brushAt(pyxl);
  aimAt(pyxl, a.box.left + cx, a.box.top + cy); sfx('draw');
  const t0 = performance.now();
  const reveal = now => {   // she draws it point by point, a sparkle following her brush
    shown = Math.min(pts.length, Math.round((now - t0) / 1400 * pts.length));
    if (shown % 12 === 0 && shown) a.fx.push({ k: 1, fx: b0.x - a.box.left, fy: b0.y - a.box.top, mx: cx, my: cy - R - 40, tx: pts[shown - 1][0], ty: pts[shown - 1][1], colour: '#ffd23f', life: 0.6 });
    if (shown < pts.length) return requestAnimationFrame(reveal);
    a.status(`Trace it! ${left}s`);
    const timer = setInterval(() => { if (over) return clearInterval(timer); a.status(`Trace it! ${--left}s`); if (left <= 0) { clearInterval(timer); end(false); } }, 1000);
    a.cv.addEventListener('pointerdown', e => { if (over) return; drawing = true; a.cv.setPointerCapture(e.pointerId); ink.push([[e.offsetX, e.offsetY]]); });
    a.cv.addEventListener('pointermove', e => { if (drawing) ink.at(-1).push([e.offsetX, e.offsetY]); });
    a.cv.addEventListener('pointerup', () => { drawing = false; if (coverage() > 0.9) end(false); });
  };
  requestAnimationFrame(reveal);
  const near = (x, y, list, d) => list.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < d * d);
  const all = () => ink.flat();
  const coverage = () => pts.filter(([x, y]) => near(x, y, all(), tol)).length / pts.length;
  const end = quit => {
    if (over) return; over = true; a.done();
    if (quit) return;
    const u = all(), precision = u.length ? u.filter(([x, y]) => near(x, y, pts, tol * 2)).length / u.length : 0, score = coverage() * (0.5 + 0.5 * precision);
    pyxl.gameOver(Math.round(score * 8), 8, 'line', `${Math.round(score * 100)}% traced`);
  };
}

// ---- Colour Memory: she shows a colour; pick it out of six look-alikes ----
function colour(pyxl) {
  const ROUNDS = 6, hsl = (hh, s, l) => `hsl(${(hh + 360) % 360} ${s}% ${l}%)`;
  let round = 0, score = 0, over = false;
  const a = arena('Colour Memory', () => end(true)), stage = h('div.ga-colour');
  a.el.append(stage);
  const next = () => {
    if (over) return;
    if (round >= ROUNDS) return end(false);
    round++;
    const hh = Math.random() * 360, s = 45 + Math.random() * 40, l = 38 + Math.random() * 28, spread = 44 - round * 5;
    const target = hsl(hh, s, l);
    a.status(`Round ${round} / ${ROUNDS} — remember it!`);
    aimAt(pyxl, a.box.left + a.w / 2, a.box.top + a.h / 2); sfx('draw');
    stage.replaceChildren(h('div.ga-target', { style: { background: target } }));
    setTimeout(() => {
      if (over) return;
      a.status(`Round ${round} / ${ROUNDS} — which was it?`);
      const opts = [target, ...Array.from({ length: 5 }, (_, i) => hsl(hh + (i % 2 ? 1 : -1) * spread * (0.4 + Math.random() * 0.6), s + (Math.random() - 0.5) * spread * 0.6, l + (i % 3 - 1) * spread * 0.3))].sort(() => Math.random() - 0.5);
      stage.replaceChildren(h('div.ga-swatches', {}, opts.map(c => h('button.ga-swatch', { type: 'button', style: { background: c }, dataset: { t: c === target ? '1' : '' }, onclick: e => {
        const ok = c === target;
        if (ok) { score++; sfx('pop'); pyxl.burst('sparkle', 2); } else sfx('bonk');
        e.currentTarget.classList.add(ok ? 'right' : 'wrong');
        stage.querySelector('.ga-swatch[data-t="1"]').classList.add('right');
        stage.querySelectorAll('.ga-swatch').forEach(b => { b.disabled = true; });
        setTimeout(next, 700);
      } }))));
    }, 1500);
  };
  const end = quit => { if (over) return; over = true; a.done(); if (!quit) pyxl.gameOver(score, ROUNDS, 'colour'); };
  setTimeout(next, 300);
}

// ---- Draw This!: she names something; you have 30 seconds (keep the drawing if you like it) ----
const PROMPTS = ['a cat', 'the sun', 'a house', 'a flower', 'a fish', 'a rocket', 'a cake', 'a tree', 'a robot', 'your pet', 'a cloud', 'a ghost', 'a snail', 'a star', 'Pyxl!'];
function doodle(pyxl) {
  const what = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const a = arena(`Draw ${what}!`, () => (over ? a.done() : end(true))), ink = [];
  let left = 30, drawing = false, over = false;
  const done = h('button.btn.sm.primary', { type: 'button' }, 'Done');
  done.onclick = () => end(false);
  a.bar.insertBefore(done, a.bar.lastChild);
  a.ctx.fillStyle = '#fff'; a.ctx.fillRect(0, 0, a.w, a.h);
  a.ctx.strokeStyle = '#1b1d23'; a.ctx.lineWidth = 4; a.ctx.lineCap = a.ctx.lineJoin = 'round';
  a.status(`${left}s`);
  pyxl.react('think', { say: `Draw ${what}!`, force: true });
  const timer = setInterval(() => { a.status(`${--left}s`); if (left <= 0) end(false); }, 1000);
  a.cv.addEventListener('pointerdown', e => { drawing = true; a.cv.setPointerCapture(e.pointerId); ink.push(1); a.ctx.beginPath(); a.ctx.moveTo(e.offsetX, e.offsetY); a.ctx.lineTo(e.offsetX + 0.1, e.offsetY); a.ctx.stroke(); });
  a.cv.addEventListener('pointermove', e => { if (!drawing) return; for (const ev of e.getCoalescedEvents?.() ?? [e]) a.ctx.lineTo(ev.offsetX, ev.offsetY); a.ctx.stroke(); a.ctx.beginPath(); a.ctx.moveTo(e.offsetX, e.offsetY); });
  a.cv.addEventListener('pointerup', () => { drawing = false; });
  const end = quit => {
    if (over) return; over = true; clearInterval(timer); drawing = false;
    if (quit) return a.done();
    const strokes = ink.length, score = strokes ? Math.min(8, 3 + Math.round(strokes / 3)) : 0;
    pyxl.gameOver(score, 8, 'colour', strokes ? `${what[0].toUpperCase()}${what.slice(1)}! I love it!` : 'Is that… invisible art?');
    if (!strokes || !pyxl.keepDrawing) return a.done();
    a.status('Keep it?');   // the drawing stays up until you keep it or close
    done.textContent = 'Keep as a layer';
    done.onclick = () => { pyxl.keepDrawing(a.cv, `Pyxl: ${what}`); a.done(); };
  };
}

export function startGame(pyxl, id) { ({ stars, trace, colour, doodle })[id]?.(pyxl); }
