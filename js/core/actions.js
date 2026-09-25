import { local } from './storage.js';

// Central action registry: menus, toolbars, zen bar and the keymap all dispatch through here.
const defs = new Map();
let keys = local.get('pp.keys', {});

export const actions = {
  define(list) { list.forEach(a => defs.set(a.id, a)); },
  get: id => defs.get(id),
  all: () => [...defs.values()],
  run(id) { const a = defs.get(id); if (a && a.enabled?.() !== false) a.run(); },
  key: id => keys[id] ?? defs.get(id)?.key ?? '',
  setKey(id, k) {
    if (k) for (const a of defs.values()) if (a.id !== id && this.key(a.id) === k) keys[a.id] = '';
    keys[id] = k;
    local.set('pp.keys', keys);
  },
  keymap: () => ({ ...keys }),
  loadKeymap(k) { keys = k ?? {}; local.set('pp.keys', keys); },
};

export function comboOf(e) {
  let k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  if (/^Key[A-Z]$/.test(e.code)) k = e.code[3];
  else if (/^Digit\d$/.test(e.code)) k = e.code[5];
  else if (k === ' ') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}

export const isTyping = e => !!e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

// `allow` narrows which actions keys may trigger right now (e.g. only mode switches in Pixel mode).
export function bindKeys(allow = () => true) {
  addEventListener('keydown', e => {
    if (isTyping(e) || document.querySelector('.modal-back')) return;
    const c = comboOf(e);
    const a = c && actions.all().find(a => actions.key(a.id) === c && a.enabled?.() !== false && allow(a));
    if (a) { e.preventDefault(); a.run(); }
  });
}
