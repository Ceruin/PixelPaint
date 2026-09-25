import { h } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';

// Hover tooltips for [data-tip]; shortcut keys come from [data-action]. The mascot listens to 'tip'.
export function initTooltips() {
  const tip = document.body.appendChild(h('div.tooltip'));
  let timer = 0, cur = null, shown = false;
  const hide = () => {
    clearTimeout(timer); cur = null;
    if (!shown) return;
    shown = false; tip.classList.remove('show'); bus.emit('untip');
  };
  const show = el => {
    if (!el.isConnected) return;
    const key = el.dataset.action && actions.key(el.dataset.action);
    tip.replaceChildren(el.dataset.tip, key ? h('kbd', {}, key) : '');
    const r = el.getBoundingClientRect(), side = !!el.closest('.toolbar');
    tip.classList.add('show');
    const t = tip.getBoundingClientRect();
    const x = side ? r.right + 8 : Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 4);
    const y = side ? r.top + r.height / 2 - t.height / 2 : r.bottom + 6 + t.height > innerHeight ? r.top - t.height - 6 : r.bottom + 6;
    Object.assign(tip.style, { left: `${x}px`, top: `${y}px` });
    shown = true;
    bus.emit('tip', tip.getBoundingClientRect());
  };
  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[data-tip]');
    if (el === cur) return;
    hide();
    if (!el) return;
    cur = el;
    timer = setTimeout(() => show(el), 450);
  });
  document.addEventListener('pointerdown', hide, true);
}
