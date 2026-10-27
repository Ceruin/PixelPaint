// A small, stable scripting interface for AI agents and automation: window.pixelpaint.api (also
// window.PixelPaintAPI). Everything works in picture coordinates (0,0 = top-left pixel) and goes
// through the same tools, layers and undo history a person uses, so every step can be undone.
// /llms.txt describes it for agents that open the site.
import { actions } from './core/actions.js';
import { bus } from './core/bus.js';
import { Doc } from './engine/document.js';
import { flatten } from './engine/compositor.js';
import { BLEND_MODES } from './engine/blend.js';
import { PRESETS } from './engine/presets.js';
import { TOOL_META } from './tools/index.js';
import { applyPreset, userBrushes } from './ui/brushPanel.js';
import { makeCanvas, toBlob } from './core/util.js';

export const API_VERSION = 1;

export function initApi(app) {
  const doc = () => app.doc;
  const fail = msg => { throw new Error(`PixelPaint API: ${msg}`); };
  const hex = c => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c.toLowerCase() : /^#[0-9a-f]{3}$/i.test(c ?? '') ? `#${[...c.slice(1)].map(x => x + x).join('')}`.toLowerCase() : fail(`colours are '#rrggbb', not ${JSON.stringify(c)}`));
  const blendOf = b => (BLEND_MODES.find(([k, l]) => k === b || l.toLowerCase() === String(b).toLowerCase())?.[0] ?? fail(`unknown blend ${JSON.stringify(b)}; one of ${BLEND_MODES.map(m => m[1]).join(', ')}`));
  const layerOf = which => {
    const ls = doc().layers;
    const l = which == null ? doc().activeLayer : typeof which === 'number' ? ls[which] : ls.find(x => x.name === which);
    return l ?? fail(`no layer ${JSON.stringify(which)}`);
  };
  const done = () => { app.view.redraw(); return api.state(); };

  // a gesture through the active tool, as if drawn with a mouse (or pen, when pressures are given)
  const gesture = pts => {
    if (!pts?.length) fail('a stroke needs at least one point');
    const pen = pts.some(p => p.length > 2);
    const pt = ([x, y, p = 1]) => { const s = app.view.toScreen(x, y); return { x, y, p: pen ? p : 1, sx: s.x, sy: s.y, tiltX: 0, tiltY: 0 }; };
    const ev = { button: 0, buttons: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerType: pen ? 'pen' : 'mouse', pointerId: 99, timeStamp: performance.now(), preventDefault() {}, stopPropagation() {} };
    if (app.tool.down(pt(pts[0]), ev) === false) return;
    // recording a timelapse: pictures along the way, so the stroke is seen being drawn (about every 40px)
    const rec = app.timelapse?.recording();
    let travel = 0;
    for (let i = 1; i < pts.length; i++) {
      if (!rec) { app.tool.move([pt(pts[i])], ev); continue; }
      // long straight segments are walked in 40px steps (the same line), a picture at each
      const [x0, y0, p0 = 1] = pts[i - 1], [x1, y1, p1 = 1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 40));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        app.tool.move([pt([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t])], ev);
        travel += Math.hypot(x1 - x0, y1 - y0) / n;
        if (travel >= 40 && (i < pts.length - 1 || k < n)) { travel = 0; app.tool.flush?.(); app.timelapse.live(); }
      }
    }
    app.tool.up(pt(pts.at(-1)), ev);
    doc().strokeClip = null;
  };
  const withOpts = (o = {}) => {
    if (o.tool) api.setTool(o.tool);
    if (o.brush) api.setBrush(o.brush);
    if (o.color) app.setColor(hex(o.color));
    for (const k of ['size', 'opacity', 'flow', 'smoothing']) if (o[k] != null) app.brush[k] = k === 'size' ? +o[k] : Math.max(0, Math.min(1, o[k] > 1 ? o[k] / 100 : o[k]));
    if (o.size != null || o.opacity != null || o.flow != null || o.smoothing != null) app.brushChanged();
  };

  const api = {
    version: API_VERSION,
    help: () => 'See https://pixelpaint.net/llms.txt. Coordinates are picture pixels; every call is undoable with api.undo().',

    // ---- reading
    state() {
      const d = doc(), b = app.brush;
      return {
        name: d.name, width: d.w, height: d.h, pixelArt: !!d.pixelArt, background: d.bg,
        frame: d.frame, frames: d.frames.length,
        tool: app.tool.id, color: app.color.fg, secondColor: app.color.bg,
        brush: { name: b.name, size: b.size, opacity: b.opacity, flow: b.flow },
        layers: d.layers.map((l, i) => ({ index: i, name: l.name, blend: BLEND_MODES.find(m => m[0] === l.blend)?.[1] ?? l.blend, opacity: l.opacity, visible: l.visible, locked: !!l.locked, active: l === d.active })),
        selection: d.selection.active, undo: d.history.done.at(-1)?.label ?? null, redo: d.history.undone.at(-1)?.label ?? null,
        recordingTimelapse: !!app.timelapse?.recording(),
      };
    },
    tools: () => TOOL_META.map(([id, label, key]) => ({ id, label, key })),
    brushes: () => [...PRESETS, ...userBrushes()].map(p => p.name),
    blendModes: () => BLEND_MODES.map(m => m[1]),
    actions: () => actions.all().filter(a => a.label).map(a => ({ id: a.id, label: a.label, key: actions.key?.(a.id) ?? a.key ?? null, enabled: a.enabled?.() !== false, ...(a.checked ? { checked: !!a.checked() } : {}) })),
    // the picture as a PNG data URL; `scale` shrinks or enlarges it (pixel art stays crisp)
    snapshot({ scale = 1, maxSize, type = 'image/png' } = {}) {
      const d = doc(), src = flatten(d);
      const k = maxSize ? Math.min(scale, maxSize / Math.max(d.w, d.h)) : scale;
      if (k === 1) return src.toDataURL(type);
      const c = makeCanvas(Math.max(1, Math.round(d.w * k)), Math.max(1, Math.round(d.h * k))), x = c.getContext('2d');
      x.imageSmoothingEnabled = !d.pixelArt; x.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL(type);
    },
    exportBlob: (type = 'image/png') => toBlob(flatten(doc()), type),
    // the colour at a pixel, as the picture shows it
    pixel(x, y) { const d = flatten(doc()).getContext('2d').getImageData(x | 0, y | 0, 1, 1).data; return { color: `#${[d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`, alpha: d[3] / 255 }; },

    // ---- documents
    newCanvas(width, height, { background = 'white', pixelArt = false, name } = {}) {
      if (!(width > 0 && height > 0 && width <= 16384 && height <= 16384)) fail('width and height must be 1–16384');
      const bg = background === 'transparent' || background == null ? null : background === 'white' ? '#ffffff' : hex(background);
      const d = new Doc(Math.round(width), Math.round(height), { bg });
      d.pixelArt = pixelArt; if (name) d.name = name;
      app.setDoc(d);
      if (pixelArt) app.setTool('pencil');
      return done();
    },
    run(id) { if (!actions.get(id)) fail(`no action ${JSON.stringify(id)}; see api.actions()`); actions.run(id); return api.state(); },
    undo: () => { actions.run('edit.undo'); return done(); },
    redo: () => { actions.run('edit.redo'); return done(); },

    // ---- tools, colour, brush
    setTool(id) { if (!app.tools[id]) fail(`no tool ${JSON.stringify(id)}; see api.tools()`); app.setTool(id); return api.state(); },
    setColor(c, which = 'fg') { app.setColor(hex(c), which === 'bg' || which === 'second' ? 'bg' : 'fg'); return api.state(); },
    setBrush(nameOrProps) {
      if (typeof nameOrProps === 'string') {
        const p = [...PRESETS, ...userBrushes()].find(b => b.name.toLowerCase() === nameOrProps.toLowerCase()) ?? fail(`no brush ${JSON.stringify(nameOrProps)}; see api.brushes()`);
        applyPreset(app, p);
      } else withOpts(nameOrProps);
      return api.state();
    },
    setOption(key, value) { app.setOpt(key, value); return api.state(); },

    // ---- drawing
    // points: [[x, y], …] or [[x, y, pressure 0–1], …]; options: { tool, brush, color, size, opacity, flow }
    stroke(points, o = {}) {
      withOpts(o);
      if (!o.tool && !['brush', 'eraser', 'smudge', 'pencil'].includes(app.tool.id)) app.setTool(doc().pixelArt ? 'pencil' : 'brush');
      gesture(points);
      return done();
    },
    // a tap with any tool (fill bucket, eyedropper, text…)
    click(x, y, o = {}) { withOpts(o); gesture([[x, y]]); return done(); },
    // a drag with any tool (a shape, a gradient, a move…)
    drag(x0, y0, x1, y1, o = {}) { withOpts(o); gesture([[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2], [x1, y1]]); return done(); },
    fill(x, y, { color, tolerance, contiguous } = {}) {
      if (color) app.setColor(hex(color));
      if (tolerance != null) app.setOpt('tolerance', tolerance);
      if (contiguous != null) app.setOpt('contiguous', contiguous);
      app.setTool('fill'); app.tools.fill.pending = null; gesture([[x, y]]);
      return Promise.resolve(app.tools.fill.pending).then(done);
    },

    // ---- selections (mode: 'replace' | 'add' | 'subtract')
    selectRect(x, y, w, h, mode = 'replace') { doc().selection.apply('Rectangle Select', modeOf(mode), c => c.fillRect(x, y, w, h)); return done(); },
    selectEllipse(cx, cy, rx, ry, mode = 'replace') { doc().selection.apply('Ellipse Select', modeOf(mode), c => { c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill(); }); return done(); },
    selectPolygon(points, mode = 'replace') { if (points?.length < 3) fail('a polygon needs 3 or more points'); doc().selection.apply('Lasso', modeOf(mode), c => { c.beginPath(); points.forEach(([x, y]) => c.lineTo(x, y)); c.closePath(); c.fill(); }); return done(); },
    selectAll: () => { actions.run('sel.all'); return done(); },
    deselect: () => { actions.run('sel.none'); return done(); },
    // fills the selection (or the whole layer) with a colour; clearSelection erases it
    fillSelection(color) { if (color) app.setColor(hex(color)); actions.run('edit.fill'); return done(); },
    clearSelection: () => { actions.run('edit.clear'); return done(); },

    // ---- layers
    addLayer(name, { blend, opacity, visible } = {}) {
      const l = doc().addLayer(name);
      if (blend != null || opacity != null || visible != null) api.setLayer(l.name, { blend, opacity, visible });
      bus.emit('layers'); return done();
    },
    // pick the layer to draw on (by name or index) and optionally change it
    setLayer(which, { name, blend, opacity, visible, locked } = {}) {
      const l = layerOf(which), props = {};
      doc().setActive(l);
      if (name != null) props.name = String(name);
      if (blend != null) props.blend = blendOf(blend);
      if (opacity != null) props.opacity = Math.max(0, Math.min(1, opacity > 1 ? opacity / 100 : opacity));
      if (visible != null) props.visible = !!visible;
      if (locked != null) props.locked = !!locked;
      if (Object.keys(props).length) doc().editProps('Layer Properties', l, props);
      bus.emit('layers'); return done();
    },
    deleteLayer(which) { doc().setActive(layerOf(which)); actions.run('layer.del'); return done(); },
  };
  const modeOf = m => (m === 'add' ? 'add' : m === 'subtract' || m === 'sub' ? 'sub' : m === 'replace' ? 'replace' : fail(`selection mode is 'replace', 'add' or 'subtract'`));
  return api;
}
