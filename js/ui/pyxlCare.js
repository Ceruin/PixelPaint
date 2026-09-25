import { h, icon, keepOnScreen } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { clamp } from '../core/util.js';
import { NEEDS, SNACKS } from './pyxlStats.js';
import { iconCanvas } from './pixelIcons.js';


// Pyxl's care body: needs, mood, level, and Feed / Pet / Play / Nap. Used by the popup card
// and by the dockable "Pyxl" panel; it stays in sync with her stats while it's in the page.
export function careBody(pyxl, onPlay) {
  const s = pyxl.stats, bars = {}, mood = h('p.pc-mood'), lvl = h('span.pc-lvl'), xp = h('i'), napBtn = h('button.btn.sm', { type: 'button' });
  const snacks = h('div.pc-snacks', { hidden: true }, SNACKS.map(sn => h('button.pc-snack', { type: 'button', 'data-tip': sn[1], onclick: () => { pyxl.feed(sn); snacks.hidden = true; } }, iconCanvas(sn[0], 3), h('small', {}, sn[1]))));
  const el = h('div.pc-body', {},
    lvl, mood,
    h('div.pc-bars', {}, NEEDS.map(([k, name, ic, color]) => h('div.pc-bar', { 'data-tip': name },
      iconCanvas(ic, 2), h('span', {}, name), h('div.pc-track', {}, bars[k] = h('i', { style: { background: color } }))))),
    h('div.pc-xp', {}, xp),
    h('div.pc-actions', {},
      h('button.btn.sm', { type: 'button', onclick: () => { snacks.hidden = !snacks.hidden; } }, iconCanvas('onigiri', 2), 'Feed'),
      h('button.btn.sm', { type: 'button', onclick: () => pyxl.pet() }, iconCanvas('heart', 2), 'Pet'),
      h('button.btn.sm', { type: 'button', onclick: () => { onPlay?.(); pyxl.playGame(); } }, iconCanvas('star', 2), 'Play'),
      napBtn),
    snacks);
  const sync = () => {
    NEEDS.forEach(([k]) => { bars[k].style.width = `${s[k]}%`; bars[k].parentElement.classList.toggle('low', s[k] < 28); });
    mood.textContent = s.mood;
    lvl.textContent = `Lv ${s.level} · ${s.ageDays ? `${s.ageDays} day${s.ageDays > 1 ? 's' : ''} old` : 'new friend'}`;
    xp.style.width = `${s.xp / (s.level * 40) * 100}%`;
    napBtn.replaceChildren(icon(s.asleep ? 'sun' : 'zen'), s.asleep ? 'Wake' : 'Nap');
    napBtn.onclick = () => (s.asleep ? pyxl.wake() : pyxl.nap());
  };
  sync();
  el.dispose = bus.on('pyxl:stats', sync);
  return el;
}

// The popup card: drag it by its header anywhere; pin it to keep it open (it remembers where you
// left it); or dock it as a regular panel (Paint / Paper modes).
let card = null;
const close = () => { card?.stop(); card?.body.dispose(); card?.remove(); card = null; };
export const closeCareCard = close;

export function openCareCard(pyxl, dock) {
  if (card) return;
  const saved = local.get('pp.pyxlCard') ?? {}, body = careBody(pyxl, () => !saved.pinned && close());
  const pin = h('button.ibtn.sm', { type: 'button', 'data-tip': 'Pin open', onclick: () => { saved.pinned = !saved.pinned; pin.classList.toggle('on', saved.pinned); local.set('pp.pyxlCard', saved); } }, icon('lock'));
  pin.classList.toggle('on', !!saved.pinned);
  const head = h('div.pc-head', {}, iconCanvas('heart', 2), h('strong', {}, 'Pyxl'), h('span.spacer'), pin,
    dock && h('button.ibtn.sm', { type: 'button', 'data-tip': 'Dock as a panel', onclick: () => { close(); dock(); } }, icon('window')),
    h('button.ibtn.sm', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('x')));
  card = h('div.pyxl-card', {}, head, body);
  card.body = body;
  document.body.append(card);
  const c = card.getBoundingClientRect(), place = (x, y) => Object.assign(card.style, { left: `${clamp(x, 8, innerWidth - c.width - 8)}px`, top: `${clamp(y, 8, innerHeight - c.height - 8)}px` });
  if (saved.pinned && saved.x != null) place(saved.x, saved.y);
  else {
    const m = pyxl.el.getBoundingClientRect();
    place(m.left + m.width / 2 > innerWidth / 2 ? m.left - c.width - 8 : m.right + 8, m.bottom - c.height);
  }
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    head.setPointerCapture(e.pointerId);
    const r = card.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    head.onpointermove = ev => place(ev.clientX - ox, ev.clientY - oy);
    head.onpointerup = () => { head.onpointermove = null; const b = card.getBoundingClientRect(); Object.assign(saved, { x: b.left, y: b.top }); local.set('pp.pyxlCard', saved); };
  });
  const outside = e => { if (card && !saved.pinned && !card.contains(e.target) && !pyxl.el.contains(e.target)) close(); };
  addEventListener('pointerdown', outside, true);
  const stopClamp = keepOnScreen(card);
  card.stop = () => { stopClamp?.(); removeEventListener('pointerdown', outside, true); };
}

// "Catch the stars": stars pop up around the screen for a moment; click as many as you can.
export function startStarGame(pyxl) {
  const layer = h('div.star-game'), score = h('div.sg-score', {}, '0 / 8');
  layer.append(score);
  document.body.append(layer);
  let caught = 0, shown = 0;
  const spawn = () => {
    if (shown >= 8) return setTimeout(end, 600);
    shown++;
    const star = h('button.sg-star', { type: 'button', style: { left: `${40 + Math.random() * (innerWidth - 120)}px`, top: `${60 + Math.random() * (innerHeight - 180)}px` } }, iconCanvas('star', 6));
    const gone = setTimeout(() => { star.remove(); spawn(); }, 1150);
    star.addEventListener('pointerdown', e => {
      e.stopPropagation();
      clearTimeout(gone);
      caught++;
      score.textContent = `${caught} / 8`;
      star.classList.add('pop');
      pyxl.burst('sparkle', 2);
      setTimeout(() => { star.remove(); spawn(); }, 180);
    });
    layer.append(star);
  };
  const end = () => { layer.remove(); pyxl.gameOver(caught); };
  setTimeout(spawn, 500);
}
