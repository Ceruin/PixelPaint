import { h } from './dom.js';

// Promise-based modal: resolves with the clicked button's value (null on cancel / Esc).
export function modal(title, body, buttons = [['Cancel', null], ['OK', 'ok', true]], cls = '') {
  return new Promise(res => {
    const done = v => { back.remove(); removeEventListener('keydown', key, true); res(v); };
    const key = e => {
      if (document.querySelector('.capturing')) return;
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (e.key === 'Enter' && !e.target.closest('textarea, .capture')) { const p = buttons.find(b => b[2]); if (p) { e.preventDefault(); done(p[1]); } }
    };
    const back = h('div.modal-back', { onpointerdown: e => e.target === back && done(null) },
      h(`div.modal${cls ? '.' + cls : ''}`, {},
        h('h3', {}, title),
        h('div.modal-body', {}, body),
        h('div.modal-foot', {}, buttons.map(([label, v, primary]) => h('button.btn', { type: 'button', className: primary ? 'primary' : '', onclick: () => done(v) }, label)))));
    addEventListener('keydown', key, true);
    document.body.append(back);
    back.querySelector('input, select')?.focus();
  });
}

// fields: [{ id, label, type: number|text|select|checkbox, value, min, max, step, options, oninput }]
export async function form(title, fields, ok = 'OK') {
  const inputs = {};
  const body = fields.map(f => {
    const i = f.type === 'select'
      ? h('select', {}, f.options.map(([v, l]) => h('option', { value: v }, l)))
      : h('input', { type: f.type ?? 'number', min: f.min, max: f.max, step: f.step });
    if (f.type === 'checkbox') i.checked = f.value; else i.value = f.value;
    if (f.oninput) i.addEventListener('input', () => f.oninput(i, inputs));
    inputs[f.id] = i;
    return h(`label.field${f.type === 'checkbox' ? '.check' : ''}`, {}, h('span', {}, f.label), i);
  });
  if (!await modal(title, body, [['Cancel', null], [ok, 'ok', true]])) return null;
  return Object.fromEntries(fields.map(f => {
    const i = inputs[f.id];
    return [f.id, f.type === 'checkbox' ? i.checked : f.type === 'select' || f.type === 'text' ? i.value : +i.value];
  }));
}

let toastEl, toastTimer;
export function toast(msg) {
  toastEl ??= document.body.appendChild(h('div.toast'));
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}
