import { h, iconBtn, slider } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { makeCanvas } from '../core/util.js';

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

// Reference images (CSP / Krita): pin an image beside the canvas; click it to pick colours.
export function referencePanel(app) {
  const img = h('img.ref-img', { alt: '' }), empty = h('p.muted', {}, 'Drop or load an image to paint from. Click it to pick a color.');
  const load = f => { if (f?.type.startsWith('image/')) { img.src = URL.createObjectURL(f); empty.hidden = true; } };
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => load(input.files[0]) });
  img.addEventListener('click', e => {
    const r = img.getBoundingClientRect(), c = makeCanvas(1, 1), cx = c.getContext('2d');
    cx.drawImage(img, (e.clientX - r.left) * img.naturalWidth / r.width, (e.clientY - r.top) * img.naturalHeight / r.height, 1, 1, 0, 0, 1, 1);
    const [R, G, B] = cx.getImageData(0, 0, 1, 1).data;
    app.setColor(`#${[R, G, B].map(v => v.toString(16).padStart(2, '0')).join('')}`);
  });
  const root = h('div.reference', { ondragover: e => e.preventDefault(), ondrop: e => { e.preventDefault(); e.stopPropagation(); load(e.dataTransfer.files[0]); } },
    h('div.row', {}, h('button.btn.sm', { type: 'button', onclick: () => input.click() }, 'Load image…'), input), empty, img);
  return root;
}
