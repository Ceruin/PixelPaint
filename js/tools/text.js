import { h, icon } from '../ui/dom.js';

export const FONTS = [["'Pixelify Sans'", 'Pixel'], ['system-ui, sans-serif', 'Sans'], ['Georgia, serif', 'Serif'], ['ui-monospace, monospace', 'Mono'], ["'Comic Neue', 'Comic Sans MS', cursive", 'Comic']];

// Click to place a text box over the canvas; typing happens in a real textarea (IME, spellcheck),
// and the result is set onto a new layer. Ctrl+Enter or clicking away commits, Esc cancels.
// Drag the grip beside the box, or the box's dashed edge, to move it while typing.
export class TextTool {
  constructor(app) { Object.assign(this, { app, id: 'text', cursor: 'text', box: null }); }
  deactivate() { this.commit(); }
  interrupt() { this.cancel(); }

  font(zoom = 1) { const o = this.app.opts; return `${o.bold ? 700 : 400} ${o.fontSize * zoom}px ${o.font}`; }

  down(p) {
    if (this.box) { this.commit(); return false; }
    const { view, color } = this.app, s = view.toScreen(p.x, p.y);
    const box = h('textarea.text-editor', { spellcheck: true, style: { left: `${s.x}px`, top: `${s.y}px`, font: this.font(view.zoom), color: color.fg } });
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') this.cancel();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.commit();
    });
    box.addEventListener('input', () => { box.style.height = 'auto'; box.style.height = `${box.scrollHeight}px`; });
    box.addEventListener('blur', () => setTimeout(() => this.box === box && !this.dragging && this.commit(), 0));
    const grip = h('div.text-grip', { title: 'Drag to move the text' }, icon('grip'));
    this.box = box; this.grip = grip; this.at = p;
    this.place(s.x, s.y);
    const edge = e => { const r = box.getBoundingClientRect(), m = 6; return e.clientX - r.left < m || r.right - e.clientX < m || e.clientY - r.top < m || r.bottom - e.clientY < m; };
    box.addEventListener('pointermove', e => { if (!this.dragging) box.style.cursor = edge(e) ? 'move' : ''; });
    box.addEventListener('pointerdown', e => edge(e) && this.drag(e));
    grip.addEventListener('pointerdown', e => this.drag(e));
    document.getElementById('stage').append(box, grip);
    box.focus();
    return false;
  }

  // Box and grip sit at screen point (x, y); the text lands on the canvas point under it.
  place(x, y) {
    this.sx = x; this.sy = y;
    Object.assign(this.box.style, { left: `${x}px`, top: `${y}px` });
    Object.assign(this.grip.style, { left: `${x - 22}px`, top: `${y}px` });
    this.at = this.app.view.toDoc(x, y);
  }

  drag(e) {
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget, x0 = e.clientX - this.sx, y0 = e.clientY - this.sy;
    this.dragging = true; el.setPointerCapture(e.pointerId);
    const move = ev => this.box && this.place(ev.clientX - x0, ev.clientY - y0);
    const up = () => { this.dragging = false; el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); this.box?.focus(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  commit() {
    const box = this.box, text = box?.value.replace(/\s+$/, '');
    this.cancel();
    if (!text) return;
    const { doc, opts, color } = this.app, l = doc.addLayer(`Text: ${text.split('\n')[0].slice(0, 24)}`), c = l.ctx;
    c.font = this.font(); c.fillStyle = color.fg; c.textBaseline = 'top';
    text.split('\n').forEach((line, i) => c.fillText(line, this.at.x, this.at.y + i * opts.fontSize * 1.25));
    doc.touch(l);
  }

  cancel() { this.box?.remove(); this.grip?.remove(); this.box = this.grip = null; this.dragging = false; }
}
