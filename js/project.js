import { bus } from './core/bus.js';
import { idb, local } from './core/storage.js';
import { debounce, download, pickFile, toBlob, makeCanvas } from './core/util.js';
import { Doc } from './engine/document.js';
import { packDoc, unpackDoc, encodeORA, decodeORA, encodePP, decodePP } from './engine/serializer.js';
import { flatten } from './engine/compositor.js';
import { encodeAseprite, decodeAseprite } from './engine/aseprite.js';
import { decodeSpriteProject, isSpriteProject } from './engine/spriteProject.js';
import { palette } from './ui/paletteStore.js';
import { haptics } from './input/haptics.js';
import { encodePSD } from './engine/psd.js';

// Persistence: IndexedDB autosave (incremental PNG re-encode per layer), OpenRaster projects, image export.
export function createProject(app) {
  const cache = new WeakMap();
  let pending = Promise.resolve();

  const saveLocal = (auto = false) => (pending = pending.then(async () => {
    try {
      await idb.set('autosave', { ...(await packDoc(app.doc, cache)), handle: app.doc.fileHandle ?? null });
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
  // Like Notes, a painting you've worked on keeps itself in My Art (a blank canvas doesn't).
  // Each step waits for its own idle slot, and the merged picture is made once: one long task here was a dropped frame or several.
  const idle = () => new Promise(r => whenIdle(r));
  const autosave = debounce(() => whenIdle(async () => {
    await saveLocal(true); await idle();
    const flat = flatten(app.doc);
    if (app.doc.libId || !isBlank(flat)) { await idle(); library.save(app.doc.name, true, flat); }   // once it's in My Art it stays: no need to read every pixel back each time
  }), 2500);
  bus.on('history', autosave);
  // Tabs: a drawing you leave or close is kept in My Art (if anything was drawn), and the set of open
  // tabs comes back next time (the active one from the autosave, the others from My Art).
  bus.on('docLeave', d => { if (d.history.done.length && (d.libId || !isBlank(flatten(d)))) library.save(d.name, true, null, d).then(rememberTabs); });
  const lastTabs = local.get('pp.tabs', {});   // read before the first setDoc rewrites it
  const rememberTabs = () => local.set('pp.tabs', { ids: app.docs.map(d => d.libId ?? null), active: app.docs.indexOf(app.doc) });
  bus.on('tabs', rememberTabs); bus.on('saved', rememberTabs);
  bus.on('docLeave', () => whenIdle(() => saveLocal(true)));   // the autosave follows the tab you're on
  const restoreTabs = async () => {
    const { ids = [], active = 0 } = lastTabs, here = app.doc;
    const docs = [];
    for (const [i, id] of ids.entries()) {
      if (i === active || !id || id === here.libId) { docs.push(here); continue; }
      const pack = await idb.get(`lib:${id}`).catch(() => null), d = pack && await withHandle(pack).catch(() => null);
      if (d) { d.libId = id; docs.push(d); }
    }
    if (!docs.includes(here)) docs.unshift(here);
    app.docs.splice(0, app.docs.length, ...new Set(docs));
    bus.emit('tabs', app.docs);
  };
  bus.on('assist', autosave);
  addEventListener('visibilitychange', () => document.hidden && saveLocal(true));

  // the file link comes back too (the browser asks again before the first write)
  const withHandle = async p => { const d = await unpackDoc(p); if (p.handle) Object.assign(d, { fileHandle: p.handle, fileClean: null }); return d; };
  const restore = async () => { const p = await idb.get('autosave'); return p ? withHandle(p) : null; };

  // Reads a file into a new drawing. `handle` (a FileSystemFileHandle, when the browser gives one): the
  // file on disk the drawing came from, which Save writes back to.
  async function openFile(f, handle = null) {
    try {
      let doc, pal = null;
      if (/\.pp$/i.test(f.name)) { doc = await decodePP(f); doc.name ||= f.name.replace(/\.pp$/i, ''); }
      else if (/\.ase(prite)?$/i.test(f.name)) ({ doc, palette: pal } = await decodeAseprite(await f.arrayBuffer()));
      else if (isSpriteProject(f)) doc = await decodeSpriteProject(await f.text());
      else if (/\.ora$/i.test(f.name)) doc = await decodeORA(f);
      else if (f.type.startsWith('image/')) {
        const img = await createImageBitmap(f);
        doc = new Doc(img.width, img.height, { bg: null });
        Object.assign(doc.layers[0], { name: 'Background' }).ctx.drawImage(img, 0, 0);
      } else return app.toast('Unsupported file');
      if (!/\.pp$/i.test(f.name)) doc.name = f.name.replace(/\.\w+$/, '');
      // .pxpaint can't be written back: Save asks where to keep it instead
      if (handle && !isSpriteProject(f)) doc.fileHandle = handle;
      doc.fileClean = null;
      app.setDoc(doc);
      if (pal?.length) { palette.load(pal); app.toast(`Opened with its ${pal.length}-colour palette`); }
      return doc;
    } catch (e) { app.toast(e.message); }
  }

  // ---- files on your computer (File System Access: Chrome, Edge, Opera; elsewhere Open reads and Save downloads) ----
  const TYPES = {
    pp: { description: 'PixelPaint project (layers, frames, everything)', accept: { 'application/x-pixelpaint': ['.pp'] } },
    png: { description: 'PNG image (flat)', accept: { 'image/png': ['.png'] } },
    jpg: { description: 'JPEG image (flat)', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
    aseprite: { description: 'Aseprite sprite', accept: { 'application/octet-stream': ['.aseprite', '.ase'] } },
    ora: { description: 'OpenRaster (Krita, GIMP, MyPaint)', accept: { 'image/openraster': ['.ora'] } },
    psd: { description: 'Photoshop document', accept: { 'image/vnd.adobe.photoshop': ['.psd'] } },
  };
  const canPick = typeof showSaveFilePicker === 'function' && typeof showOpenFilePicker === 'function';
  const extOf = name => { const e = (name.match(/\.(\w+)$/)?.[1] ?? '').toLowerCase(); return e === 'jpeg' ? 'jpg' : e === 'ase' ? 'aseprite' : e; };
  const flatTypes = new Set(['png', 'jpg']);
  async function encodeAs(ext, d) {
    if (ext === 'pp') return encodePP(d, await toBlob(flatten(d), 'image/png'));
    if (ext === 'png') return toBlob(flatten(d), 'image/png');
    if (ext === 'jpg') { const c = makeCanvas(d.w, d.h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); x.drawImage(flatten(d), 0, 0); return toBlob(c, 'image/jpeg', 0.92); }
    if (ext === 'aseprite') return encodeAseprite(d, palette.colors);
    if (ext === 'ora') return encodeORA(d);
    if (ext === 'psd') return encodePSD(d);
    throw new Error(`Can't save .${ext} files`);
  }
  const markClean = d => { d.fileClean = d.history.done.at(-1) ?? null; bus.emit('saved', { auto: false, file: true }); };
  const writeTo = async (handle, d) => {
    if ((await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('PixelPaint wasn’t allowed to write that file');
    const ext = extOf(handle.name), blob = await encodeAs(ext, d), w = await handle.createWritable();
    await w.write(blob); await w.close();
    markClean(d);
    return ext;
  };
  const files = {
    canPick,
    unsaved: d => !!d?.fileHandle && (d.history.done.at(-1) ?? null) !== d.fileClean,
    async open() {
      if (!canPick) { const f = await pickFile('.pp,.ora,.aseprite,.ase,.pxpaint,image/*'); return f && openFile(f); }
      let handle;
      try { [handle] = await showOpenFilePicker({ id: 'pixelpaint', types: [{ description: 'Drawings and images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'], 'application/octet-stream': ['.pp', '.ora', '.aseprite', '.ase', '.pxpaint'] } }] }); } catch { return; }   // cancelled
      return openFile(await handle.getFile(), handle);
    },
    // Save: back to the drawing's file; without one, Save As (or, where the browser can't, the old keep-in-browser save)
    async save(d = app.doc) {
      if (!d.fileHandle) return canPick ? files.saveAs(d) : null;
      try {
        const ext = await writeTo(d.fileHandle, d);
        app.toast(flatTypes.has(ext) && (d.layers.length > 1 || d.frames.length > 1) ? `Saved ${d.fileHandle.name} (flattened: your layers stay here and in My Art)` : `Saved ${d.fileHandle.name}`);
        return true;
      } catch (e) { app.toast(e.message); return false; }
    },
    async saveAs(d = app.doc) {
      const now = d.fileHandle ? extOf(d.fileHandle.name) : 'pp', order = [now, ...Object.keys(TYPES).filter(k => k !== now)].filter(k => TYPES[k]);
      let handle;
      try { handle = await showSaveFilePicker({ id: 'pixelpaint', suggestedName: `${d.name || 'painting'}.${now in TYPES ? now : 'pp'}`, types: order.map(k => TYPES[k]) }); } catch { return false; }
      d.fileHandle = handle; d.name = handle.name.replace(/\.\w+$/, '');
      const ok = await files.save(d);
      bus.emit('doc', d);
      return ok;
    },
  };

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
  // Blank = every pixel of the merged picture the same (an empty or plain-coloured canvas).
  // Checked on a 64px copy (scaled on the GPU): reading back 16 KB instead of the whole picture keeps it inside one frame.
  const isBlank = (c = flatten(app.doc)) => { const k = Math.min(1, 64 / c.width, 64 / c.height), t = makeCanvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k))), x = t.getContext('2d'); x.drawImage(c, 0, 0, t.width, t.height); const d = new Uint32Array(x.getImageData(0, 0, t.width, t.height).data.buffer); return d.every(v => v === d[0]); };
  // a small picture (pixel art) is enlarged by whole pixels, so its thumbnail stays crisp
  const thumbOf = (w = 240, c = flatten(app.doc)) => { const f = Math.min(w / c.width, w / c.height), k = f >= 2 ? Math.floor(f) : Math.min(1, f), t = makeCanvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k))), x = t.getContext('2d'); x.imageSmoothingEnabled = k < 1; x.drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/png'); };
  const library = {
    list: async () => Object.values(await idb.get('library') ?? {}).sort((a, b) => b.date - a.date),
    // `d`: any open drawing (a tab being left is saved after the next one is showing)
    async save(name = app.doc.name, auto = false, flat = null, d = app.doc) {
      const index = await idb.get('library') ?? {}, id = d.libId ?? `p${Date.now().toString(36)}`;
      d.libId = id; d.name = name;
      await idb.set(`lib:${id}`, { ...(await packDoc(d, cache)), handle: d.fileHandle ?? null });
      index[id] = { id, name, date: Date.now(), thumb: thumbOf(240, flat ?? flatten(d)), w: d.w, h: d.h };
      await idb.set('library', index);
      if (!auto) saveLocal(false);
      return id;
    },
    async open(id) {
      const open = app.docs.find(d => d.libId === id);
      if (open) return app.setDoc(open);   // already a tab: go to it
      const pack = await idb.get(`lib:${id}`);
      if (!pack) return app.toast('That project is no longer here');
      const doc = await withHandle(pack); doc.libId = id;
      app.setDoc(doc);
    },
    async rename(id, name) { const index = await idb.get('library') ?? {}; if (index[id]) { index[id].name = name; await idb.set('library', index); } if (app.doc.libId === id) app.doc.name = name; },
    async update(id, patch) { const index = await idb.get('library') ?? {}; if (index[id]) { Object.assign(index[id], patch); await idb.set('library', index); } },
    async remove(id) { const index = await idb.get('library') ?? {}; delete index[id]; await idb.set('library', index); await idb.del(`lib:${id}`); if (app.doc.libId === id) app.doc.libId = null; },
  };

  // ---- files to share: the finished picture (one merged PNG) and the full project (.pp) ----
  const exportAseprite = async () => {
    if (typeof CompressionStream === 'undefined') return app.toast('This browser can\'t write Aseprite files (try a current Chrome, Edge, Firefox or Safari)');
    download(await encodeAseprite(app.doc, palette.colors), `${app.doc.name || 'sprite'}.aseprite`);
  };
  const merged = async () => toBlob(flatten(app.doc), 'image/png');
  const projectFile = async () => new File([await encodePP(app.doc, await merged())], `${app.doc.name || 'painting'}.pp`, { type: 'application/x-pixelpaint' });
  const imageFile = async () => new File([await merged()], `${app.doc.name || 'painting'}.png`, { type: 'image/png' });

  return {
    saveLocal, restore, restoreTabs, openFile, importLayer, exportAseprite, exportImage, exportSheet, importSheet, library, imageFile, projectFile,
    open: files.open, files,
    exportProject: async () => { download(await projectFile(), `${app.doc.name || 'painting'}.pp`); bus.emit('saved', { auto: false }); },
    exportOra: async () => download(await encodeORA(app.doc), `${app.doc.name || 'painting'}.ora`),
  };
}
