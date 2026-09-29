// Themed drop-down lists for every <select> in the app (Draw, Notes, dialogs, Sprite Studio).
// The browser draws a <select>'s open list itself — system font, system colours, a blue highlight —
// and CSS can't reach it. So mouse / pen clicks and the open keys show this list instead, while the
// <select> stays the source of truth: picking sets its value and fires input + change like a native
// pick, so every existing handler keeps working. Touch keeps the phone's own picker, which is the
// better control under a finger.

let open = null;   // { sel, pop, items, active }
let lastPointer = 'mouse';

function close(focusBack = true) {
  if (!open) return;
  const { sel, pop } = open;
  open = null;
  pop.remove();
  sel.classList.remove('dd-open');
  if (focusBack) sel.focus({ preventScroll: true });
}

function pick(i) {
  const { sel, items } = open, it = items[i];
  if (!it || it.disabled) return;
  const changed = sel.selectedIndex !== it.index;
  sel.selectedIndex = it.index;
  close();
  if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
}

function setActive(i, scroll = true) {
  const { items } = open;
  if (!items.length) return;
  i = Math.max(0, Math.min(items.length - 1, i));
  open.items[open.active]?.el.classList.remove('active');
  open.active = i;
  items[i].el.classList.add('active');
  if (scroll) items[i].el.scrollIntoView({ block: 'nearest' });
}

// next enabled item from i in direction d
const step = (i, d) => { const { items } = open; for (let j = i + d; j >= 0 && j < items.length; j += d) if (!items[j].disabled) return j; return i; };

function show(sel) {
  if (sel.disabled || sel.multiple) return;
  close(false);
  // inside Sprite Studio, stay under #pixel so its theme variables apply
  const host = sel.closest('#pixel') || document.body;
  const pop = document.createElement('div');
  pop.className = 'dd-pop';
  pop.setAttribute('role', 'listbox');
  const items = [];
  const addOpt = (o, indent) => {
    const el = document.createElement('div');
    el.className = 'dd-item' + (o.disabled ? ' disabled' : '') + (o.selected ? ' selected' : '') + (indent ? ' indent' : '');
    el.setAttribute('role', 'option');
    el.textContent = o.label || o.text;
    const idx = items.length;
    items.push({ el, index: o.index, disabled: o.disabled, text: (o.label || o.text).toLowerCase() });
    el.addEventListener('pointerenter', () => !o.disabled && setActive(idx, false));
    el.addEventListener('click', () => pick(idx));
    pop.append(el);
  };
  for (const c of sel.children) {
    if (c.tagName === 'OPTGROUP') {
      const g = document.createElement('div'); g.className = 'dd-group'; g.textContent = c.label; pop.append(g);
      for (const o of c.children) if (o.tagName === 'OPTION' && !o.hidden) addOpt(o, true);
    } else if (c.tagName === 'OPTION' && !c.hidden) addOpt(c, false);
  }
  if (!items.length) return;
  host.append(pop);
  sel.classList.add('dd-open');
  open = { sel, pop, items, active: -1, typed: '', typedAt: 0 };

  // place under the select (or above if there's no room), at least as wide, never off screen
  const r = sel.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  pop.style.minWidth = `${Math.round(r.width)}px`;
  const below = vh - r.bottom - 8, above = r.top - 8, want = Math.min(pop.scrollHeight, 360);
  const up = below < want && above > below;
  pop.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(vw - pw - 8, r.left))}px`;
  pop.style.top = `${up ? Math.max(8, r.top - ph - 4) : Math.min(vh - ph - 8, r.bottom + 4)}px`;

  const cur = items.findIndex(it => it.index === sel.selectedIndex);
  setActive(cur >= 0 ? cur : step(-1, 1));
}

export function initSelects() {
  // mouse / pen: open ours instead of the browser's (touch keeps the native picker)
  document.addEventListener('pointerdown', e => {
    lastPointer = e.pointerType;
    const sel = e.target.closest?.('select');
    if (open && !open.pop.contains(e.target) && sel !== open.sel) close(false);
    if (!sel || e.pointerType === 'touch' || e.button !== 0) return;
    e.preventDefault();
    if (open?.sel === sel) { close(); return; }
    sel.focus({ preventScroll: true });
    show(sel);
  }, true);
  // Firefox opens its list on mousedown too
  document.addEventListener('mousedown', e => { if (lastPointer !== 'touch' && e.button === 0 && e.target.closest?.('select')) e.preventDefault(); }, true);

  // on window, capture phase, registered at start-up: runs before a dialog's own Escape / Enter keys
  addEventListener('keydown', e => {
    if (!open) {
      const sel = e.target.closest?.('select');
      if (sel && (e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')))) { e.preventDefault(); e.stopImmediatePropagation(); show(sel); }
      return;   // plain arrows on a closed select still step its value natively
    }
    const k = e.key;
    if (k === 'Escape' || k === 'Tab') { if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); } close(k === 'Escape'); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (k === 'ArrowDown') setActive(step(open.active, 1));
    else if (k === 'ArrowUp') setActive(step(open.active, -1));
    else if (k === 'Home') setActive(step(-1, 1));
    else if (k === 'End') setActive(step(open.items.length, -1));
    else if (k === 'PageDown') setActive(step(Math.min(open.items.length - 1, open.active + 7), -1) );
    else if (k === 'PageUp') setActive(step(Math.max(0, open.active - 7), 1));
    else if (k === 'Enter' || k === ' ') pick(open.active);
    else if (k.length === 1) {   // type-ahead: jump to the first item starting with what was typed
      const now = Date.now(); open.typed = (now - open.typedAt < 700 ? open.typed : '') + k.toLowerCase(); open.typedAt = now;
      const hit = open.items.findIndex(it => !it.disabled && it.text.startsWith(open.typed));
      if (hit >= 0) setActive(hit);
    }
  }, true);

  // anything that moves the page under the list closes it (but scrolling the list itself is fine)
  addEventListener('scroll', e => { if (open && !open.pop.contains(e.target)) close(false); }, true);
  addEventListener('resize', () => close(false));
  addEventListener('blur', () => close(false));
}
