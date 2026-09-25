import { h } from '../ui/dom.js';

export const FONTS = [["'Pixelify Sans'", 'Pixel'], ['system-ui, sans-serif', 'Sans'], ['Georgia, serif', 'Serif'], ['ui-monospace, monospace', 'Mono'], ["'Comic Neue', 'Comic Sans MS', cursive", 'Comic']];

// Click to place a text box over the canvas; typing happens in a real textarea (IME, spellcheck),
// and the result is set onto a new layer. Ctrl+Enter or clicking away commits, Esc cancels.
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
    box.addEventListener('blur', () => setTimeout(() => this.box === box && this.commit(), 0));
    this.box = box; this.at = p;
    document.getElementById('stage').append(box);
    box.focus();
    return false;
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

  cancel() { this.box?.remove(); this.box = null; }
}
