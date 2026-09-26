import { h, icon, keepOnScreen, morph } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { clamp } from '../core/util.js';
import { NEEDS, SNACKS, SHOP, SHOP_INFO, dealOfTheDay, priceOf, SKILLS, GRADES, PERSONALITIES, TYPES, ILLNESSES, LESSONS, LESSON_SLOT, LUCKY_NAMES, currentLesson } from './pyxlStats.js';
import { RACES, raceUnlocked, medalName } from './pyxlRace.js';
import { iconCanvas } from './pixelIcons.js';
import { radio } from './pyxlAudio.js';
import { GAMES } from './pyxlGames.js';


// Pyxl's care body, in five tabs (after the Chao Kindergarten): Care (needs, food, toys), Chart
// (the Health Center's medical chart: name, personality, age, skills and grades), School (the
// classroom's rotating lessons), Games (stars and races) and Shop (special fruit for rings).
// Used by the popup card and the dockable "Pyxl" panel; it re-renders as her stats change.
const TABS = [['care', 'Care', 'heart'], ['chart', 'Chart', 'pill'], ['school', 'School', 'bag'], ['games', 'Games', 'star'], ['shop', 'Shop', 'ring']];
const TOYS = [['ball', 'Ball'], ['bubbles', 'Bubbles'], ['crayons', 'Crayons'], ['box', 'Box'], ['radio', 'Radio'], ['tv', 'TV']];
const clock = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const HAPPY_WORDS = [[60, 'Overjoyed'], [30, 'Happy'], [0, 'Content'], [-30, 'Down'], [-101, 'Miserable']];
let tab = local.get('pp.pyxlTab', 'care');

