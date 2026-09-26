import { h, icon, keepOnScreen } from './dom.js';
import { local } from '../core/storage.js';
import { clamp, debounce } from '../core/util.js';
import { bus } from '../core/bus.js';

// Dockable / floating / collapsible panels. Each side dock collapses to an icon rail whose
// buttons open panels as flyouts (the same flyouts Zen mode uses). A layout is plain JSON:
// { dockWidth, docks: { left, right }, panels: { id: { dock, order, x, y, w, h, collapsed, hidden } } }
export class Panels {
  constructor(ws) {
    this.ws = ws;
    this.sides = { left: ws.querySelector('#dockLeft'), right: ws.querySelector('#dockRight') };
    this.docks = { left: this.sides.left.querySelector('.dock-panels'), right: this.sides.right.querySelector('.dock-panels') };
    this.rails = {};
    for (const side of ['left', 'right']) this.sides[side].prepend(this.rails[side] = h('div.dock-rail'));
    this.float = ws.querySelector('#floatLayer');
    this.map = new Map();
    this.defaults = {};
    this.folded = { left: false, right: false };
    this.fly = null;
    this.save = debounce(() => local.set('pp.layout', this.layout()), 300);
    this.initResizer(ws.querySelector('#dockRight .dock-resizer'));
    this.setLocked(local.get('pp.panelsLocked', false));
    this.narrow = innerWidth < 900;
    new ResizeObserver(() => {
      this.map.forEach(p => !p.s.dock && this.clampFloat(p));
      if (this.narrow !== innerWidth < 900) { this.narrow = !this.narrow; this.placeAll(); }
    }).observe(ws);
    document.addEventListener('pointerdown', e => {
      if (this.fly && !this.fly.p.el.contains(e.target) && !this.fly.anchor.contains(e.target) && !e.target.closest('.modal-back, .menu-drop')) this.closeFlyout();
    }, true);
  }

