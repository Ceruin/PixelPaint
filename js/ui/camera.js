import { h, icon, iconBtn, bar, select, toggle } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { modal, toast } from './dialogs.js';
import { StateCommand } from '../engine/commands.js';
import { FOCUS, EASES, newCamera, defaultDepths, camAt, keyAt, withKey, withoutKey, edited, cameraFor, cameraView, planeOf, frameCorners } from '../engine/camera.js';

// Camera folders in the Draw workspace: turn any folder (or layer) into one, then pan / zoom /
// rotate it, key it on the timeline, and spread its layers out in depth for multiplane parallax.
// The basics show by default; dolly, shake, depth scaling and easing come with Advanced options.

// Several node changes as one undo step: [[node, props], …].
function editMany(doc, label, list) {
  const before = list.map(([n, p]) => [n, Object.fromEntries(Object.keys(p).map(k => [k, n[k]]))]);
  const apply = s => { s.forEach(([n, p]) => Object.assign(n, p)); doc.changed(); };
  apply(list);
  doc.history.push(new StateCommand(label, apply, before, list.map(([n, p]) => [n, { ...p }])));
}

export function initCamera(app) {
  const doc = () => app.doc;
  const cam = () => cameraFor(doc(), doc().active);
  const setCam = (label, g, camera) => doc().editProps(label, g, { camera });

  // Turn the active folder into a camera folder (a layer is wrapped in a new folder first), or back.
  const convert = () => {
    const d = doc();
    let g = cameraFor(d, d.active);
    if (g) return setCam('Remove Camera', g, undefined);
    g = d.active?.type === 'group' ? d.active : null;
    if (!g) { if (!d.active) return; d.addGroup(true); g = d.active; if (g?.type !== 'group') return; }
    const depths = defaultDepths(g.children.length);
    editMany(d, 'Camera Folder', [[g, { camera: newCamera(d), name: /^(Group|Folder)/.test(g.name) ? 'Camera' : g.name }], ...g.children.map((c, i) => [c, { depth: c.depth ?? depths[i] }])]);
    toast('Camera folder — drag on the canvas to move the camera, and key it on the timeline');
  };
  const addKey = () => { const g = cam(); if (g) setCam('Camera Key', g, withKey(g.camera, doc().frame)); };
  const removeKey = () => { const g = cam(); if (g && keyAt(g.camera, doc().frame)) setCam('Remove Camera Key', g, withoutKey(g.camera, doc().frame)); };
  const jumpKey = dir => {
    const g = cam(), f = doc().frame, ks = (g?.camera.keys ?? []).map(k => k.f);
    const to = dir > 0 ? ks.find(k => k > f) : ks.filter(k => k < f).at(-1);
    if (to != null) doc().setFrame(to);
  };
  const toggleView = () => { const g = cam() ?? [...doc().nodes()].find(n => n.camera); if (g) setCam(g.camera.view ? 'Camera View Off' : 'Camera View On', g, { ...g.camera, view: !g.camera.view }); };

  actions.define([
    { id: 'layer.camera', label: 'Camera Folder', icon: 'camera', checked: () => !!cam(), enabled: () => !!doc().active, run: convert },
    { id: 'camera.view', label: 'Look Through Camera', icon: 'eye', key: 'Shift+C', checked: () => !!cameraView(doc()), enabled: () => [...doc().nodes()].some(n => n.camera), run: toggleView },
    { id: 'camera.key', label: 'Camera Key at This Frame', icon: 'camera', key: 'Shift+K', enabled: () => !!cam(), run: addKey },
    { id: 'camera.depths', label: 'Edit Camera Depths…', icon: 'layers', enabled: () => !!cam(), run: () => editDepths(app, cam()) },
  ]);

  // ---- the camera frame on the flat drawing (when not looking through it) ----
  app.view.overlays.add({
    draw(ctx, view) {
      const d = doc();
      if (!d) return;
      for (const g of d.nodes()) {
        if (g.type !== 'group' || !g.camera || !g.visible || g.camera.view) continue;
        const pts = frameCorners(d.w, d.h, g.camera, camAt(g.camera, d.frame), d.frame).map(([x, y]) => view.toScreen(x, y));
        ctx.save(); ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(224,72,90,.9)'; ctx.setLineDash([8, 5]); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = 'rgba(224,72,90,.9)'; ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillText(`📷 ${g.name}`, pts[0].x + 6, pts[0].y + 15);
        ctx.restore();
      }
    },
  });
  const redraw = () => app.view.redraw();
  ['frame', 'layers', 'history', 'doc'].forEach(e => bus.on(e, redraw));

  // ---- dragging on the stage while looking through the camera moves the camera ----
  let hinted = false;
  app.cameraDrag = e => {
    const g = cameraView(doc());
    if (!g) return null;
    if (!hinted) { hinted = true; toast('Looking through the camera: drag to move it (Shift+C to draw again)'); }
    const d = doc(), f = d.frame, start = camAt(g.camera, f), before = g.camera, x0 = e.clientX, y0 = e.clientY;
    return {
      move(ev) {
        const z = app.view.zoom * (start.zoom || 1), r = -(start.rot ?? 0) * Math.PI / 180;
        const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
        // drag the scene: the camera goes the other way (turned with it)
        g.camera = edited(before, f, { x: start.x - (dx * Math.cos(r) - dy * Math.sin(r)), y: start.y - (dx * Math.sin(r) + dy * Math.cos(r)) });
        bus.emit('dirty', d.bounds); bus.emit('camera');
      },
      up() { const after = g.camera; g.camera = before; if (after !== before) setCam('Move Camera', g, after); },
    };
  };

  return { convert, addKey, removeKey, jumpKey };
}

