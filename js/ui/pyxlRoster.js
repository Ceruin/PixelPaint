import { local, idb } from '../core/storage.js';
import { Mascot } from './mascot.js';
import { statsKey, backupKey, LUCKY_NAMES, FRIEND_COLOURS } from './pyxlStats.js';

// Your Pyxls: the first one (who lives in her spot in each workspace) plus friends hatched from
// shop eggs, who float beside her (or wherever you carry them). Each has her own needs, skills,
// colour and storage; the list of friends is kept in localStorage with a copy in IndexedDB.
export const MAX_PYXLS = 4;
const LIST = 'pp.pyxls', LIST_BACKUP = 'pyxl-roster';
const uid = () => Math.random().toString(36).slice(2, 9);

export function initRoster(app, main) {
  const roster = {
    main, all: [main],
    friends: () => roster.all.filter(m => m !== main),
    hasRoom: () => roster.all.length < MAX_PYXLS,
    save() { const ids = roster.friends().map(m => m.id); local.set(LIST, ids); idb.set(LIST_BACKUP, ids).catch(() => {}); },
    // friends who sit beside your first Pyxl follow her when she moves (mode switch, resize)
    follow() { for (const m of roster.friends()) if (m.besideMain || !m.floating) m.goHome(); },
    // a new Pyxl from the shop: an egg in her own colour, with a name nobody else has
    adopt() {
      const taken = new Set(roster.all.map(m => m.stats.name)), used = new Set(roster.all.map(m => m.colour));
      const m = make(uid());
      const free = LUCKY_NAMES.filter(n => !taken.has(n));
      m.stats.name = free[Math.floor(Math.random() * free.length)] ?? 'Pixie';
      m.stats.colour = FRIEND_COLOURS.find(c => !used.has(c)) ?? FRIEND_COLOURS[Math.floor(Math.random() * FRIEND_COLOURS.length)];
      m.stats.save(); m.drawn = null;
      roster.save();
      return m.stats;
    },
    remove(m) {
      if (m === main) return;
      roster.all = roster.all.filter(x => x !== m);
      m.dispose(); roster.save();
      requestAnimationFrame(() => roster.follow());
    },
  };
  const make = id => {
    const m = new Mascot(app, { id });
    m.roster = roster;
    roster.all.push(m);
    if (!m.floating) requestAnimationFrame(() => requestAnimationFrame(() => m.goHome()));
    return m;
  };
  main.roster = roster;
  addEventListener('resize', () => requestAnimationFrame(() => roster.follow()));
  // bring back your friends (and any whose localStorage copy was lost, from IndexedDB)
  (async () => {
    let ids = local.get(LIST, null);
    if (!Array.isArray(ids)) ids = await idb.get(LIST_BACKUP).catch(() => null) ?? [];
    for (const id of ids.slice(0, MAX_PYXLS - 1)) {
      if (typeof id !== 'string' || !/^\w{1,16}$/.test(id)) continue;
      if (!local.get(statsKey(id), null)) {
        const b = await idb.get(backupKey(id)).catch(() => null);
        if (!b?.born) continue;   // nothing left of her
        local.set(statsKey(id), b);
      }
      make(id);
    }
    roster.save();
  })();
  return roster;
}
