import { toolCursor } from '../ui/cursors.js';
import { floodMask, dilate, maskToCanvas } from '../engine/flood.js';
import { makeCanvas } from '../core/util.js';
import { hexToU32 } from '../core/color.js';
import { haptics } from '../input/haptics.js';

// Returns the pixels a fill/wand should sample: the merged image or the active layer.
export function sampleSource(app) {
  const { doc, view, opts } = app;
  if (opts.sampleAll || !doc.activeLayer) { view.compose(); return view.comp; }
  return doc.activeLayer.view() ?? makeCanvas(doc.w, doc.h);
}

export function regionMask(app, p, rgba = 0xffffffff, grow = false, tolerance = app.opts.tolerance) {
  const { doc, opts } = app, x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return null;
  const img = sampleSource(app).getContext('2d').getImageData(0, 0, doc.w, doc.h);
  let m = floodMask(img, x, y, tolerance, opts.contiguous);
  if (grow) m = dilate(m, doc.w, doc.h, img, y * doc.w + x);
  return maskToCanvas(m, doc.w, doc.h, rgba);
}

export class FillTool {
  constructor(app) { Object.assign(this, { app, id: 'fill', cursor: toolCursor('fill') }); }
  down(p) {
    const { app } = this, { doc } = app, layer = doc.activeLayer;
    if (!layer || layer.locked) { app.toast('Select an unlocked layer'); return false; }
    // a pixel canvas fills exact colours with hard edges; a painting grows under anti-aliased line art
    const fill = regionMask(app, p, hexToU32(app.color.fg), !doc.pixelArt, doc.pixelArt ? 0 : undefined);
    if (!fill?.bounds) return false;
    const sel = doc.selection.clip;
    if (sel) { const fc = fill.getContext('2d'); fc.globalCompositeOperation = 'destination-in'; fc.drawImage(sel, 0, 0); }
    doc.editPixels('Fill', layer, fill.bounds, ctx => {
      ctx.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
      ctx.drawImage(fill, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    });
    haptics.pulse(8);
    return false;
  }
}

export class PickerTool {
  constructor(app) { Object.assign(this, { app, id: 'picker', cursor: toolCursor('picker') }); }
  down(p) { this.app.pickColor(p.x, p.y); return true; }
  move(pts) { const p = pts.at(-1); this.app.pickColor(p.x, p.y); }
  up() { haptics.pulse(5); }
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