  add(id, title, ic, body, def, { grow = false } = {}) {
    const el = h(`section.panel${grow ? '.grow' : ''}`, { dataset: { panel: id } },
      h('header.panel-head', {},
        icon(ic), h('span.panel-title', {}, title),
        // floating: pin keeps it up in Focus too; float/dock moves it out of or back into a side dock
        h('button.ibtn.sm.pin', { type: 'button', 'data-tip': 'Pin: stay visible in Focus', onclick: () => this.patch(id, { pinned: !this.map.get(id).s.pinned }) }, icon('lock')),
        h('button.ibtn.sm.undock', { type: 'button', 'data-tip': 'Float / dock this panel', onclick: () => this.toggleDock(id) }, icon('window')),
        h('button.ibtn.sm.fold', { type: 'button', 'data-tip': 'Collapse', onclick: () => this.patch(id, { collapsed: !this.map.get(id).s.collapsed }) }, icon('chevron')),
        h('button.ibtn.sm', { type: 'button', 'data-tip': 'Close', onclick: () => (this.fly?.p.id === id ? this.closeFlyout() : this.patch(id, { hidden: true })) }, icon('x'))),
      h('div.panel-body', {}, body), h('div.panel-resize', { 'data-tip': 'Resize' }));
    const p = { id, title, icon: ic, el, s: { ...def } };
    this.defaults[id] = def;
    this.map.set(id, p);
    el.querySelector('.panel-head').addEventListener('pointerdown', e => !e.target.closest('button') && !el.classList.contains('flyout') && !this.locked && this.drag(p, e));
    // a corner handle resizes a floating panel (CSS resize has no touch support)
    el.querySelector('.panel-resize').addEventListener('pointerdown', e => {
      if (p.s.dock || this.locked) return;
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, y0 = e.clientY, w0 = el.offsetWidth, h0 = el.offsetHeight;
      const mv = ev => { p.s.w = Math.max(140, w0 + ev.clientX - x0); p.s.h = Math.max(100, h0 + ev.clientY - y0); this.place(p); };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); this.save(); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    new ResizeObserver(() => {
      if (p.s.dock || p.s.collapsed || !el.offsetWidth || el.classList.contains('flyout')) return;
      p.s.w = el.offsetWidth; p.s.h = el.offsetHeight; this.save();
    }).observe(el);
    return el;
  }

  // Undock to a floating panel where it is, or dock it back to its last side.
  toggleDock(id) {
    const p = this.map.get(id), r = p.el.getBoundingClientRect(), wr = this.ws.getBoundingClientRect();
    if (p.s.dock) this.patch(id, { lastDock: p.s.dock, dock: null, x: Math.max(8, r.left - wr.left - 24), y: Math.max(8, r.top - wr.top), w: r.width, h: Math.max(200, Math.min(r.height, 420)), collapsed: false });
    else { this.patch(id, { dock: p.s.lastDock ?? this.defaults[id]?.dock ?? 'right', pinned: false }); this.normalize(); this.placeAll(); }
  }
  // Locked: panels can't be dragged, docked or resized (buttons still work).
  setLocked(on) { this.locked = on; local.set('pp.panelsLocked', on); this.ws.classList.toggle('panels-locked', on); }

  patch(id, s) { Object.assign(this.map.get(id).s, s); this.placeAll(); this.save(); }
  toggle(id) { this.patch(id, { hidden: !this.map.get(id).s.hidden }); }
  isOpen(id) { return !this.map.get(id)?.s.hidden; }
  // Narrow screens fold both docks unless the user opened one for this session.
  isFolded(side) { return this.narrow ? !this.opened?.[side] : this.folded[side]; }
  fold(side) {
    if (this.narrow) (this.opened ??= {})[side] = this.isFolded(side);
    else this.folded[side] = !this.folded[side];
    this.closeFlyout(); this.placeAll(); this.save();
  }

  // Shows a panel as a popover beside `anchor` (collapsed dock rails, Zen strip).
  flyout(id, anchor) {
    const p = this.map.get(id), again = this.fly?.p === p;
    this.closeFlyout();
    if (again) return;
    this.fly = { p, anchor };
    const r = anchor.getBoundingClientRect(), right = r.left > innerWidth / 2;
    p.el.classList.add('flyout');
    Object.assign(p.el.style, {
      top: `${Math.max(8, r.top)}px`, width: '', height: '',
      left: right ? 'auto' : `${r.right + 8}px`, right: right ? `${innerWidth - r.left + 8}px` : 'auto',
    });
    // Keep the whole popover on screen: slide it up / sideways once its real size is known.
    const b = p.el.getBoundingClientRect();
    if (b.bottom > innerHeight - 8) p.el.style.top = `${Math.max(8, innerHeight - 8 - b.height)}px`;
    if (b.right > innerWidth - 8) Object.assign(p.el.style, { left: `${Math.max(8, innerWidth - 8 - b.width)}px`, right: 'auto' });
    if (b.left < 8) Object.assign(p.el.style, { left: '8px', right: 'auto' });
    this.fly.stop = keepOnScreen(p.el);
    anchor.classList.add('on');
  }
  closeFlyout() {
    if (!this.fly) return;
    const { p, anchor, stop } = this.fly;
    stop?.();
    this.fly = null;
    p.el.classList.remove('flyout');
    anchor.classList.remove('on');
    this.place(p);
  }

  layout() {
    return {
      dockWidth: this.ws.style.getPropertyValue('--dock-w') || null,
      docks: { ...this.folded },
      panels: Object.fromEntries([...this.map].map(([id, p]) => [id, { ...p.s }])),
    };
  }

  apply(layout) {
    if (layout?.dockWidth) this.ws.style.setProperty('--dock-w', layout.dockWidth);
    else this.ws.style.removeProperty('--dock-w');
    this.folded = { left: false, right: false, ...layout?.docks };
    this.map.forEach((p, id) => { p.s = { ...this.defaults[id], ...layout?.panels?.[id] }; });
    this.placeAll();
    this.save();
  }
  reset() { this.apply(null); }

  placeAll() {
    const sorted = [...this.map.values()].sort((a, b) => (a.s.order ?? 0) - (b.s.order ?? 0));
    sorted.forEach(p => this.place(p));
    // A folded rail offers every panel that lives on its side (docked there, floating or closed),
    // except the Tools panel, which stays visible as a compact strip in the left rail.
    this.renderRail('left', sorted.filter(p => p.s.dock === 'left' && p.id !== 'tools' && !p.s.hidden));
    this.renderRail('right', sorted.filter(p => p.s.dock !== 'left' && p.id !== 'tools'));
    bus.emit('panels');
  }

  place(p) {
    const { el, s } = p;
    if (el.classList.contains('flyout')) return;
    {
      el.hidden = !!s.hidden;
      el.classList.toggle('collapsed', !!s.collapsed);
      el.classList.toggle('floating', !s.dock);
      el.classList.toggle('pinned', !s.dock && !!s.pinned);
      if (s.dock) {
        Object.assign(el.style, { left: '', top: '', right: '', width: '', height: '' });
        this.docks[s.dock].append(el);
      } else {
        Object.assign(el.style, { left: `${s.x}px`, top: `${s.y}px`, right: '', width: `${s.w}px`, height: s.collapsed ? '' : `${s.h}px` });
        this.float.append(el);
        this.clampFloat(p);
      }
    }
  }

  renderRail(side, docked) {
    const folded = this.isFolded(side), dock = this.sides[side];
    dock.classList.toggle('folded', folded);
    dock.classList.toggle('empty', ![...this.map.values()].some(p => p.s.dock === side && !p.s.hidden));
    const arrow = (side === 'left') === folded ? 'chevronsRight' : 'chevronsLeft';
    // Folded: icons open flyouts. Expanded: icons show / collapse each panel in place.
    const shown = p => !p.s.hidden && !p.s.collapsed;
    const toggle = p => (p.s.hidden ? this.patch(p.id, { hidden: false, collapsed: false, dock: p.s.dock ?? side }) : this.patch(p.id, { collapsed: !p.s.collapsed }));
    this.rails[side].replaceChildren(
      h('button.ibtn.sm.rail-toggle', { type: 'button', 'data-tip': folded ? 'Expand side panel' : 'Collapse side panel', onclick: () => this.fold(side) }, icon(arrow)),
      ...docked.map(p => folded
        ? h('button.ibtn.rail-btn', { type: 'button', 'data-tip': p.title, onclick: e => this.flyout(p.id, e.currentTarget) }, icon(p.icon))
        : h('button.ibtn.sm.rail-mini', { type: 'button', className: shown(p) ? 'on' : '', 'data-tip': `${p.title} — show / collapse`, onclick: () => toggle(p) }, icon(p.icon))));
  }

  clampFloat({ el, s }) {
    const W = this.ws.clientWidth, H = this.ws.clientHeight;
    s.x = clamp(s.x, 0, Math.max(0, W - 60)); s.y = clamp(s.y, 0, Math.max(0, H - 32));
    el.style.left = `${s.x}px`; el.style.top = `${s.y}px`;
  }

  // Header drag: tear off into a floating panel; drop near a dock column to dock it.
  drag(p, e) {
    const { el, s } = p, r = el.getBoundingClientRect(), wr = this.ws.getBoundingClientRect();
    const off = { x: e.clientX - r.left, y: e.clientY - r.top };
    let moved = false, zone = null;
    const marker = h('div.dock-marker', { hidden: true });   // a line showing where the panel will land
    document.body.append(marker);
    const move = ev => {
      if (!moved) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
        moved = true;
        Object.assign(s, { dock: null, x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: Math.max(r.height, 160) });
        this.placeAll();
        el.style.zIndex = 20;
      }
      s.x = ev.clientX - wr.left - off.x; s.y = ev.clientY - wr.top - off.y;
      this.clampFloat(p);
      zone = this.dockZone(ev, p);
      for (const side of ['left', 'right']) this.sides[side].classList.toggle('drop', zone?.side === side);
      marker.hidden = !zone;
      if (zone) Object.assign(marker.style, { left: `${zone.left}px`, top: `${Math.round(zone.y) - 2}px`, width: `${zone.width}px` });
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      for (const side of ['left', 'right']) this.sides[side].classList.remove('drop');
      marker.remove();
      el.style.zIndex = '';
      if (!moved) return;
      if (zone) { Object.assign(s, { dock: zone.side, order: zone.order }); this.folded[zone.side] = false; if (this.opened) this.opened[zone.side] = true; }
      this.normalize();
      this.placeAll();
      this.save();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  dockZone(ev, self) {
    for (const side of ['left', 'right']) {
      const box = this.sides[side].getBoundingClientRect();
      if (!(side === 'left' ? ev.clientX < box.right + 24 : ev.clientX > box.left - 24)) continue;
      const docked = [...this.map.values()].filter(p => p !== self && p.s.dock === side && !p.s.hidden).sort((a, b) => a.s.order - b.s.order);
      const hit = docked.find(p => ev.clientY < p.el.getBoundingClientRect().top + p.el.offsetHeight / 2), last = docked.at(-1)?.el.getBoundingClientRect();
      const y = hit ? hit.el.getBoundingClientRect().top - 3 : last ? last.bottom + 3 : box.top + 6;   // where the row will go
      return { side, order: hit ? hit.s.order - 0.5 : (docked.at(-1)?.s.order ?? 0) + 1, y, left: box.left + 4, width: box.width - 8 };
    }
    return null;
  }

  normalize() {
    ['left', 'right'].forEach(side => [...this.map.values()].filter(p => p.s.dock === side)
      .sort((a, b) => a.s.order - b.s.order).forEach((p, i) => { p.s.order = i; }));
  }

  initResizer(handle) {
    handle.addEventListener('pointerdown', e => {
      const x0 = e.clientX, w0 = handle.parentElement.offsetWidth;
      const move = ev => this.ws.style.setProperty('--dock-w', `${clamp(w0 + x0 - ev.clientX, 220, 520)}px`);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); this.save(); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }
}