export function careBody(pyxl, onPlay) {
  const s = pyxl.stats, content = h('div.pc-content'), tabs = h('div.pc-tabs', { role: 'tablist' });
  const btn = (ic, label, fn, opts = {}) => h('button.btn.sm', { type: 'button', onclick: fn, ...opts }, iconCanvas(ic, 2), h('span.lbl', {}, label));
  const bar = (v, color, cls = '') => h(`div.pc-track${cls}`, {}, h('i', { style: { transform: `scaleX(${Math.max(0, Math.min(100, v)) / 100})`, background: color } }));

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
        h('div.pc-toys', {}, TOYS.map(([id, name]) => h('button.pc-toy', { type: 'button', className: id === 'radio' && radio.on ? 'on' : '', 'aria-label': name, onclick: () => pyxl.toy(id) }, iconCanvas(id, 3), h('small', {}, id === 'radio' && radio.on ? 'Stop' : name)))),
        radio.on && h('div.pc-radio', {},
          h('button.ibtn.sm', { type: 'button', 'data-tip': 'Previous track', onclick: () => pyxl.setRadio(true, radio.index - 1) }, icon('first')),
          h('span', {}, iconCanvas('note', 2), ` ${radio.name}`),
          h('button.ibtn.sm', { type: 'button', 'data-tip': 'Next track', onclick: () => pyxl.setRadio(true, radio.index + 1) }, icon('last')),
          h('button.ibtn.sm', { type: 'button', 'data-tip': 'Switch the radio off', onclick: () => pyxl.setRadio(false) }, icon('pause'))),
        h('label.pc-volume', { 'data-tip': 'Volume of the radio, toys and games' }, icon(radio.volume ? 'volume' : 'mute'),
          h('input', { type: 'range', min: 0, max: 100, value: Math.round(radio.volume * 100), 'aria-label': 'Volume', oninput: e => { radio.setVolume(e.target.value / 100); e.target.previousSibling.replaceWith(icon(radio.volume ? 'volume' : 'mute')); } }),
          h('small', {}, 'Sound')),
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
      const [id, name, kind] = currentLesson(), now = Date.now(), left = LESSON_SLOT - (now % LESSON_SLOT);
      const at = s.school, learned = LESSONS.filter(l => s.learned[l[0]]), brk = pyxl.breakUntil > now;
      const focusBtn = min => h('button.btn.sm', { type: 'button', disabled: !!at || !pyxl.awake(), onclick: () => pyxl.school(min) }, `${min} min`);
      return [
        h('p.pc-mood', {}, at?.focus ? `Focusing — ${clock(at.until - now)} left.` : at ? `In ${LESSONS.find(l => l[0] === at.id)?.[1]} class — back in ${clock(at.until - now)}.` : brk ? `Break — ${clock(pyxl.breakUntil - now)}. Stretch!` : `Next lesson in ${clock(left)}.`),
        at && h('button.btn.sm', { type: 'button', onclick: () => pyxl.leaveSchool() }, icon('x'), h('span.lbl', {}, at.focus ? 'Stop focusing' : 'Bring her home')),
        h('div.pc-label', {}, 'Focus together'),
        h('div.pc-focus', {}, iconCanvas('moon', 3), h('small', {}, `She studies while you work, then you both take a break.${s.pomos ? ` ${s.pomos} done.` : ''}`), h('div.pc-focus-btns', {}, [15, 25, 50].map(focusBtn))),
        h('div.pc-label', {}, 'Kindergarten'),
        h('div.pc-lesson', {}, iconCanvas(kind === 'instrument' ? id : kind === 'dance' ? 'note' : kind === 'song' ? 'note' : kind === 'drawing' ? 'crayons' : 'star', 3),
          h('div', {}, h('b', {}, name), h('small', {}, `${kind[0].toUpperCase()}${kind.slice(1)}${s.learned[id] ? ` · learned${kind === 'song' || kind === 'drawing' ? ` (level ${s.learned[id]}/5)` : ''}` : ''}`)),
          h('button.btn.sm.primary', { type: 'button', disabled: !!at || !pyxl.awake(), onclick: () => pyxl.school() }, h('span.lbl', {}, 'Send to class'))),
        h('div.pc-label', {}, `Learned ${learned.length} / ${LESSONS.length}`),
        h('div.pc-learned', {}, LESSONS.map(([lid, lname]) => h(`span${s.learned[lid] ? '.on' : ''}`, { 'data-tip': lname }, lname))),
        h('p.pc-note', {}, 'She shows off what she learns. Lessons change every 3 minutes.'),
      ];
    },
    games() {
      return [
        h('div.pc-games', {}, GAMES.map(([id, name, ic, desc]) => h('button.pc-gtile', { type: 'button', 'data-tip': desc, onclick: () => { onPlay?.(); pyxl.playGame(id); } }, iconCanvas(ic, 2), h('b', {}, name)))),
        h('div.pc-label', {}, 'Races — her skills decide'),
        h('div.pc-races', {}, RACES.map(([id, label], i) => {
          const open = raceUnlocked(s, i), m = s.medals[id];
          return h('button.pc-race', { type: 'button', disabled: !open, className: m != null ? `m${m}` : '', 'data-tip': open ? m != null ? `Best: ${medalName(m)}` : 'No medal yet' : `Win gold in the ${RACES[i - 1][1]} race first`, onclick: () => { onPlay?.(); pyxl.race(i); } },
            open ? iconCanvas('medal', 2) : icon('lock'), h('span', {}, label));
        })),
      ];
    },
    // Pick an item to see what it does; the deal of the day is 30% off.
    shop() {
      const deal = dealOfTheDay(), sel = SHOP.find(i => i[0] === shopPick) ?? SHOP.find(i => i[0] === deal), price = priceOf(sel), fav = sel[0] === s.fav;
      return [
        h('div.pc-wallet', {}, iconCanvas('ring', 2), h('b', {}, `${s.rings}`), h('small', {}, 'rings — earned by painting, saving, games and races')),
        h('div.pc-shop', {}, SHOP.map(item => h('button.pc-item', { type: 'button', className: `${item[0] === sel[0] ? 'on' : ''} ${item[0] === deal ? 'deal' : ''}`, onclick: () => { shopPick = item[0]; render(); }, 'aria-label': item[1] },
          iconCanvas(item[0], 3), h('small.pc-price', {}, iconCanvas('ring', 1), `${priceOf(item)}`)))),
        h('div.pc-detail', {}, iconCanvas(sel[0], 4),
          h('div', {}, h('b', {}, sel[1], sel[0] === deal ? h('span.pc-tag', {}, '−30% today') : '', fav ? h('span.pc-tag.fav', {}, 'her favourite') : ''), h('small', {}, SHOP_INFO[sel[3]])),
          h('button.btn.sm.primary', { type: 'button', disabled: s.rings < price, onclick: () => pyxl.buy([sel[0], sel[1], price, sel[3]]) }, iconCanvas('ring', 1), h('span.lbl', {}, s.rings < price ? `Need ${price}` : `Buy · ${price}`))),
      ];
    },
  };
  let shopPick = null;

  // Tabs are built once; a render only swaps the content of the open tab.
  tabs.append(...TABS.map(([id, label, ic]) => h('button.pc-tab', { type: 'button', role: 'tab', 'data-tip': label, dataset: { tab: id }, onclick: () => { tab = id; local.set('pp.pyxlTab', id); render(); } }, iconCanvas(ic, 2), h('span', {}, label))));
  const render = () => {
    renderTop();
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === tab);
    const next = h('div', {}, ...views[tab]().filter(Boolean));
    if (content.dataset.tab !== tab) { content.dataset.tab = tab; content.replaceChildren(...next.childNodes); }
    else morph(content, next);                                          // same tab: update in place
  };
  // Re-render at most once a frame, and only while visible (the docked panel may be hidden).
  let raf = 0, stale = false;
  const schedule = () => { raf ||= requestAnimationFrame(() => { raf = 0; if (el.offsetParent) render(); else stale = true; }); };
  // always at hand: send her home (when she's away from her spot) and quiet mode
  const top = h('div.pc-top');
  const renderTop = () => morph(top, h('div', {},
    h('button.btn.sm', { type: 'button', disabled: !pyxl.floating, 'data-tip': pyxl.floating ? 'Back to her spot' : 'She’s home — drag her to carry her anywhere', onclick: () => { pyxl.goHome(); pyxl.react('happy', { say: 'Home sweet home!' }); } }, iconCanvas('house', 2), h('span.lbl', {}, 'Send home')),
    h('button.btn.sm', { type: 'button', className: pyxl.silent ? 'on' : '', 'data-tip': pyxl.silent ? 'Let her talk again' : 'No chatter or reactions (she won’t like it)', onclick: () => pyxl.setSilent(!pyxl.silent) }, icon('mute'), h('span.lbl', {}, pyxl.silent ? 'Quiet: on' : 'Quiet'))));
  const el = h('div.pc-body', {}, top, tabs, content);
  new IntersectionObserver(([e]) => { if (e.isIntersecting && stale) { stale = false; render(); } }).observe(el);
  render();
  const off = bus.on('pyxl:stats', schedule), timer = setInterval(() => tab === 'school' && schedule(), 1000);
  el.dispose = () => { off(); clearInterval(timer); };
  return el;
}

// The popup card: drag it by its header anywhere; pin it to keep it open (it remembers where you
// left it); or dock it as a regular panel (Draw workspace).
let card = null;
// Always ends with no card, even if one was half set up (a stuck `card` meant she could never be opened again).
const close = () => { const c = card; card = null; try { c?.stop?.(); c?.body?.dispose?.(); } finally { c?.remove(); } };
export const closeCareCard = close;

export function openCareCard(pyxl, dock) {
  if (card?.isConnected) return;
  if (card) close();
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
  const outside = e => { if (card && !saved.pinned && !card.contains(e.target) && !pyxl.el.contains(e.target) && e.target !== pyxl.bubble) close(); };
  addEventListener('pointerdown', outside, true);
  const stopClamp = keepOnScreen(card);
  card.stop = () => { stopClamp?.(); removeEventListener('pointerdown', outside, true); };
}
