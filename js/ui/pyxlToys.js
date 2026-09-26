import { h } from './dom.js';
import { artCanvas } from './pixelArt.js';
import { devPx } from './pixelIcons.js';
import { stepBody, flick } from './pyxlWorld.js';
import { sfx } from './pyxlAudio.js';
import { stageBox } from './pyxlGames.js';

// Toys that leave her box and play out on the page: a ball she throws (flick it back to her!),
// bubbles to pop, crayon doodles she draws on the canvas area (tap one to keep it), and notes that
// float up while the radio plays.
const still = () => document.body.dataset.theme === 'paper';   // e-ink: no flying things
const active = new Set();
export const toyBusy = id => active.has(id);

// A pixel-art sprite on the page, at a whole number of device pixels per art pixel.
function sprite(name, css = 2, cls = '') {
  const p = devPx(css), dpr = devicePixelRatio || 1, el = h(`canvas.toy-sprite${cls}`);
  el.width = el.height = 16 * p;
  el.getContext('2d').drawImage(artCanvas(name, p), 0, 0);
  el.size = 16 * p / dpr;
  el.style.width = el.style.height = `${el.size}px`;
  el.at = (x, y) => { el.style.transform = `translate(${Math.round((x - el.size / 2) * dpr) / dpr}px, ${Math.round((y - el.size / 2) * dpr) / dpr}px)`; };
  document.body.append(el);
  return el;
}
// Where her hand is, and the middle of her, on screen.
const hand = pyxl => { const r = pyxl.el.getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.3 }; };
const middle = pyxl => { const r = pyxl.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const frames = fn => { let last = performance.now(), on = true; const f = now => { if (!on) return; const dt = Math.min(1 / 30, (now - last) / 1000); last = now; if (fn(dt, now) === false) on = false; else requestAnimationFrame(f); }; requestAnimationFrame(f); return () => { on = false; }; };

// ---- Ball: she throws it out onto the page; it bounces off the edges and lands on panels or the
// floor. Flick it back and she catches it (and throws again); leave it and she gives up after a while.
function ball(pyxl) {
  const s = pyxl.stats, el = sprite('ball', 2, '.ball'), st = stageBox(pyxl.app), from = hand(pyxl);
  const dir = st.left + st.width / 2 > from.x ? 1 : -1;
  const b = { x: from.x, y: from.y, vx: dir * (500 + Math.random() * 400), vy: -900 - Math.random() * 300, r: el.size / 2 - 1 };
  let held = null, thrown = false, restSince = 0, asked = false, rounds = 0, flying = performance.now();
  active.add('ball');
  pyxl.play('toss', { say: 'Catch!' });
  const done = (say, caught) => {
    stop(); active.delete('ball');
    el.classList.add('gone'); setTimeout(() => el.remove(), 300);
    if (caught) { s.change({ fun: 8 + rounds * 3, love: thrown ? 3 : 0 }, 1); s.feel('joy', 15); pyxl.react('cheer', { icon: 'heart', n: 3, say, force: true }); }
    else pyxl.react(s.is('crybaby') ? 'cry' : 'sit', { say, force: true });
  };
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    held = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    el.onpointermove = ev => { held.push({ x: ev.clientX, y: ev.clientY, t: ev.timeStamp }); if (held.length > 8) held.shift(); b.x = ev.clientX; b.y = ev.clientY; b.vx = b.vy = 0; };
    el.onpointerup = ev => { el.onpointermove = el.onpointerup = null; [b.vx, b.vy] = flick(held, ev.timeStamp); held = null; thrown = true; restSince = 0; flying = performance.now(); };
  });
  const stop = frames((dt, now) => {
    if (!held) {
      const rest = stepBody(b, dt, sp => sp > 300 && sfx('boing'), { bounce: 0.62 });
      if (rest) restSince ||= now; else restSince = 0;
    }
    el.at(b.x, b.y);
    const me = middle(pyxl), d = Math.hypot(b.x - me.x, b.y - me.y), free = pyxl.awake() && !pyxl.phys;
    if (free && ['toss', 'watch', 'idle', 'point'].includes(pyxl.state)) {   // she watches it, pointing
      if (pyxl.state !== 'watch' && pyxl.state !== 'toss') pyxl.play('watch');
      pyxl.flip = b.x < me.x;
    }
    // back to her: she catches it (after it's left her hands for a moment)
    if (free && !held && now - flying > 600 && d < 46) {
      rounds++;
      if (thrown && rounds < 6) {   // fetch: she throws it again
        sfx('pop'); pyxl.play('toss', { say: ['Got it! Again!', 'Yay! Here!', 'Nice throw!'][rounds % 3] });
        const st2 = stageBox(pyxl.app), dir2 = st2.left + st2.width / 2 > me.x ? 1 : -1, h2 = hand(pyxl);
        Object.assign(b, { x: h2.x, y: h2.y, vx: dir2 * (450 + Math.random() * 500), vy: -850 - Math.random() * 400 });
        thrown = false; flying = now; restSince = 0; asked = false;
        s.change({ fun: 3 }); return;
      }
      return done(thrown ? 'Got it! That was fun!' : 'Got it!', true);
    }
    if (restSince && now - restSince > 1500 && !asked) { asked = true; pyxl.say('Throw it back to me!', 3000); }
    if (restSince && now - restSince > 14000) return done('Aww… you didn’t throw it back.', false);
  });
}

