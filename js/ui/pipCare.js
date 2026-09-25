import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { NEEDS, SNACKS } from './pipStats.js';
import { iconCanvas } from './pixelIcons.js';

let card = null;
const close = () => { card?.remove(); card = null; };

// Pip's care card: needs, mood, level, and Feed / Pet / Play / Nap.
export function openCareCard(pip) {
  if (card) return;
  const s = pip.stats, bars = {}, mood = h('p.pc-mood'), lvl = h('span.pc-lvl'), napBtn = h('button.btn.sm', { type: 'button' });
  const snacks = h('div.pc-snacks', { hidden: true }, SNACKS.map(sn => h('button.pc-snack', { type: 'button', 'data-tip': sn[1], onclick: () => { pip.feed(sn); snacks.hidden = true; } }, iconCanvas(sn[0], 3), h('small', {}, sn[1]))));
  const sync = () => {
    NEEDS.forEach(([k]) => { bars[k].style.width = `${s[k]}%`; bars[k].parentElement.classList.toggle('low', s[k] < 28); });
    mood.textContent = s.mood;
    lvl.textContent = `Lv ${s.level} · ${s.ageDays ? `${s.ageDays} day${s.ageDays > 1 ? 's' : ''} old` : 'new friend'}`;
    napBtn.replaceChildren(icon(s.asleep ? 'sun' : 'zen'), s.asleep ? 'Wake' : 'Nap');
    napBtn.onclick = () => (s.asleep ? pip.wake() : pip.nap());
  };
  card = h('div.pip-card', {},
    h('div.pc-head', {}, h('strong', {}, 'Pip'), lvl, h('span.spacer'), h('button.ibtn.sm', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    mood,
    h('div.pc-bars', {}, NEEDS.map(([k, name, ic, color]) => h('div.pc-bar', { 'data-tip': name },
      iconCanvas(ic, 2), h('span', {}, name), h('div.pc-track', {}, bars[k] = h('i', { style: { background: color } }))))),
    h('div.pc-xp', {}, h('i', { style: { width: `${s.xp / (s.level * 40) * 100}%` } })),
    h('div.pc-actions', {},
      h('button.btn.sm', { type: 'button', onclick: () => { snacks.hidden = !snacks.hidden; } }, iconCanvas('onigiri', 2), 'Feed'),
      h('button.btn.sm', { type: 'button', onclick: () => pip.pet() }, iconCanvas('heart', 2), 'Pet'),
      h('button.btn.sm', { type: 'button', onclick: () => { close(); pip.playGame(); } }, iconCanvas('star', 2), 'Play'),
      napBtn),
    snacks);
  document.body.append(card);
  const m = pip.el.getBoundingClientRect(), c = card.getBoundingClientRect();
  const left = m.left + m.width / 2 > innerWidth / 2 ? m.left - c.width - 8 : m.right + 8;
  Object.assign(card.style, { left: `${Math.max(8, Math.min(left, innerWidth - c.width - 8))}px`, top: `${Math.max(8, Math.min(m.bottom - c.height, innerHeight - c.height - 8))}px` });
  sync();
  const off = bus.on('pip:stats', () => card && sync());
  const outside = e => { if (card && !card.contains(e.target) && !pip.el.contains(e.target)) { close(); off(); removeEventListener('pointerdown', outside, true); } };
  addEventListener('pointerdown', outside, true);
}

// "Catch the stars": stars pop up around the screen for a moment; click as many as you can.
export function startStarGame(pip) {
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
      pip.burst('sparkle', 2);
      setTimeout(() => { star.remove(); spawn(); }, 180);
    });
    layer.append(star);
  };
  const end = () => { layer.remove(); pip.gameOver(caught); };
  setTimeout(spawn, 500);
}
