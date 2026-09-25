import { ICONS } from './icons.js';

// Tiny element builder: h('div.cls.other', {props|on*|dataset|style}, ...children)
export function h(tag, props, ...kids) {
  const [t, ...cls] = tag.split('.'), el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'className') el.classList.add(...v.split(' ').filter(Boolean));
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && !['list', 'form'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter(k => k != null && k !== false));
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);

// Updates `el`'s children in place to match `next` (a freshly built element), touching only what
// changed — so re-rendering a panel never swaps a button out from under a finger mid-tap.
// A button whose label or tooltip changed is replaced outright (its click handler goes with it);
// `data-sticky` keeps an element's own `hidden` state (e.g. an open picker).
export function morph(el, next) {
  const a = [...el.childNodes], b = [...next.childNodes];
  b.forEach((nb, i) => {
    const na = a[i];
    if (!na) return el.append(nb);
    if (na.nodeType !== nb.nodeType || na.nodeName !== nb.nodeName || (na.nodeName === 'BUTTON' && (na.textContent !== nb.textContent || na.dataset.tip !== nb.dataset.tip))) return na.replaceWith(nb);
    if (na.nodeType === 3) { if (na.data !== nb.data) na.data = nb.data; return; }
    if (na.nodeType !== 1) return;
    for (const { name, value } of nb.attributes) {
      if (name === 'hidden' && na.dataset.sticky != null) continue;
      if (na.getAttribute(name) !== value) na.setAttribute(name, value);
    }
    for (const { name } of [...na.attributes]) if (!nb.hasAttribute(name) && !(name === 'hidden' && na.dataset.sticky != null)) na.removeAttribute(name);
    if (na.nodeName === 'INPUT' && document.activeElement !== na && na.value !== nb.value) na.value = nb.value;
    if ('disabled' in na && na.disabled !== nb.disabled) na.disabled = nb.disabled;
    morph(na, nb);
  });
  for (let i = a.length - 1; i >= b.length; i--) a[i].remove();
}

// Nudges a fixed-position popup back inside the viewport (and caps its height), now and
// whenever its size changes — e.g. a section expanding inside it.
export function keepOnScreen(el, m = 8) {
  const fix = () => {
    if (!el.isConnected) return ro.disconnect();
    el.style.maxHeight = `${innerHeight - m * 2}px`;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - m) el.style.left = `${Math.max(m, innerWidth - m - r.width)}px`;
    if (r.bottom > innerHeight - m) el.style.top = `${Math.max(m, innerHeight - m - r.height)}px`;
    if (r.left < m) el.style.left = `${m}px`;
    if (r.top < m) el.style.top = `${m}px`;
  };
  const ro = new ResizeObserver(fix);
  ro.observe(el);
  fix();
  return () => { ro.disconnect(); el.style.maxHeight = ''; };
}

export function icon(name) {
  const s = h('span.ic');
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
  return s;
}

export const iconBtn = (name, tip, onclick, extra = {}) => h('button.ibtn', { type: 'button', 'data-tip': tip, 'aria-label': tip, onclick, ...extra }, icon(name));

// Labeled scrub slider. `fmt` formats the readout; onStart/onCommit bracket a drag for undo.
export function slider({ label, min = 0, max = 100, step = 1, value, fmt = v => Math.round(v), onInput, onCommit }) {
  const out = h('span.sl-val'), input = h('input', { type: 'range', min, max, step, value });
  let v0 = value;
  const paint = () => {
    out.textContent = fmt(+input.value);
    input.style.setProperty('--p', `${(input.value - min) / (max - min) * 100}%`);
  };
  input.addEventListener('pointerdown', () => { v0 = +input.value; });
  input.addEventListener('input', () => { paint(); onInput?.(+input.value); });
  input.addEventListener('change', () => onCommit?.(+input.value, v0));
  paint();
  const el = h('label.slider', {}, h('span.sl-label', {}, label), out, input);
  return { el, input, set(v) { input.value = v; paint(); } };
}

export function select(options, value, onChange, extra = {}) {
  const s = h('select', { onchange: () => onChange(s.value), ...extra }, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value;
  return s;
}

export function toggle(label, value, onChange) {
  const i = h('input', { type: 'checkbox', checked: value, onchange: () => onChange(i.checked) });
  return h('label.toggle', {}, i, h('span.tg'), h('span', {}, label));
}

export function segmented(options, value, onChange, labels = false) {
  const el = h('div.seg');
  const render = v => el.replaceChildren(...options.map(([id, label, ic]) =>
    h('button', { type: 'button', className: id === v ? 'on' : '', 'data-tip': ic && !labels ? label : null, onclick: () => { render(id); onChange(id); } }, ic && icon(ic), (!ic || labels) && label)));
  render(value);
  return el;
}
