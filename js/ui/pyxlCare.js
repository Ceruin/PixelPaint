import { h, icon, keepOnScreen, morph } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { clamp } from '../core/util.js';
import { NEEDS, SNACKS, SHOP, SKILLS, GRADES, PERSONALITIES, TYPES, ILLNESSES, LESSONS, LESSON_SLOT, LUCKY_NAMES, currentLesson } from './pyxlStats.js';
import { RACES, raceUnlocked, medalName } from './pyxlRace.js';
import { iconCanvas } from './pixelIcons.js';


// Pyxl's care body, in five tabs (after the Chao Kindergarten): Care (needs, food, toys), Chart
// (the Health Center's medical chart: name, personality, age, skills and grades), School (the
// classroom's rotating lessons), Games (stars and races) and Shop (special fruit for rings).
// Used by the popup card and the dockable "Pyxl" panel; it re-renders as her stats change.
const TABS = [['care', 'Care', 'heart'], ['chart', 'Chart', 'pill'], ['school', 'School', 'bag'], ['games', 'Games', 'star'], ['shop', 'Shop', 'ring']];
const TOYS = [['ball', 'Ball'], ['box', 'Box'], ['radio', 'Radio'], ['tv', 'TV'], ['crayons', 'Crayons']];
const HAPPY_WORDS = [[60, 'Overjoyed'], [30, 'Happy'], [0, 'Content'], [-30, 'Down'], [-101, 'Miserable']];
let tab = local.get('pp.pyxlTab', 'care');

