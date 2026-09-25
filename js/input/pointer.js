import { bus } from '../core/bus.js';
import { DEG } from '../core/util.js';

const HALF_PI = Math.PI / 2;

// Pen altitude/azimuth (radians) from the Pointer Events API, with a tiltX/Y fallback.
function tilt(e) {
  if (e.altitudeAngle != null && e.pointerType === 'pen') return { alt: e.altitudeAngle, az: e.azimuthAngle };
  if (!e.tiltX && !e.tiltY) return { alt: HALF_PI, az: 0 };
  const tx = Math.tan(e.tiltX * DEG), ty = Math.tan(e.tiltY * DEG);
  return { alt: Math.atan(1 / Math.hypot(tx, ty)), az: Math.atan2(ty, tx) };
}

// Routes canvas input: pen/mouse/finger strokes to the active tool; multi-touch to view gestures
// (pinch-zoom, pan, rotate; 2-finger tap = undo, 3-finger tap = redo). A pen disables finger painting.
export class CanvasInput {
  constructor(app, el) {
    Object.assign(this, { app, el, pointers: new Map(), penSeen: false, active: null, gesture: null, pan: null, rect: el.getBoundingClientRect() });
    el.style.touchAction = 'none';
    // Cached canvas position (reading it per hover move would force a layout each time).
    const measure = () => { this.rect = el.getBoundingClientRect(); };
    new ResizeObserver(measure).observe(el);
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.up(e));
    el.addEventListener('pointerleave', () => app.tool.hover?.(null));
    el.addEventListener('wheel', e => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
    bus.on('tool', () => this.updateCursor());
  }

  updateCursor() { this.el.style.cursor = this.app.keys.space ? 'grab' : this.app.tool.cursor; }

  point(e) {
    const sx = e.clientX - this.rect.left, sy = e.clientY - this.rect.top, d = this.app.view.toDoc(sx, sy);
    const p = e.pointerType === 'pen' ? Math.max(0.02, e.pressure) : 1;
    return { x: d.x, y: d.y, p, sx, sy, ...tilt(e) };
  }

  down(e) {
    const { app } = this;
    this.rect = this.el.getBoundingClientRect();
    document.activeElement?.blur?.();
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    if (e.pointerType === 'pen') this.penSeen = true;
    this.pointers.set(e.pointerId, { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top });
    bus.emit('activity');
    const touch = e.pointerType === 'touch';
    if (touch && (this.penSeen || !app.settings.fingerDraw || this.pointers.size > 1)) return this.startGesture(e);
    if (this.active != null) return;
    if (e.button === 2) { bus.emit('popup', { x: e.clientX, y: e.clientY }); return; }
    if (e.button === 1 || app.keys.space) { this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0) return;
    if (app.tool.down(this.point(e), e) !== false) Object.assign(this, { active: e.pointerId, activeTouch: touch, activeAt: e.timeStamp });
  }

  move(e) {
    const { app } = this;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top });
    if (this.gesture) return this.updateGesture();
    if (this.pan?.id === e.pointerId) {
      app.view.pan(e.clientX - this.pan.x, e.clientY - this.pan.y);
      this.pan.x = e.clientX; this.pan.y = e.clientY;
      return;
    }
    if (e.pointerId === this.active) {
      const evs = e.getCoalescedEvents?.() ?? [];
      app.tool.move((evs.length ? evs : [e]).map(ev => this.point(ev)), e);
    } else if (this.active == null && e.pointerType !== 'touch') {
      app.tool.hover?.(this.point(e));
    }
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    if (this.gesture) { if (!this.pointers.size) this.endGesture(e); return; }
    if (this.pan?.id === e.pointerId) { this.pan = null; return; }
    if (e.pointerId !== this.active) return;
    this.active = null;
    this.app.tool.up(this.point(e), e);
    if (e.pointerType === 'touch') this.app.tool.hover?.(null);
  }

  // ---- multi-touch gestures ----
  startGesture(e) {
    if (this.active != null) {
      // A second finger right after the first means "gesture", not "stroke".
      if (this.activeTouch && e.timeStamp - this.activeAt < 350) this.app.tool.cancel?.();
      else this.app.tool.up(this.point(e), e);
      this.active = null;
    }
    const v = this.app.view;
    this.gesture ??= { t0: e.timeStamp, max: 0, moved: 0 };
    Object.assign(this.gesture, { base: this.state(), view: { zoom: v.zoom, rot: v.rot } });
    this.gesture.anchor = v.toDoc(this.gesture.base.x, this.gesture.base.y);
    this.gesture.max = Math.max(this.gesture.max, this.pointers.size);
  }

  state() {
    const p = [...this.pointers.values()];
    if (p.length < 2) return { x: p[0]?.x ?? 0, y: p[0]?.y ?? 0, d: 1, a: 0, n: p.length };
    const [a, b] = p;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), n: p.length };
  }

  updateGesture() {
    const g = this.gesture, s = this.state(), b = g.base;
    if (s.n !== b.n) return this.startGesture({ timeStamp: g.t0 });
    g.moved = Math.max(g.moved, Math.hypot(s.x - b.x, s.y - b.y) + Math.abs(s.d - b.d));
    if (g.moved < 8) return;
    if (s.n < 2) return this.app.view.set(g.view.zoom, g.view.rot, s.x, s.y, g.anchor);
    let rot = g.view.rot + (s.a - b.a) / DEG;
    rot = ((rot + 540) % 360) - 180;
    if (Math.abs(rot) < 6) rot = 0;
    this.app.view.set(g.view.zoom * s.d / b.d, rot, s.x, s.y, g.anchor);
  }

  endGesture(e) {
    const g = this.gesture;
    this.gesture = null;
    if (e.timeStamp - g.t0 < 350 && g.moved < 12) {
      if (g.max === 2) this.app.undo();
      else if (g.max === 3) this.app.redo();
    }
  }

  wheel(e) {
    e.preventDefault();
    const r = this.el.getBoundingClientRect(), v = this.app.view, sx = e.clientX - r.left, sy = e.clientY - r.top;
    const k = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.altKey) v.zoomAt(Math.exp(-e.deltaY * k * (e.ctrlKey ? 0.01 : 0.002)), sx, sy);
    else v.pan(-(e.shiftKey ? e.deltaY : e.deltaX) * k, -(e.shiftKey ? 0 : e.deltaY) * k);
  }
}
