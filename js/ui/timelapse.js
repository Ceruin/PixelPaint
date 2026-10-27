// Timelapse: while a drawing is recording, a small picture of it is kept after every change (each
// stroke, fill, move…) in the browser's storage, next to the drawing. Stopping, or closing the drawing,
// keeps it; the player shows it back at any length and saves it as a video.
// Strokes are recorded as they are drawn too: a few times a second while the pen is down.
// Storage: `tl:<id>` = { keys, w, h, start, last } and one image per snapshot under its key.
import { h, icon } from './dom.js';
import { modal, toast } from './dialogs.js';
import { bus } from '../core/bus.js';
import { idb } from '../core/storage.js';
import { makeCanvas, download, toBlob } from '../core/util.js';
import { flatten } from '../engine/compositor.js';

const LONG = 1280;     // a snapshot's longest side (pixel art is enlarged by whole pixels up to about this)
const MAX = 5000;      // snapshots kept; past this every other one is dropped, so long sessions still fit
const BACKLOG = 384 * 2 ** 20;   // bytes of pictures waiting to be stored; past this a burst of changes is merged

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// the picture as it looks now, small enough to keep hundreds of
function snapshot(d, previews) {
  const src = flatten(d, d.frame, { previews }), pixel = d.pixelArt;
  let k = LONG / Math.max(d.w, d.h);
  if (pixel) k = Math.max(1, Math.floor(k));
  else k = Math.min(1, k);
  const w = Math.max(1, Math.round(d.w * k)), hh = Math.max(1, Math.round(d.h * k));
  const c = makeCanvas(w, hh), x = c.getContext('2d');
  if (!d.bg) { x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); }   // transparent shows as paper in a video
  x.imageSmoothingEnabled = !pixel; x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, hh);
  return c;
}

export function initTimelapse(app) {
  let queue = Promise.resolve(), waiting = 0, lastSig = null;
  const on = d => !!d?.timelapse?.on;
  // one write at a time, in order
  const later = fn => (queue = queue.then(fn).catch(e => console.warn('timelapse', e)));
  // each recording's index stays in memory while recording, and is written every few snapshots
  const indexes = new Map(), indexOf = async id => { if (!indexes.has(id)) indexes.set(id, await idb.get(`tl:${id}`) ?? { keys: [], start: Date.now() }); return indexes.get(id); };

  // The picture is copied the moment it changes and encoded straight away (the browser does that off
  // the main thread, several at once); storing happens in the background, in order. Scripts can make
  // dozens of changes a second: only if the pictures waiting pass BACKLOG are changes merged.
  const capture = (d, live) => {
    if (waiting >= BACKLOG) return;
    // a stroke's preview is filled from its layer only where it was painted: the rest is filled first
    if (live) for (const pv of app.view.previews.values()) pv.ensure?.(d.bounds);
    const id = d.timelapse.id, c = snapshot(d, live ? app.view.previews : null), bytes = c.width * c.height * 4;
    waiting += bytes;
    const blob = toBlob(c, 'image/webp', 0.85).then(b => b ?? toBlob(c, 'image/png')).finally(() => { waiting -= bytes; });
    later(async () => {
      const idx = await indexOf(id), b = await blob;
      const key = `tl:${id}:${(idx.n = (idx.n ?? 0) + 1)}`;
      await idb.set(key, b);
      idx.keys.push(key); Object.assign(idx, { w: c.width, h: c.height, last: Date.now() });
      if (idx.keys.length > MAX) {   // thin out: keep every other one (and always the newest)
        const drop = new Set(idx.keys.filter((_, i) => i % 2 === 1 && i < idx.keys.length - 1));
        idx.keys = idx.keys.filter(k => !drop.has(k));
        for (const k of drop) await idb.del(k);
      }
      if (idx.n % 8 === 0 || waiting === 0) await idb.set(`tl:${id}`, idx);
    });
  };
  // the index is written whenever the queue empties, so a closed tab loses at most a few snapshots
  const flush = () => later(async () => { for (const [id, idx] of indexes) await idb.set(`tl:${id}`, idx); });

  // after every change to the drawing in front (each stroke, fill, move…)
  const changed = () => {
    const d = app.doc;
    if (!on(d)) return;
    const top = d.history.done.at(-1), sig = `${d.history.done.length}|${top?.label}`;
    if (top === lastSig?.top && sig === lastSig?.sig) return;
    lastSig = { top, sig };
    capture(d);
  };
  bus.on('history', changed);
  bus.on('doc', d => { lastSig = { top: d.history.done.at(-1), sig: `${d.history.done.length}|${d.history.done.at(-1)?.label}` }; bus.emit('timelapse', d); });

  // mid-stroke: while a stroke is being drawn (its paint still in the view's preview), every LIVE ms
  const LIVE = 150;
  setInterval(() => { if (on(app.doc) && app.view.previews.size) capture(app.doc, true); }, LIVE);

  // closing a recording drawing: what was recorded is kept, and can be watched straight away
  bus.on('docLeave', d => setTimeout(() => {
    if (!on(d) || app.docs.includes(d)) return;
    capture(d);
    toast({ msg: 'Timelapse saved', action: { label: 'Watch', run: () => play(d.timelapse.id, d.name) } });
  }, 0));

  const start = () => {
    const d = app.doc;
    d.timelapse = { id: d.timelapse?.id ?? newId(), on: true };
    capture(d);
    bus.emit('timelapse', d);
    toast('Recording a timelapse: every change is kept. Stop it from File or the status bar');
  };
  const stop = async () => {
    const d = app.doc;
    if (!on(d)) return;
    capture(d);
    d.timelapse.on = false;
    bus.emit('timelapse', d);
    await queue;
    play(d.timelapse.id, d.name);
  };
  const play = (id, name) => flush().then(() => player(id, name ?? app.doc.name, () => { indexes.delete(id); if (app.doc.timelapse?.id === id) { app.doc.timelapse = null; bus.emit('timelapse', app.doc); } }));
  return {
    recording: () => on(app.doc),
    has: () => !!app.doc.timelapse?.id,
    toggle: () => (on(app.doc) ? stop() : start()),
    // a scripted stroke happens all at once: the API calls this as it goes, for the in-between pictures
    live: () => { if (on(app.doc) && app.view.previews.size) capture(app.doc, true); },
    watch: () => app.doc.timelapse?.id ? play(app.doc.timelapse.id) : toast('This drawing has no timelapse yet'),
  };
}

