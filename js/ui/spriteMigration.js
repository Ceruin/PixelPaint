// Sprite Studio has folded into Draw. Once, its things move over: palettes you made join the palette
// list, and every file in its Recent list that it kept a copy of (projects, images, sprite sheets)
// becomes a drawing in My Art. Entries that only pointed at a file on disk are left there (the
// browser won't hand them over without asking; open them with File > Open).
import { local } from '../core/storage.js';
import { actions } from '../core/actions.js';
import { Doc } from '../engine/document.js';
import { decodeSpriteProject } from '../engine/spriteProject.js';

const readRecent = () => new Promise(res => {
  let rq;
  try { rq = indexedDB.open('pixelpaint'); } catch { return res([]); }
  rq.onupgradeneeded = () => { rq.transaction.abort(); };   // no such store: don't create one
  rq.onerror = rq.onblocked = () => res([]);
  rq.onsuccess = () => {
    const db = rq.result;
    if (!db.objectStoreNames.contains('recent')) { db.close(); return res([]); }
    const get = db.transaction('recent', 'readonly').objectStore('recent').getAll();
    get.onsuccess = () => { db.close(); res(get.result ?? []); };
    get.onerror = () => { db.close(); res([]); };
  };
});

async function toDoc(r) {
  if (r.kind === 'project') return decodeSpriteProject(await r.blob.text());
  const img = await createImageBitmap(r.blob), d = new Doc(img.width, img.height, { bg: null });
  Object.assign(d.layers[0], { name: 'Image' }).ctx.drawImage(img, 0, 0);
  d.pixelArt = img.width * img.height <= 512 * 512;
  return d;
}

export async function migrateSpriteStudio(app, library) {
  if (local.get('pp.ssMigrated', false)) return;
  try {
    const mine = JSON.parse(localStorage.getItem('pp_userPalettes') || '{}'), pals = local.get('pp.palettes', {});
    for (const [name, colors] of Object.entries(mine)) if (Array.isArray(colors) && colors.length && !pals[name]) pals[name] = colors.filter(c => /^#[0-9a-f]{6}$/i.test(c));
    local.set('pp.palettes', pals);
  } catch { /* no palettes, or unreadable */ }
  let moved = 0;
  for (const r of (await readRecent()).sort((a, b) => (a.time || 0) - (b.time || 0))) {
    if (!r.blob) continue;
    try {
      const d = await toDoc(r);
      await library.save(r.name.replace(/\.\w+$/, '') || 'Sprite', true, null, d);
      moved++;
    } catch { /* a copy that won't decode stays behind */ }
  }
  local.set('pp.ssMigrated', true);
  if (moved) app.toast(`Sprite Studio is part of Draw now: ${moved} of its recent file${moved > 1 ? 's are' : ' is'} in My Art`, { label: 'Open My Art', run: () => actions.run('file.library') });
}