// ---- Bubbles: she blows a stream of them; tap to pop ----
function bubbles(pyxl) {
  const s = pyxl.stats, N = 9;
  let popped = 0, left = N;
  active.add('bubbles');
  pyxl.play('blow', { say: 'Bubbles!' });
  const finish = () => {
    if (--left) return;
    active.delete('bubbles');
    s.change({ fun: 6 + popped * 2 }, 1); s.feel('joy', 10 + popped * 3);
    pyxl.react(popped >= 6 ? 'cheer' : 'happy', { icon: 'sparkle', n: 3, say: popped ? `You popped ${popped}!` : 'So pretty…', force: true });
  };
  for (let i = 0; i < N; i++) setTimeout(() => {
    const el = sprite('bubble', 1 + Math.round(Math.random()), '.bubble'), o = hand(pyxl), life = 6 + Math.random() * 4, vx = 30 + Math.random() * 60, rise = 40 + Math.random() * 50, ph = Math.random() * 6;
    const dir = stageBox(pyxl.app).left > o.x ? 1 : o.x > innerWidth / 2 ? -1 : 1;
    let t = 0, gone = false;
    const pop = user => {
      if (gone) return; gone = true; stop();
      if (user) { popped++; sfx('pop'); pyxl.burst('sparkle', 1); }
      el.classList.add('pop'); setTimeout(() => el.remove(), 200);
      finish();
    };
    el.addEventListener('pointerdown', e => { e.preventDefault(); pop(true); });
    const stop = frames(dt => {
      t += dt;
      const x = o.x + dir * vx * t + Math.sin(t * 2.2 + ph) * 14, y = o.y - rise * t - t * t * 4;
      el.at(x, y);
      if (t > life || y < 10) { pop(false); return false; }
    });
  }, 300 + i * 420);
}

// ---- Crayons: she draws a little doodle on the canvas area; tap it to keep it as a layer ----
const DOODLES = ['heart', 'star', 'moon', 'strawberry', 'mushroom', 'note', 'drop', 'heartFruit', 'ball', 'tea'];
function doodle(pyxl) {
  const name = DOODLES[Math.floor(Math.random() * DOODLES.length)], st = stageBox(pyxl.app), p = devPx(3), dpr = devicePixelRatio || 1, size = 16 * p / dpr;
  const art = artCanvas(name, 1), src = art.getContext('2d').getImageData(0, 0, 16, 16).data;
  const x = st.left + 40 + Math.random() * Math.max(10, st.width * 0.5 - 80) + (hand(pyxl).x > st.left + st.width / 2 ? st.width * 0.4 : 0);
  const y = st.top + st.height * (0.45 + Math.random() * 0.4) - size;
  const el = h('canvas.toy-doodle', { width: 16 * p, height: 16 * p, 'data-tip': 'Tap to keep it', style: { left: `${Math.round(x * dpr) / dpr}px`, top: `${Math.round(y * dpr) / dpr}px`, width: `${size}px`, height: `${size}px` } });
  document.body.append(el);
  const ctx = el.getContext('2d');
  // she colours it in roughly top to bottom, a few pixels at a time
  const px = [];
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) if (src[(j * 16 + i) * 4 + 3]) px.push([i, j, j + Math.random() * 3]);
  px.sort((a, b) => a[2] - b[2]);
  pyxl.cursor = { x: x + size / 2, y: y + size / 2, t: Date.now() };
  pyxl.react('paint', { dur: 1700, say: 'Let me draw!', force: true }); sfx('draw');
  let n = 0;
  const stop = frames(() => {
    for (let k = 0; k < 6 && n < px.length; k++, n++) { const [i, j] = px[n], o = (j * 16 + i) * 4; ctx.fillStyle = `rgba(${src[o]},${src[o + 1]},${src[o + 2]},${src[o + 3] / 255})`; ctx.fillRect(i * p, j * p, p, p); }
    if (n >= px.length) { pyxl.say(`I drew a ${name.replace(/([A-Z])/g, ' $1').toLowerCase()}!`); return false; }
  });
  const fade = setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 800); }, 12000);
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); stop(); clearTimeout(fade);
    const big = document.createElement('canvas'); big.width = big.height = 128;
    const b = big.getContext('2d'); b.imageSmoothingEnabled = false; b.drawImage(art, 0, 0, 128, 128);
    pyxl.keepDrawing?.(big, `Pyxl doodle: ${name}`);
    pyxl.stats.change({ love: 4 }); pyxl.react('cheer', { icon: 'heart', n: 3, say: 'It’s yours! ♡', force: true });
    el.classList.add('gone'); setTimeout(() => el.remove(), 300);
  });
  pyxl.stats.change({ fun: 8 }, 1); pyxl.stats.train('colour', 4);
}

// ---- Radio: notes drift up from her while it plays ----
let noteTimer = 0;
export function radioNotes(pyxl, on) {
  clearInterval(noteTimer);
  if (!on) return;
  noteTimer = setInterval(() => {
    if (still() || document.hidden || !pyxl.awake()) return;
    const el = sprite('note', 1, '.note'), o = hand(pyxl), dir = o.x > innerWidth / 2 ? -1 : 1, drift = 40 + Math.random() * 60, ph = Math.random() * 6;
    let t = 0;
    frames(dt => {
      t += dt;
      el.at(o.x + dir * drift * t + Math.sin(t * 3 + ph) * 8, o.y - 20 - 45 * t);
      el.style.opacity = Math.max(0, 1 - t / 3.5);
      if (t > 3.5) { el.remove(); return false; }
    });
  }, 1400);
}

export function playToy(pyxl, id) {
  if (still() && id !== 'crayons') return false;   // e-ink: she plays with them in her box instead
  if (active.has(id)) { pyxl.say('I’m still playing with it!'); return true; }
  ({ ball, bubbles, crayons: doodle })[id]?.(pyxl);
  return id in { ball: 1, bubbles: 1, crayons: 1 };
}
