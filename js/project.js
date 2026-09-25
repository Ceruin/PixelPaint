import { bus } from './core/bus.js';
import { idb } from './core/storage.js';
import { debounce, download, pickFile, toBlob, makeCanvas } from './core/util.js';
import { Doc } from './engine/document.js';
import { packDoc, unpackDoc, encodeORA, decodeORA } from './engine/serializer.js';
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

  const autosave = debounce(() => saveLocal(true), 2000);
  bus.on('history', autosave);
  addEventListener('visibilitychange', () => document.hidden && saveLocal(true));

  const restore = async () => { const p = await idb.get('autosave'); return p ? unpackDoc(p) : null; };

  async function openFile(f) {
    try {
      if (/\.ora$/i.test(f.name)) {
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
    l.ctx.drawImage(img, (doc.w - w) / 2, (doc.h - h) / 2, w, h);
    doc.touch(l);
    return l;
  }

  async function exportImage(type) {
    let c = flatten(app.doc);
    if (type === 'image/jpeg') {
      const j = makeCanvas(c.width, c.height), ctx = j.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, j.width, j.height); ctx.drawImage(c, 0, 0);
      c = j;
    }
    download(await toBlob(c, type, 0.92), `${app.doc.name}.${type === 'image/jpeg' ? 'jpg' : 'png'}`);
  }

  return {
    saveLocal, restore, openFile, importLayer, exportImage,
    open: async () => { const f = await pickFile('.ora,image/*'); if (f) openFile(f); },
    exportProject: async () => { download(await encodeORA(app.doc), `${app.doc.name}.ora`); bus.emit('saved', { auto: false }); },
  };
}
