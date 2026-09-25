import { h, icon } from './dom.js';
import { local } from '../core/storage.js';
import { clamp, debounce } from '../core/util.js';
import { bus } from '../core/bus.js';

// Dockable / floating / collapsible panels. A layout is plain JSON:
// { dockWidth, panels: { id: { dock: 'left'|'right'|null, order, x, y, w, h, collapsed, hidden } } }
export class Panels {
  constructor(ws) {
    this.ws = ws;
    this.docks = { left: ws.querySelector('#dockLeft .dock-panels'), right: ws.querySelector('#dockRight .dock-panels') };
    this.float = ws.querySelector('#floatLayer');
    this.map = new Map();
    this.defaults = {};
    this.save = debounce(() => local.set('pp.layout', this.layout()), 300);
    this.initResizer(ws.querySelector('#dockRight .dock-resizer'));
    new ResizeObserver(() => this.map.forEach(p => !p.s.dock && this.clampFloat(p))).observe(ws);
  }

  add(id, title, body, def, { tools = [], grow = false } = {}) {
    const el = h(`section.panel${grow ? '.grow' : ''}`, { dataset: { panel: id } },
      h('header.panel-head', {},
        h('span.panel-title', {}, title),
        ...tools,
        h('button.ibtn.sm', { type: 'button', 'data-tip': 'Collapse', onclick: () => this.patch(id, { collapsed: !this.map.get(id).s.collapsed }) }, icon('chevron')),
        h('button.ibtn.sm', { type: 'button', 'data-tip': 'Close', onclick: () => this.patch(id, { hidden: true }) }, icon('x'))),
      h('div.panel-body', {}, body));
    const p = { id, title, el, s: { ...def } };
    this.defaults[id] = def;
    this.map.set(id, p);
    el.querySelector('.panel-head').addEventListener('pointerdown', e => !e.target.closest('button, select, input') && this.drag(p, e));
    new ResizeObserver(() => {
      if (p.s.dock || p.s.collapsed || !el.offsetWidth) return;
      p.s.w = el.offsetWidth; p.s.h = el.offsetHeight; this.save();
    }).observe(el);
    return el;
  }

  patch(id, s) { Object.assign(this.map.get(id).s, s); this.placeAll(); this.save(); }
  toggle(id) { this.patch(id, { hidden: !this.map.get(id).s.hidden }); }
  isOpen(id) { return !this.map.get(id)?.s.hidden; }

  layout() {
    return { dockWidth: this.ws.style.getPropertyValue('--dock-w') || null, panels: Object.fromEntries([...this.map].map(([id, p]) => [id, { ...p.s }])) };
  }

  apply(layout) {
    if (layout?.dockWidth) this.ws.style.setProperty('--dock-w', layout.dockWidth);
    else this.ws.style.removeProperty('--dock-w');
    this.map.forEach((p, id) => { p.s = { ...this.defaults[id], ...layout?.panels?.[id] }; });
    this.placeAll();
    this.save();
  }
  reset() { this.apply(null); }

  placeAll() {
    const sorted = [...this.map.values()].sort((a, b) => (a.s.order ?? 0) - (b.s.order ?? 0));
    for (const p of sorted) {
      const { el, s } = p;
      el.hidden = !!s.hidden;
      el.classList.toggle('collapsed', !!s.collapsed);
      el.classList.toggle('floating', !s.dock);
      if (s.dock) {
        Object.assign(el.style, { left: '', top: '', width: '', height: '' });
        this.docks[s.dock].append(el);
      } else {
        Object.assign(el.style, { left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: s.collapsed ? '' : `${s.h}px` });
        this.float.append(el);
        this.clampFloat(p);
      }
    }
    bus.emit('panels');
  }

  clampFloat({ el, s }) {
    const W = this.ws.clientWidth, H = this.ws.clientHeight;
    s.x = clamp(s.x, 0, Math.max(0, W - 60)); s.y = clamp(s.y, 0, Math.max(0, H - 36));
    el.style.left = `${s.x}px`; el.style.top = `${s.y}px`;
  }

  // Header drag: tear off into a floating panel; drop near a dock column to dock it.
  drag(p, e) {
    const { el, s } = p, r = el.getBoundingClientRect(), wr = this.ws.getBoundingClientRect();
    const off = { x: e.clientX - r.left, y: e.clientY - r.top };
    let moved = false, zone = null;
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
      this.ws.querySelectorAll('.dock').forEach(d => d.classList.toggle('drop', d.id === (zone && (zone.side === 'left' ? 'dockLeft' : 'dockRight'))));
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      this.ws.querySelectorAll('.dock').forEach(d => d.classList.remove('drop'));
      el.style.zIndex = '';
      if (!moved) return;
      if (zone) Object.assign(s, { dock: zone.side, order: zone.order });
      this.normalize();
      this.placeAll();
      this.save();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  dockZone(ev, self) {
    for (const side of ['left', 'right']) {
      const box = this.docks[side].parentElement.getBoundingClientRect();
      const near = side === 'left' ? ev.clientX < box.right + 24 : ev.clientX > box.left - 24;
      if (!near) continue;
      const docked = [...this.map.values()].filter(p => p !== self && p.s.dock === side && !p.s.hidden).sort((a, b) => a.s.order - b.s.order);
      const hit = docked.find(p => ev.clientY < p.el.getBoundingClientRect().top + p.el.offsetHeight / 2);
      return { side, order: hit ? hit.s.order - 0.5 : (docked.at(-1)?.s.order ?? 0) + 1 };
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
