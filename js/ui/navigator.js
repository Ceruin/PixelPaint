import { h, iconBtn, slider } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { makeCanvas } from '../core/util.js';
import { idb } from '../core/storage.js';

// Overview / Navigator: live thumbnail with the visible area; drag to pan, sliders for zoom & rotation.
export function navigatorPanel(app) {
  const cv = h('canvas.nav-thumb', { width: 260, height: 160 }), ctx = cv.getContext('2d');
  const zoomToPos = z => Math.log2(z) * 10 + 60, posToZoom = p => 2 ** ((p - 60) / 10);
  const zoom = slider({ label: 'Zoom', min: 0, max: 120, step: 0.5, value: 60, fmt: v => `${Math.round(posToZoom(v) * 100)}%`, onInput: v => app.view.set(posToZoom(v), app.view.rot) });
  const rot = slider({ label: 'Rotation', min: -180, max: 180, value: 0, fmt: v => `${v}°`, onInput: v => app.view.set(app.view.zoom, v) });
  let raf = 0, scale = 1;

  const draw = () => {
    raf = 0;
    const v = app.view, d = app.doc;
    if (!d || !cv.isConnected) return;
    scale = Math.min(cv.width / d.w, cv.height / d.h);
    const w = d.w * scale, ht = d.h * scale, ox = (cv.width - w) / 2, oy = (cv.height - ht) / 2;
    v.compose();
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, w, ht);
    ctx.drawImage(v.comp, ox, oy, w, ht);
    const inv = v.matrix.inverse();
    ctx.beginPath();
    [[0, 0], [v.cw, 0], [v.cw, v.ch], [0, v.ch]].forEach(([x, y], i) => { const p = inv.transformPoint({ x, y }); ctx[i ? 'lineTo' : 'moveTo'](ox + p.x * scale, oy + p.y * scale); });
    ctx.closePath();
    ctx.lineWidth = 2; ctx.strokeStyle = '#5b8cff'; ctx.stroke();
    ctx.fillStyle = 'rgba(91,140,255,.12)'; ctx.fill();
    zoom.set(zoomToPos(v.zoom)); rot.set(Math.round(v.rot));
    cv.dataset.ox = ox; cv.dataset.oy = oy;
  };
  const schedule = () => { raf ||= requestAnimationFrame(draw); };
  const panTo = e => {
    const r = cv.getBoundingClientRect(), k = cv.width / r.width;
    const x = ((e.clientX - r.left) * k - cv.dataset.ox) / scale, y = ((e.clientY - r.top) * k - cv.dataset.oy) / scale;
    app.view.set(app.view.zoom, app.view.rot, app.view.cw / 2, app.view.ch / 2, { x, y });
  };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); panTo(e); cv.onpointermove = ev => ev.buttons && panTo(ev); });
  let timer = 0;
  bus.on('dirty', () => { timer ||= setTimeout(() => { timer = 0; schedule(); }, 200); });
  bus.on('view', schedule); bus.on('doc', schedule); bus.on('panels', schedule);
  return h('div.navigator', {}, cv, zoom.el, rot.el, h('div.row', {},
    iconBtn('fit', 'Fit to screen', () => actions.run('view.fit')),
    iconBtn('expand', 'Actual pixels', () => actions.run('view.actual')),
    iconBtn('mirror', 'Mirror view', () => actions.run('view.flip')),
    iconBtn('undo', 'Reset rotation', () => actions.run('view.resetRot'))));
}