export function careBody(pyxl, onPlay) {
  const s = pyxl.stats, content = h('div.pc-content'), tabs = h('div.pc-tabs', { role: 'tablist' });
  const btn = (ic, label, fn, opts = {}) => h('button.btn.sm', { type: 'button', onclick: fn, ...opts }, iconCanvas(ic, 2), h('span.lbl', {}, label));
  const bar = (v, color, cls = '') => h(`div.pc-track${cls}`, {}, h('i', { style: { width: `${Math.max(0, Math.min(100, v))}%`, background: color } }));

  const views = {
    care() {
      const snacks = h('div.pc-grid', { hidden: true, dataset: { sticky: '' } }, SNACKS.map(sn => h('button.pc-item', { type: 'button', 'data-tip': sn[1], 'aria-label': sn[1], onclick: () => pyxl.feed(sn) }, iconCanvas(sn[0], 3))));
      return [
        h('p.pc-mood', {}, s.mood),
        h('div.pc-bars', {}, NEEDS.map(([k, name, ic, color]) => h(`div.pc-bar${s[k] < 28 ? '.low' : ''}`, { 'data-tip': name }, iconCanvas(ic, 2), h('span', {}, name), bar(s[k], color)))),
        h('div.pc-xp', { 'data-tip': `Friendship level ${s.level}` }, h('i', { style: { width: `${s.xp / (s.level * 40) * 100}%` } })),
        h('div.pc-actions', {},
          btn('onigiri', 'Feed', () => { snacks.hidden = !snacks.hidden; }),
          btn('heart', 'Pet', () => pyxl.pet()),
          s.sick ? btn('pill', 'Doctor', () => pyxl.doctor()) : btn('ball', 'Play', () => { onPlay?.(); pyxl.playGame(); }),
          h('button.btn.sm', { type: 'button', onclick: () => (s.asleep ? pyxl.wake() : pyxl.nap()) }, icon(s.asleep ? 'sun' : 'zen'), h('span.lbl', {}, s.asleep ? 'Wake' : 'Nap'))),
        snacks,
        h('div.pc-label', {}, 'Toys'),
        h('div.pc-grid', {}, TOYS.map(([id, name]) => h('button.pc-item', { type: 'button', 'data-tip': name, 'aria-label': name, onclick: () => pyxl.toy(id) }, iconCanvas(id, 3)))),
        pyxl.floating ? h('button.btn.sm', { type: 'button', onclick: () => { pyxl.goHome(); pyxl.react('happy', { say: 'Home sweet home!' }); } }, iconCanvas('bag', 2), h('span.lbl', {}, 'Send Pyxl home')) : h('p.pc-note', {}, 'Tip: drag Pyxl to carry her anywhere.'),
      ];
    },
    chart() {
      const name = h('input.pc-name', { value: s.name, maxLength: 14, spellcheck: false, 'aria-label': 'Name',
        onkeydown: e => e.stopPropagation(), onchange: () => { s.name = name.value.trim() || 'Pyxl'; s.save(); } });
      const [pName, pDesc] = PERSONALITIES[s.personality] ?? PERSONALITIES.none;
      const fav = [...SNACKS, ...SHOP].find(f => f[0] === s.fav);
      const hw = HAPPY_WORDS.find(([v]) => s.happiness >= v)[1];
      const row = (label, ...val) => h('div.pc-row', {}, h('span', {}, label), h('b', {}, ...val));
      return [
        h('div.pc-namerow', {}, name, h('button.ibtn.sm', { type: 'button', 'data-tip': 'Fortune teller: a lucky name', onclick: () => { s.name = LUCKY_NAMES[Math.floor(Math.random() * LUCKY_NAMES.length)]; s.save(); pyxl.react('happy', { icon: 'sparkle', say: `${s.name}? I love it!` }); } }, icon('sparkle'))),
        h('div.pc-page.blue', {},
          row('Stage', s.ageLabel, s.stage === 'child' || s.stage === 'adult' ? ` · life ${s.lives}` : ''),
          row('Type', s.chaos ? `Chaos ${s.name}` : s.type ? TYPES[s.type] : 'Still growing'),
          row('Alignment', s.alignment)),
        h('div.pc-skills', {}, SKILLS.map(([k, label, ic, color]) => {
          const sk = s.skills[k];
          return h('div.pc-skill', { 'data-tip': `${sk.pts} points` }, iconCanvas(ic, 2), h('span', {}, label), h('b.pc-grade', { className: `g${sk.grade}` }, GRADES[sk.grade]),
            h('span.pc-lv', {}, `Lv ${sk.level}`), h('span.pc-prog', {}, Array.from({ length: 10 }, (_, i) => h(`i${i < sk.prog / 10 ? '.on' : ''}`, { style: { '--c': color } }))));
        })),
        h('div.pc-page.yellow', {},
          row('Personality', pName), h('p.pc-note', {}, pDesc),
          row('Favourite', fav ? iconCanvas(fav[0], 2) : '', fav ? ` ${fav[1]}` : '?'),
          row('Feeling', hw),
          row('Health', s.sick ? `Has ${ILLNESSES[s.sick]}` : 'Healthy'),
          s.sick && btn('pill', 'See the doctor', () => pyxl.doctor())),
        h('div.pc-page.pink', {},
          row('Rings', iconCanvas('ring', 2), ` ${s.rings}`),
          row('Races', `${s.wins} won / ${s.races}`),
          row('Medals', ...RACES.map(([id, label]) => s.medals[id] != null ? h('span.pc-medal', { className: `m${s.medals[id]}`, 'data-tip': `${label}: ${medalName(s.medals[id])}` }, iconCanvas('medal', 2)) : ''))),
      ];
    },
    school() {
      const [id, name, kind] = currentLesson(), left = Math.ceil((LESSON_SLOT - (Date.now() % LESSON_SLOT)) / 1000);
      const at = s.school, learned = LESSONS.filter(l => s.learned[l[0]]);
      return [
        h('p.pc-mood', {}, at ? `${s.name} is in ${LESSONS.find(l => l[0] === at.id)?.[1]} class — back in ${Math.max(0, Math.ceil((at.until - Date.now()) / 1000))}s.` : `Now in class: ${name}. Next lesson in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`),
        h('div.pc-lesson', {}, iconCanvas(kind === 'instrument' ? id : kind === 'dance' ? 'note' : kind === 'song' ? 'note' : kind === 'drawing' ? 'crayons' : 'star', 3),
          h('div', {}, h('b', {}, name), h('small', {}, `${kind[0].toUpperCase()}${kind.slice(1)}${s.learned[id] ? ` · learned${kind === 'song' || kind === 'drawing' ? ` (level ${s.learned[id]}/5)` : ''}` : ''}`)),
          h('button.btn.sm.primary', { type: 'button', disabled: !!at || !pyxl.awake(), onclick: () => pyxl.school() }, h('span.lbl', {}, 'Send to class'))),
        h('div.pc-label', {}, `Learned ${learned.length} / ${LESSONS.length}`),
        h('div.pc-learned', {}, LESSONS.map(([lid, lname]) => h(`span${s.learned[lid] ? '.on' : ''}`, { 'data-tip': lname }, lname))),
        h('p.pc-note', {}, 'She shows off what she learns while you work. Lessons rotate every 3 minutes, like the Chao Kindergarten.'),
      ];
    },
    games() {
      return [
        h('div.pc-game', {}, iconCanvas('star', 3), h('div', {}, h('b', {}, 'Catch the stars'), h('small', {}, 'Tap stars before they vanish. Builds luck.')),
          h('button.btn.sm', { type: 'button', onclick: () => { onPlay?.(); pyxl.playGame(); } }, 'Play')),
        h('div.pc-label', {}, 'Races — skills and stamina decide who wins'),
        ...RACES.map(([id, label], i) => {
          const open = raceUnlocked(s, i), m = s.medals[id];
          return h('div.pc-game', {}, iconCanvas('medal', 3),
            h('div', {}, h('b', {}, `${label} Race`), h('small', {}, open ? m != null ? `Best: ${medalName(m)}` : 'No medal yet' : `Win gold in the ${RACES[i - 1][1]} race`)),
            h('button.btn.sm', { type: 'button', disabled: !open, onclick: () => { onPlay?.(); pyxl.race(i); } }, open ? 'Race' : icon('lock')));
        }),
      ];
    },
    shop() {
      return [
        h('p.pc-mood', {}, iconCanvas('ring', 2), ` ${s.rings} rings — earn them by painting, saving, levelling up and winning races.`),
        h('div.pc-shop', {}, SHOP.map(item => h('button.pc-item', { type: 'button', disabled: s.rings < item[2], onclick: () => pyxl.buy(item), 'data-tip': `${item[1]} — ${SHOP_TIPS[item[3]]}`, 'aria-label': item[1] },
          iconCanvas(item[0], 3), h('small.pc-price', {}, iconCanvas('ring', 1), `${item[2]}`)))),
      ];
    },
  };
  const SHOP_TIPS = { love: 'Love season: flowers bloom around her', bright: 'Nudges her toward Bright', moody: 'Nudges her toward Moody', skills: 'Trains every skill', energy: 'A pick-me-up' };

  // Tabs are built once; a render only swaps the content of the open tab.
  tabs.append(...TABS.map(([id, label, ic]) => h('button.pc-tab', { type: 'button', role: 'tab', 'data-tip': label, dataset: { tab: id }, onclick: () => { tab = id; local.set('pp.pyxlTab', id); render(); } }, iconCanvas(ic, 2), h('span', {}, label))));
  const render = () => {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === tab);
    const next = h('div', {}, ...views[tab]().filter(Boolean));
    if (content.dataset.tab !== tab) { content.dataset.tab = tab; content.replaceChildren(...next.childNodes); }
    else morph(content, next);                                          // same tab: update in place
  };
  // Re-render at most once a frame, and only while visible (the docked panel may be hidden).
  let raf = 0, stale = false;
  const schedule = () => { raf ||= requestAnimationFrame(() => { raf = 0; if (el.offsetParent) render(); else stale = true; }); };
  const el = h('div.pc-body', {}, tabs, content);
  new IntersectionObserver(([e]) => { if (e.isIntersecting && stale) { stale = false; render(); } }).observe(el);
  render();
  const off = bus.on('pyxl:stats', schedule), timer = setInterval(() => tab === 'school' && schedule(), 1000);
  el.dispose = () => { off(); clearInterval(timer); };
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
  const head = h('div.pc-head', {}, iconCanvas('heart', 2), h('strong', {}, pyxl.stats.name), h('span.spacer'), pin,
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
