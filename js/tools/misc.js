import { toolCursor } from '../ui/cursors.js';
import { floodMask, edgeRing, maskToCanvas } from '../engine/flood.js';
import { makeCanvas } from '../core/util.js';
import { hexToU32 } from '../core/color.js';
import { haptics } from '../input/haptics.js';
import { h } from '../ui/dom.js';

// Returns the pixels a fill/wand should sample: the merged image or the active layer.
export function sampleSource(app) {
  const { doc, view, opts } = app;
  if (opts.sampleAll || !doc.activeLayer) { view.compose(); return view.comp; }
  return doc.activeLayer.view() ?? makeCanvas(doc.w, doc.h);
}

export function regionMask(app, p, rgba = 0xffffffff) {
  const { doc, opts } = app, x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return null;
  const img = sampleSource(app).getContext('2d').getImageData(0, 0, doc.w, doc.h);
  return maskToCanvas(floodMask(img, x, y, opts.tolerance, opts.contiguous), doc.w, doc.h, rgba);
}

export class FillTool {
  constructor(app) { Object.assign(this, { app, id: 'fill', cursor: toolCursor('fill') }); }
  down(p) {
    const { app } = this, { doc } = app, layer = doc.activeLayer;
    if (!layer || layer.locked) { app.toast('Select an unlocked layer'); return false; }
    const { opts } = app, { w, h } = doc, x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    // a pixel canvas fills exact colours with hard edges; a painting closes small gaps in the line
    // art and tucks the fill under its soft edges
    const soft = !doc.pixelArt, img = sampleSource(app).getContext('2d').getImageData(0, 0, w, h), rgba = hexToU32(app.color.fg);
    const core = floodMask(img, x, y, soft ? opts.tolerance : 0, opts.contiguous, soft);
    const src = layer.view(), under = src && src.getContext('2d').getImageData(0, 0, w, h).data;
    const fill = maskToCanvas(core, w, h, rgba);
    // the ring goes under see-through paint and is multiplied into opaque paint (where under-painting
    // can't show), so a dark line stays dark and its pale rim takes the fill colour
    let underRing = null, overRing = null;
    if (soft && !layer.alphaLock) {
      const ring = edgeRing(core, img, y * w + x, under), opaque = new Uint8Array(ring.length);
      for (let i = 0; i < ring.length; i++) if (ring[i] && under?.[i * 4 + 3] === 255) { opaque[i] = 1; ring[i] = 0; }
      underRing = maskToCanvas(ring, w, h, rgba); overRing = maskToCanvas(opaque, w, h, rgba);
    }
    if (!fill.bounds) return false;
    const sel = doc.selection.clip;
    if (sel) [fill, underRing, overRing].forEach(c => { if (!c) return; const fc = c.getContext('2d'); fc.globalCompositeOperation = 'destination-in'; fc.drawImage(sel, 0, 0); });
    const all = [fill, underRing, overRing].map(c => c?.bounds).filter(Boolean), x0 = Math.min(...all.map(r => r.x)), y0 = Math.min(...all.map(r => r.y));
    const box = { x: x0, y: y0, w: Math.max(...all.map(r => r.x + r.w)) - x0, h: Math.max(...all.map(r => r.y + r.h)) - y0 };
    doc.editPixels('Fill', layer, box, ctx => {
      ctx.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
      ctx.drawImage(fill, 0, 0);
      if (underRing?.bounds) { ctx.globalCompositeOperation = 'destination-over'; ctx.drawImage(underRing, 0, 0); }
      if (overRing?.bounds) { ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(overRing, 0, 0); }
      ctx.globalCompositeOperation = 'source-over';
    });
    haptics.pulse(8);
    return false;
  }
}

// While picking, a ring above the pointer shows the colour under it (top half) against the colour
// you had (bottom half), so the pick reads even under a fingertip; letting go pops it and buzzes.
export class PickerTool {
  constructor(app) { Object.assign(this, { app, id: 'picker', cursor: toolCursor('picker'), loupe: null }); }
  down(p, e) {
    this.close();
    this.loupe = h('div.pick-loupe');
    this.loupe.style.setProperty('--was', this.app.color.fg);
    document.body.append(this.loupe);
    this.track = ev => Object.assign(this.loupe.style, { left: `${ev.clientX}px`, top: `${ev.clientY}px` });
    this.track(e);
    addEventListener('pointermove', this.track);
    this.pick(p);
    return true;
  }
  move(pts) { this.pick(pts.at(-1)); }
  up() { this.close(true); haptics.success(); }
  cancel() { this.close(); }
  interrupt() { this.close(); }
  pick(p) { this.app.pickColor(p.x, p.y); this.loupe.style.setProperty('--now', this.app.color.fg); }
  close(picked = false) {
    const l = this.loupe;
    if (!l) return;
    removeEventListener('pointermove', this.track);
    this.loupe = null;
    if (!picked) return l.remove();
    l.classList.add('done');
    setTimeout(() => l.remove(), 400);
  }
}

export class HandTool {
  constructor(app) { Object.assign(this, { app, id: 'hand', cursor: 'grab' }); }
  down(p) { this.last = p; return true; }
  move(pts) { const p = pts.at(-1); this.app.view.pan(p.sx - this.last.sx, p.sy - this.last.sy); this.last = p; }
  up() {}
}

export class ZoomTool {
  constructor(app) { Object.assign(this, { app, id: 'zoom', cursor: 'zoom-in' }); }
  down(p, e) { Object.assign(this, { p0: p, z0: this.app.view.zoom, moved: false, out: e.altKey }); return true; }
  move(pts) {
    const p = pts.at(-1), dx = p.sx - this.p0.sx, v = this.app.view;
    if (Math.abs(dx) > 3) this.moved = true;
    if (this.moved) v.set(this.z0 * Math.exp(dx / 150), v.rot, this.p0.sx, this.p0.sy);
  }
  up() { if (!this.moved) this.app.view.zoomAt(this.out ? 1 / 1.5 : 1.5, this.p0.sx, this.p0.sy); }
}