// Reference images (CSP / Krita): an image beside the canvas — load, drop or paste it; zoom and pan
// it (wheel / pinch-free: slider + drag), mirror it, check values in grey, fade it; tap to pick a
// colour. The panel floats, resizes from its corner and can be pinned to stay up in Focus. The image
// is remembered between visits.
export function referencePanel(app) {
  const img = h('img.ref-img', { alt: '', draggable: false }), empty = h('p.muted', {}, 'Load, drop or paste an image to paint from. Tap it to pick a colour; drag to pan.');
  const view = h('div.ref-view', {}, img);
  let zoom = 1, px = 0, py = 0, flip = false, grey = false;
  const apply = () => {
    img.style.transform = `translate(${px}px, ${py}px) scale(${zoom * (flip ? -1 : 1)}, ${zoom})`;
    img.style.filter = grey ? 'grayscale(1)' : '';
  };
  const show = blob => {
    if (!blob?.type?.startsWith('image/')) return;
    img.src = URL.createObjectURL(blob); empty.hidden = true; view.hidden = false; zoom = 1; px = py = 0; apply(); zs.set?.(100);
    idb.set('reference', blob).catch(() => {});
  };
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => show(input.files[0]) });
  const paste = async () => {
    try { for (const it of await navigator.clipboard.read()) { const t = it.types.find(x => x.startsWith('image/')); if (t) return show(await it.getType(t)); } app.toast('No image on the clipboard'); }
    catch { app.toast('Paste with Ctrl+V into the panel, or allow clipboard access'); }
  };
  // tap = pick a colour; drag = pan
  view.addEventListener('pointerdown', e => {
    if (!img.src) return;
    view.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, p0 = [px, py]; let moved = false;
    view.onpointermove = ev => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) moved = true; if (moved) { px = p0[0] + ev.clientX - x0; py = p0[1] + ev.clientY - y0; apply(); } };
    view.onpointerup = ev => {
      view.onpointermove = view.onpointerup = null;
      if (moved) return;
      const r = img.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
      if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return;
      const c = makeCanvas(1, 1), cx = c.getContext('2d');
      cx.drawImage(img, (flip ? 1 - fx : fx) * img.naturalWidth, fy * img.naturalHeight, 1, 1, 0, 0, 1, 1);
      const [R, G, B] = cx.getImageData(0, 0, 1, 1).data;
      app.setColor(`#${[R, G, B].map(v => v.toString(16).padStart(2, '0')).join('')}`);
    };
  });
  view.addEventListener('wheel', e => { if (!img.src) return; e.preventDefault(); zoom = Math.max(0.2, Math.min(8, zoom * Math.exp(-e.deltaY * 0.0015))); apply(); zs.set?.(Math.round(zoom * 100)); }, { passive: false });
  const zs = slider({ label: 'Zoom', min: 20, max: 800, value: 100, fmt: v => `${Math.round(v)}%`, onInput: v => { zoom = v / 100; apply(); } });
  const fade = slider({ label: 'Opacity', min: 10, max: 100, value: 100, fmt: v => `${Math.round(v)}%`, onInput: v => { view.style.opacity = v / 100; } });
  const root = h('div.reference', {
    tabIndex: 0,
    ondragover: e => e.preventDefault(), ondrop: e => { e.preventDefault(); e.stopPropagation(); show(e.dataTransfer.files[0]); },
    onpaste: e => { const f = [...e.clipboardData.files].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); e.stopPropagation(); show(f); } },
  },
    h('div.row.ref-tools', {},
      h('button.btn.sm', { type: 'button', onclick: () => input.click() }, 'Load…'), input,
      iconBtn('paste', 'Paste an image', paste),
      iconBtn('mirror', 'Mirror', () => { flip = !flip; apply(); }),
      iconBtn('eye', 'Grey (check values)', () => { grey = !grey; apply(); }),
      iconBtn('fit', 'Fit', () => { zoom = 1; px = py = 0; apply(); zs.set?.(100); }),
      iconBtn('trash', 'Remove', () => { img.removeAttribute('src'); view.hidden = true; empty.hidden = false; idb.set('reference', null).catch(() => {}); })),
    empty, view, h('div.ref-sliders', {}, zs.el, fade.el));
  view.hidden = true;
  idb.get('reference').then(b => b && show(b)).catch(() => {});
  return root;
}
