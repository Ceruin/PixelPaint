import { bus } from './core/bus.js';
import { idb } from './core/storage.js';
import { debounce, download, pickFile, toBlob, makeCanvas } from './core/util.js';
import { Doc } from './engine/document.js';
import { packDoc, unpackDoc, encodeORA, decodeORA, encodePP, decodePP } from './engine/serializer.js';
import { flatten } from './engine/compositor.js';
import { haptics } from './input/haptics.js';

// Persistence: IndexedDB autosave (incremental PNG re-encode per layer), OpenRaster projects, image export.
export function createProject(app) {
  const cache = new WeakMap();
  let pending = Promise.resolve();

  const saveLocal = (auto = false) => (pending = pending.then(async () => {
    try {
      await idb.set('autosave', await packDoc(app.doc, cache));
      bus.emit('saved', { auto });
      if (!auto) haptics.success();
    } catch (e) {
      console.warn('save failed', e);
      if (!auto) app.toast('Could not save to this browser');
    }
  }));

  // Autosave when you pause — never mid-stroke, and in idle time, so reading layers back never
  // lands on the start of your next stroke.
  const whenIdle = fn => (app.input?.active != null ? setTimeout(() => whenIdle(fn), 1000) : (window.requestIdleCallback ?? setTimeout)(fn, { timeout: 3000 }));
  const autosave = debounce(() => whenIdle(() => saveLocal(true)), 2500);
  bus.on('history', autosave);
  bus.on('assist', autosave);
  addEventListener('visibilitychange', () => document.hidden && saveLocal(true));

  const restore = async () => { const p = await idb.get('autosave'); return p ? unpackDoc(p) : null; };

  async function openFile(f) {
    try {
      if (/\.pp$/i.test(f.name)) {
        const doc = await decodePP(f);
        doc.name ||= f.name.replace(/\.pp$/i, '');
        app.setDoc(doc);
      } else if (/\.ora$/i.test(f.name)) {
        const doc = await decodeORA(f);
        doc.name = f.name.replace(/\.ora$/i, '');
        app.setDoc(doc);
      } else if (f.type.startsWith('image/')) {
        const img = await createImageBitmap(f), doc = new Doc(img.width, img.height, { bg: null });
        Object.assign(doc.layers[0], { name: 'Background' }).ctx.drawImage(img, 0, 0);
        doc.name = f.name.replace(/\.\w+$/, '');
        app.setDoc(doc);
      } else app.toast('Unsupported file');
    } catch (e) { app.toast(e.message); }
  }

  // Adds an image as a new layer, centred and scaled down to fit.
  async function importLayer(src, name = 'Imported') {
    const img = src instanceof Blob ? await createImageBitmap(src) : src, doc = app.doc;
    const s = Math.min(1, doc.w / img.width, doc.h / img.height), w = img.width * s, h = img.height * s;
    const l = doc.addLayer(name.replace(/\.\w+$/, ''));
    l.ctx.imageSmoothingEnabled = !doc.pixelArt;   // pixel canvases keep hard pixels
    l.ctx.drawImage(img, (doc.w - w) / 2, (doc.h - h) / 2, w, h);
    doc.touch(l);
    return l;
  }

  // Nearest-neighbour enlargement, so exported pixel art stays crisp at any size.
  const scaled = (c, k) => {
    if (k === 1) return c;
    const o = makeCanvas(c.width * k, c.height * k), x = o.getContext('2d');
    x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, o.width, o.height);
    return o;
  };
  async function exportImage(type, scale = 1) {
    let c = scaled(flatten(app.doc), scale);
    if (type === 'image/jpeg') {
      const j = makeCanvas(c.width, c.height), ctx = j.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, j.width, j.height); ctx.drawImage(c, 0, 0);
      c = j;
    }
    download(await toBlob(c, type, 0.92), `${app.doc.name}.${type === 'image/jpeg' ? 'jpg' : 'png'}`);
  }

  // Every frame side by side (or in rows of `cols`), for game engines and sprite tools.
  async function exportSheet(scale = 1, cols = 0) {
    const d = app.doc, n = d.frames.length, c1 = cols || n, rows = Math.ceil(n / c1), sheet = makeCanvas(d.w * c1, d.h * rows), x = sheet.getContext('2d');
    for (let f = 0; f < n; f++) x.drawImage(flatten(d, f), (f % c1) * d.w, Math.floor(f / c1) * d.h);
    download(await toBlob(scaled(sheet, scale), 'image/png'), `${d.name}-sheet.png`);
  }
  // A sprite sheet becomes a new pixel canvas with one frame per cell (left to right, top to bottom).
  async function importSheet(file, fw, fh) {
    const img = await createImageBitmap(file), cols = Math.max(1, Math.floor(img.width / fw)), rows = Math.max(1, Math.floor(img.height / fh));
    const d = new Doc(fw, fh, { bg: null }), l = d.activeLayer;
    d.name = file.name.replace(/\.\w+$/, '');
    d.frames = []; l.cels = [];
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const c = makeCanvas(fw, fh);
      c.getContext('2d').drawImage(img, q * fw, r * fh, fw, fh, 0, 0, fw, fh);
      d.frames.push({ duration: 100 }); l.cels.push(c);
    }
    app.setDoc(d);
    app.setTool('pencil');
    return d;
  }

  // ---- the browser library: named projects kept in this browser (index + one entry per project) ----
  const thumbOf = (w = 240) => { const c = flatten(app.doc), k = Math.min(1, w / c.width, w / c.height), t = makeCanvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k))); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/png'); };
  const library = {
    list: async () => Object.values(await idb.get('library') ?? {}).sort((a, b) => b.date - a.date),
    async save(name = app.doc.name) {
      const index = await idb.get('library') ?? {}, id = app.doc.libId ?? `p${Date.now().toString(36)}`;
      app.doc.libId = id; app.doc.name = name;
      await idb.set(`lib:${id}`, await packDoc(app.doc, cache));
      index[id] = { id, name, date: Date.now(), thumb: thumbOf(), w: app.doc.w, h: app.doc.h };
      await idb.set('library', index);
      saveLocal(false);
      return id;
    },
    async open(id) {
      const pack = await idb.get(`lib:${id}`);
      if (!pack) return app.toast('That project is no longer here');
      const doc = await unpackDoc(pack); doc.libId = id;
      app.setDoc(doc);
    },
    async rename(id, name) { const index = await idb.get('library') ?? {}; if (index[id]) { index[id].name = name; await idb.set('library', index); } if (app.doc.libId === id) app.doc.name = name; },
    async remove(id) { const index = await idb.get('library') ?? {}; delete index[id]; await idb.set('library', index); await idb.del(`lib:${id}`); if (app.doc.libId === id) app.doc.libId = null; },
  };

  // ---- files to share: the finished picture (one merged PNG) and the full project (.pp) ----
  const merged = async () => toBlob(flatten(app.doc), 'image/png');
  const projectFile = async () => new File([await encodePP(app.doc, await merged())], `${app.doc.name || 'painting'}.pp`, { type: 'application/x-pixelpaint' });
  const imageFile = async () => new File([await merged()], `${app.doc.name || 'painting'}.png`, { type: 'image/png' });

  return {
    saveLocal, restore, openFile, importLayer, exportImage, exportSheet, importSheet, library, imageFile, projectFile,
    open: async () => { const f = await pickFile('.pp,.ora,image/*'); if (f) openFile(f); },
    exportProject: async () => { download(await projectFile(), `${app.doc.name || 'painting'}.pp`); bus.emit('saved', { auto: false }); },
    exportOra: async () => download(await encodeORA(app.doc), `${app.doc.name || 'painting'}.ora`),
  };
}
