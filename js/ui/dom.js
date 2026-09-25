import { ICONS } from './icons.js';

// Tiny element builder: h('div.cls.other', {props|on*|dataset|style}, ...children)
export function h(tag, props, ...kids) {
  const [t, ...cls] = tag.split('.'), el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'className') el.classList.add(...v.split(' ').filter(Boolean));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && !['list', 'form'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter(k => k != null && k !== false));
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);

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

export function segmented(options, value, onChange) {
  const el = h('div.seg');
  const render = v => el.replaceChildren(...options.map(([id, label, ic]) =>
    h('button', { type: 'button', className: id === v ? 'on' : '', 'data-tip': ic ? label : null, onclick: () => { render(id); onChange(id); } }, ic ? icon(ic) : label)));
  render(value);
  return el;
}