// ---- the camera's controls (in the Layers panel, for a camera folder or one of its planes) ----
export function cameraControls(app) {
  const root = h('div.cam-ctl');
  let busy = false, live = null;
  const doc = () => app.doc;
  const commit = (label, g, before) => { const after = g.camera; g.camera = before; doc().editProps(label, g, { camera: after }); };
  const render = () => {
    if (busy) return;
    const d = doc(), g = d && cameraFor(d, d.active);
    root.hidden = !g;
    if (!g) return root.replaceChildren();
    const c = g.camera, f = d.frame, at = camAt(c, f), key = keyAt(c, f), plane = planeOf(d, g, d.active);
    // a bar edits the camera live; one undo step when you let go
    const camBar = (label, k, o, toUser = v => v, fromUser = v => v) => bar({ ...o, label, value: toUser(at[k]), onInput: v => {
      if (!live) live = c;
      g.camera = edited(live, f, { [k]: fromUser(v) }); busy = true; bus.emit('dirty', d.bounds); busy = false;
    }, onCommit: () => { const before = live; live = null; if (before) commit(`Camera ${label}`, g, before); } }).el;
    const flag = (label, k, tip) => h('button.btn.sm.cam-flag', { type: 'button', className: c[k] ? 'on' : '', 'data-tip': tip, onclick: () => d.editProps(label, g, { camera: { ...c, [k]: !c[k] } }) }, label);
    root.replaceChildren(
      h('div.cam-head', {}, icon('camera'), h('b', {}, g.name), h('span.spacer'),
        flag('View', 'view', 'Look through the camera (Shift+C) — off to draw'), flag('Multiplane', 'multiplane', 'Each layer in the folder is a depth plane: farther ones move less')),
      camBar('Pan X', 'x', { min: -d.w, max: d.w, fmt: v => `${Math.round(v)}px` }, v => v - d.w / 2, v => v + d.w / 2),
      camBar('Pan Y', 'y', { min: -d.h, max: d.h, fmt: v => `${Math.round(v)}px` }, v => v - d.h / 2, v => v + d.h / 2),
      camBar('Zoom', 'zoom', { min: 25, max: 400, fmt: v => `${Math.round(v)}%` }, v => v * 100, v => v / 100),
      camBar('Rotate', 'rot', { min: -180, max: 180, fmt: v => `${Math.round(v)}°` }),
      h('div.adv-only.cam-adv', {},
        camBar('Dolly', 'dolly', { min: -200, max: 90, fmt: v => `${Math.round(v)}` }),
        camBar('Shake', 'shake', { min: 0, max: 40, fmt: v => `${Math.round(v)}px` }),
        h('div.cam-row', {}, toggle('Depth scaling (far = smaller)', !!c.depthScale, v => d.editProps('Depth Scaling', g, { camera: { ...c, depthScale: v } })),
          h('label.field', {}, h('span', {}, 'Easing'), select(EASES, c.ease ?? 'smooth', v => d.editProps('Camera Easing', g, { camera: { ...c, ease: v } }))))),
      h('div.cam-keys', {},
        iconBtn('chevronLeft', 'Previous camera key', () => app.cameraUI.jumpKey(-1)),
        h('button.btn.sm', { type: 'button', className: key ? 'on' : '', 'data-tip': key ? 'Update this frame’s camera key (Shift+K)' : 'Add a camera key at this frame (Shift+K)', onclick: () => app.cameraUI.addKey() }, icon('star'), h('span.lbl', {}, key ? 'Key ✓' : 'Add key')),
        key && iconBtn('x', 'Remove this camera key', () => app.cameraUI.removeKey()),
        iconBtn('chevronRight', 'Next camera key', () => app.cameraUI.jumpKey(1)),
        h('small.muted', {}, `${(c.keys ?? []).length} key${(c.keys ?? []).length === 1 ? '' : 's'}`),
        h('span.spacer'),
        c.multiplane && h('button.btn.sm', { type: 'button', onclick: () => editDepths(app, g) }, icon('layers'), h('span.lbl', {}, 'Depths…'))),
      plane && c.multiplane && bar({ label: `Depth · ${plane.name}`, min: 20, max: 1000, value: plane.depth ?? FOCUS, fmt: v => `${Math.round(v)}${Math.round(v) === FOCUS ? ' (moves with camera)' : ''}`,
        onInput: v => { plane.depth = Math.round(v); busy = true; bus.emit('dirty', d.bounds); busy = false; },
        onCommit: (v, v0) => d.editProps('Plane Depth', plane, { depth: Math.round(v) }, { depth: Math.round(v0) }) }).el,
      !(c.keys ?? []).length && h('p.cam-tip', {}, 'Tip: add a key, go to another frame, move the camera, add another — it glides between them.'));
  };
  ['layers', 'frame', 'history', 'doc', 'camera'].forEach(e => bus.on(e, render));
  render();
  return root;
}