// ---------------------------------------------------------------------------------------- the player
// every snapshot is always shown: a length is a target, stretched if the snapshots would pass FPS a second
const LENGTHS = [[10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']];
const FPS = 60;

async function player(id, name, onDelete) {
  const idx = await idb.get(`tl:${id}`);
  if (!idx?.keys.length) return toast('Nothing recorded yet: draw something while recording');
  const N = idx.keys.length, cache = new Map();
  // snapshots are decoded on demand, a few kept
  const frame = async i => {
    let b = cache.get(i);
    if (!b) {
      const blob = await idb.get(idx.keys[i]);
      b = blob ? await createImageBitmap(blob) : null;
      cache.set(i, b);
      if (cache.size > 48) { const [k, v] = cache.entries().next().value; v?.close?.(); cache.delete(k); }
    }
    return b;
  };
  let length = 30, hold = true, playing = false, pos = 0, raf = 0;
  // which snapshot each shown frame is, and how long each is on screen
  const plan = () => ({ seq: Array.from({ length: N }, (_, k) => k), ms: Math.min(250, Math.max(1000 / FPS, length * 1000 / N)) });
  const cv = h('canvas.tl-view', { width: idx.w, height: idx.h }), ctx = cv.getContext('2d');
  const show = async i => { const b = await frame(i); if (b) { ctx.drawImage(b, 0, 0, cv.width, cv.height); } };
  const scrub = h('input.tl-scrub', { type: 'range', min: 0, max: N - 1, value: N - 1, 'aria-label': 'Position', oninput: () => { pause(); show(+scrub.value); } });
  const playB = h('button.btn.tl-play', { type: 'button', onclick: () => (playing ? pause() : run()) });
  const setPlay = () => playB.replaceChildren(icon(playing ? 'pause' : 'play'), playing ? 'Pause' : 'Play');
  const pause = () => { playing = false; cancelAnimationFrame(raf); setPlay(); };
  const run = () => {
    const { seq, ms } = plan();
    if (pos >= seq.length - 1) pos = 0;
    playing = true; setPlay();
    let t0 = performance.now() - pos * ms, cur = -1;
    const tick = async now => {
      if (!playing) return;
      const k = Math.floor((now - t0) / ms);
      if (k >= seq.length) {
        if (hold && now - t0 < seq.length * ms + 1500) { raf = requestAnimationFrame(tick); return; }
        pos = 0; cur = -1; t0 = now;
      } else if (k !== cur) { pos = cur = k; scrub.value = seq[k]; await show(seq[k]); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const lenSel = h('select', { onchange: () => { length = +lenSel.value; pos = 0; info(); } }, LENGTHS.map(([v, l]) => h('option', { value: v, selected: v === length }, l)));
  const holdT = h('input', { type: 'checkbox', checked: hold, onchange: () => { hold = holdT.checked; } });
  const span = (idx.last ?? Date.now()) - (idx.start ?? Date.now()), mins = Math.max(1, Math.round(span / 60000));
  const infoEl = h('span.muted');
  const info = () => { const { seq, ms } = plan(); infoEl.textContent = `${N} snapshots over ${mins < 60 ? `${mins} min` : `${(mins / 60).toFixed(1)} h`} · plays in ${Math.round(seq.length * ms / 1000)} s`; };
  info();

  // the export: a video (MP4 where the browser can make one, else WebM) with every snapshot in it
  const busy = (b, fn) => async () => { const label = b.textContent; b.disabled = true; pause(); try { await fn(t => { b.textContent = t; }); } catch (e) { toast(`Couldn't make it: ${e.message}`); } b.disabled = false; b.textContent = label; };
  const vidB = h('button.btn', { type: 'button' }, 'Save Video');
  vidB.onclick = busy(vidB, async say => {
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(t => window.MediaRecorder?.isTypeSupported(t));
    if (!type) throw new Error('this browser can\'t record video');
    const { seq, ms } = plan();
    // even sizes: video encoders want them
    const c = makeCanvas(idx.w & ~1, idx.h & ~1), x = c.getContext('2d');
    // a frame is sent exactly when each snapshot is drawn, so none is dropped or doubled
    const stream = c.captureStream(0), track = stream.getVideoTracks()[0], chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => { rec.onstop = r; });
    const draw = async i => { const b = await frame(i); if (b) x.drawImage(b, 0, 0, c.width, c.height); track.requestFrame?.(); };
    await draw(seq[0]); rec.start();
    const t0 = performance.now();
    for (let k = 0; k < seq.length; k++) {
      await draw(seq[k]); frame(seq[k + 1] ?? seq[k]);   // the next one decodes while this one shows
      say(`Recording… ${Math.round(k / seq.length * 100)}%`);
      const wait = t0 + (k + 1) * ms - performance.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    if (hold) for (let t = 0; t < 1500; t += 100) { track.requestFrame?.(); await new Promise(r => setTimeout(r, 100)); }
    rec.stop(); await done;
    download(new Blob(chunks, { type: type.split(';')[0] }), `${name || 'drawing'} timelapse.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  });
  setPlay(); show(N - 1);
  const body = h('div.tl-player', {},
    h('div.tl-stage', {}, cv),
    h('div.tl-ctl', {}, playB, scrub),
    h('div.tl-opts', {}, h('label.inline', {}, h('span', {}, 'Length'), lenSel), h('label.inline', {}, holdT, h('span', {}, 'Hold the finished picture')), infoEl),
    h('div.tl-opts', {}, vidB));
  setTimeout(run, 300);
  const v = await modal(`Timelapse: ${name || 'drawing'}`, body, [['Delete Timelapse', 'del', 'danger'], ['Close', null, true]], 'tl-modal');
  pause(); cache.forEach(b => b?.close?.());
  if (v === 'del' && await modal('Delete this timelapse?', h('p', {}, 'The drawing stays; only the recording goes.'), [['Cancel', null], ['Delete', 'ok', 'danger']])) {
    for (const k of idx.keys) await idb.del(k);
    await idb.del(`tl:${id}`);
    onDelete?.();
    toast('Timelapse deleted');
  }
}