// ---- Edit depths: the planes side-on along one Z axis; drag them nearer or farther ----
export async function editDepths(app, g) {
  if (!g) return;
  const d = app.doc, planes = g.children.filter(n => n.type !== 'filter'), depth = new Map(planes.map(n => [n, n.depth ?? FOCUS]));
  const W = 560, H = 300, Z0 = 50, ZMAX = 900, zx = z => Z0 + (z / ZMAX) * (W - Z0 - 30), xz = x => Math.max(20, Math.min(ZMAX, (x - Z0) / (W - Z0 - 30) * ZMAX));
  const cv = h('canvas.depth-cv', { width: W * 2, height: H * 2 }), ctx = cv.getContext('2d');
  const thumbs = new Map(planes.map(n => {
    const t = document.createElement('canvas'), s = 120 / Math.max(d.w, d.h); Object.assign(t, { width: Math.max(1, Math.round(d.w * s)), height: Math.max(1, Math.round(d.h * s)) });
    const tc = t.getContext('2d'), paint = m => { if (m.type === 'group') m.children.forEach(paint); else if (m.visible && m.view?.()) tc.drawImage(m.view(), 0, 0, t.width, t.height); };
    paint(n); return [n, t];
  }));
  const ph = 150, pw = ph * d.w / Math.max(1, d.h) * 0.55, skew = 0.55;   // planes drawn side-on: squashed and sheared
  const draw = () => {
    ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(128,128,140,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Z0 - 20, H - 40); ctx.lineTo(W - 10, H - 40); ctx.stroke();
    ctx.fillStyle = 'rgba(128,128,140,.9)'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText('near', Z0 - 18, H - 26); ctx.fillText('far', W - 30, H - 26);
    const plane = (x, col, label, img, sel) => {
      const y = H / 2 + 20;
      ctx.save(); ctx.setTransform(2 * skew, -2 * 0.32, 0, 2, 2 * x, 2 * (y - ph / 2));   // a parallelogram leaning back
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(0, 0, pw, ph);
      if (img) { ctx.globalAlpha = 0.9; ctx.drawImage(img, 0, 0, pw, ph); ctx.globalAlpha = 1; }
      ctx.lineWidth = sel ? 2.5 : 1.2; ctx.strokeStyle = col; ctx.strokeRect(0, 0, pw, ph);
      ctx.restore();
      ctx.fillStyle = col; ctx.font = `${sel ? 700 : 500} 11px system-ui, sans-serif`; ctx.fillText(label, x + 4, y - ph / 2 - 8 - pw * 0.32 * 0.55);
    };
    // the camera (red) and the focus plane (dashed), then the planes far to near so near ones sit in front
    ctx.strokeStyle = 'rgba(224,72,90,.5)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(zx(FOCUS), 30); ctx.lineTo(zx(FOCUS), H - 40); ctx.stroke(); ctx.setLineDash([]);
    plane(zx(0), '#e0485a', 'Camera', null, false);
    [...planes].sort((a, b) => depth.get(b) - depth.get(a)).forEach(n => plane(zx(depth.get(n)), n === sel ? '#3b7bff' : '#444', `${n.name} · ${Math.round(depth.get(n))}`, thumbs.get(n), n === sel));
  };
  let sel = null, dragging = null;
  const hit = x => [...planes].sort((a, b) => depth.get(a) - depth.get(b)).find(n => Math.abs(x - (zx(depth.get(n)) + pw * skew / 2)) < pw * skew / 2 + 6);
  const at = e => { const r = cv.getBoundingClientRect(); return (e.clientX - r.left) * W / r.width; };
  cv.addEventListener('pointerdown', e => { const x = at(e); sel = hit(x); if (sel) { dragging = { dx: x - zx(depth.get(sel)) }; cv.setPointerCapture(e.pointerId); } draw(); sync(); });
  cv.addEventListener('pointermove', e => { if (!dragging) return; depth.set(sel, Math.round(xz(at(e) - dragging.dx))); draw(); sync(); });
  cv.addEventListener('pointerup', () => { dragging = null; });
  const rows = h('div.depth-rows');
  const sync = () => rows.replaceChildren(...planes.map(n => h('label.depth-row', { className: n === sel ? 'on' : '' }, h('span', {}, n.name),
    h('input', { type: 'number', min: 20, max: ZMAX, value: Math.round(depth.get(n)), oninput: ev => { depth.set(n, Math.max(20, Math.min(ZMAX, +ev.target.value || FOCUS))); sel = n; draw(); } }))));
  draw(); sync();
  const ok = await modal('Camera depths', [cv, h('p.muted', {}, `Drag the planes along the line. At ${FOCUS} a plane moves with the camera; farther back it moves less, nearer it moves more.`), rows], [['Cancel', null], ['Apply', 'ok', true]], 'depth-modal');
  if (!ok) return;
  const changed = planes.filter(n => depth.get(n) !== (n.depth ?? FOCUS)).map(n => [n, { depth: depth.get(n) }]);
  if (changed.length) editMany(d, 'Camera Depths', changed);
}
