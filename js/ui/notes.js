import { h, icon, iconBtn } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { idb, local } from '../core/storage.js';
import { debounce, clamp, makeCanvas } from '../core/util.js';
import { BrushEngine, DEFAULT_BRUSH } from '../engine/brush.js';

const COLORS = ['#fff3a8', '#ffd1dc', '#c8f0d8', '#cfe6ff', '#e6dcff', '#ffffff'];
const GROUP_COLORS = ['#5b8cff', '#17c06b', '#ff8a3d', '#a445ff', '#ff5fa2', '#8c93a5'];
const PEN = { ...DEFAULT_BRUSH, name: 'Note pen', size: 3.5, minSize: 0.35, hardness: 0.95, spacing: 0.05, smoothing: 0.35 };
const DPX = 2, HEAD = 30, KIND_ICON = { note: 'note', text: 'text', sketch: 'sketch' };
const SIZES = { note: [220, 200], text: [280, 90], sketch: [320, 274] };

const label = it => it.title || it.text?.split('\n').find(Boolean)?.slice(0, 40) || (it.kind === 'sketch' ? 'Sketch' : 'Untitled note');

// Notes board: an infinite pan/zoom surface of cards (sticky notes, text, sketches) that can be
// titled, collapsed, grouped into named frames, found from the outline and opened on their own.
export function initNotes(app, sendToCanvas) {
  const root = document.getElementById('notes');
  const inner = h('div.board-inner'), slot = h('div.mascot-slot.board-slot'), board = h('div.board', {}, inner, slot);
  const outline = h('aside.notes-outline'), search = h('input.notes-search', { type: 'search', placeholder: 'Find notes…' });
  let state = { items: [], groups: [], view: { x: 40, y: 40, z: 1 } }, uid = 1, query = '';
  const els = new Map();   // id → card / frame element
  const persist = debounce(() => idb.set('notes', state), 400);
  const save = () => { persist(); refreshOutline(); };

  const applyView = () => {
    const v = state.view;
    inner.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
    board.style.backgroundPosition = `${v.x}px ${v.y}px`;
    board.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
  };
  const toBoard = (cx, cy) => { const r = board.getBoundingClientRect(), v = state.view; return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }; };
  const groupOf = it => state.groups.find(g => g.id === it.group);
  const members = g => state.items.filter(i => i.group === g.id);
  const visible = it => !groupOf(it)?.collapsed;
  const matches = it => !query || `${it.title ?? ''} ${it.text ?? ''}`.toLowerCase().includes(query);

  // Pointer drag in board space; fn gets deltas, end runs on release.
  const dragger = (el, fn, end) => el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.target.closest('button, input, [contenteditable="true"]') && el !== e.target)) return;
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    let x = e.clientX, y = e.clientY;
    el.onpointermove = ev => { fn((ev.clientX - x) / state.view.z, (ev.clientY - y) / state.view.z); x = ev.clientX; y = ev.clientY; };
    el.onpointerup = () => { el.onpointermove = null; end?.(); save(); };
  });

  // Resize from any edge or corner. Works from the drag's start values so clamping never drifts.
  const resizable = (el, obj, { minW, minH, onChange }) => ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(dir => {
    const hd = h(`div.rz.rz-${dir}`);
    el.append(hd);
    hd.addEventListener('pointerdown', e => {
      e.stopPropagation();
      hd.setPointerCapture(e.pointerId);
      const s0 = { x: obj.x, y: obj.y, w: obj.w, h: obj.h }, x0 = e.clientX, y0 = e.clientY;
      hd.onpointermove = ev => {
        const dx = (ev.clientX - x0) / state.view.z, dy = (ev.clientY - y0) / state.view.z;
        let w = s0.w + (dir.includes('e') ? dx : dir.includes('w') ? -dx : 0), ht = s0.h + (dir.includes('s') ? dy : dir.includes('n') ? -dy : 0);
        w = clamp(w, minW, 5000); ht = clamp(ht, minH, 5000);
        Object.assign(obj, { w, h: ht, x: dir.includes('w') ? s0.x + s0.w - w : s0.x, y: dir.includes('n') ? s0.y + s0.h - ht : s0.y });
        onChange();
      };
      hd.onpointerup = () => { hd.onpointermove = null; save(); };
    });
  });

  // Inline-editable title that saves on input and keeps keys away from app shortcuts. On a card or
  // group header (`tapEdit`) it's part of the drag handle: one tap/press drags, a double-tap (or
  // double-click) edits it.
  const titleField = (obj, placeholder, cls = 'card-title', tapEdit = true) => {
    const el = h(`span.${cls}`, {
      contentEditable: tapEdit ? 'false' : 'true', spellcheck: false, textContent: obj.title ?? obj.name ?? '', 'data-placeholder': placeholder,
      onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.target.blur(); } },
      oninput: e => { if ('name' in obj) obj.name = e.target.textContent; else obj.title = e.target.textContent; save(); },
      onpointerdown: e => el.isContentEditable && e.stopPropagation(),
    });
    if (!tapEdit) return el;
    const edit = () => {
      el.contentEditable = 'true'; el.focus();
      getSelection().selectAllChildren(el);
      el.addEventListener('blur', () => { el.contentEditable = 'false'; }, { once: true });
    };
    let last = 0;
    el.addEventListener('pointerdown', e => {
      if (el.isContentEditable) return;
      const x0 = e.clientX, y0 = e.clientY;
      // the header captures the pointer to drag, so the release is caught at window level
      addEventListener('pointerup', u => {
        if (Math.hypot(u.clientX - x0, u.clientY - y0) > 6) return void (last = 0);   // a drag, not a tap
        if (u.timeStamp - last < 400) { last = 0; edit(); } else last = u.timeStamp;
      }, { once: true, capture: true });
    });
    return el;
  };

  // ---- cards ----
  const placeCard = it => {
    const el = els.get(it.id);
    if (!el) return;
    el.hidden = !visible(it);
    el.classList.toggle('collapsed', !!it.collapsed);
    el.classList.toggle('dim', !matches(it));
    Object.assign(el.style, { left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: it.collapsed ? `${HEAD}px` : `${it.h}px`, background: it.color ?? '' });
  };

  const mountCard = it => {
    els.get(it.id)?.remove();
    const el = h(`div.card.${it.kind}`, { dataset: { id: it.id } });
    let canvas;
    const head = h('div.card-grip', {},
      iconBtn(it.collapsed ? 'chevronRight' : 'chevron', 'Collapse / expand', () => { it.collapsed = !it.collapsed; mountCard(it); save(); }),
      // always something to grab, however long the title; the (no-op) click makes it a tap target, so
      // touch adjustment doesn't snap a press on it onto the neighbouring button
      h('span.card-handle', { 'data-tip': 'Drag to move', onclick: () => {} }),
      icon(KIND_ICON[it.kind]),
      titleField(it, label(it)),
      h('span.card-space'),
      it.kind === 'note' && !it.collapsed && h('span.dots', {}, COLORS.map(c => h('button.dot', { type: 'button', style: { background: c }, onclick: () => { it.color = c; placeCard(it); save(); } }))),
      iconBtn('expand', 'Open on its own', () => focusNote(it)),
      it.kind === 'sketch' && iconBtn('upload', 'Send to canvas as a layer', () => sendToCanvas(canvas)),
      iconBtn('trash', 'Delete', () => remove(it)));
    el.append(head);
    if (it.kind === 'sketch') {
      canvas = sketchCanvas(it);
      el.append(h('div.card-sketch', {}, canvas));
    } else el.append(h('div.card-text', {
      contentEditable: 'true', spellcheck: true, textContent: it.text,
      oninput: e => { it.text = e.target.innerText; el.querySelector('.card-title').dataset.placeholder = label(it); save(); },
      onkeydown: e => e.stopPropagation(),
      onpointerdown: e => e.stopPropagation(),
    }));
    dragger(head, (dx, dy) => { it.x += dx; it.y += dy; placeCard(it); }, () => assignGroup(it));
    if (!it.collapsed) resizable(el, it, { minW: 120, minH: HEAD + 30, onChange: () => { placeCard(it); canvas?.fit(); } });
    els.set(it.id, el);
    inner.append(el);
    placeCard(it);
    return el;
  };

  // A sketch's paper grows with its card (never shrinks, so nothing drawn is lost) and is
  // shown 1:1 from the top-left: resizing the card to any shape reveals or crops, never stretches.
  const sketchCanvas = it => {
    const canvas = h('canvas.card-canvas', { width: 1, height: 1 });
    canvas.fit = (w = it.w * DPX, ht = (it.h - HEAD) * DPX) => {
      w = Math.ceil(Math.max(w, canvas.width)); ht = Math.ceil(Math.max(ht, canvas.height));
      if (w !== canvas.width || ht !== canvas.height) {
        const old = canvas.width > 1 ? makeCanvas(canvas.width, canvas.height) : null;
        old?.getContext('2d').drawImage(canvas, 0, 0);
        Object.assign(canvas, { width: w, height: ht });
        if (old) canvas.getContext('2d').drawImage(old, 0, 0);
      }
      Object.assign(canvas.style, { width: `${w / DPX}px`, height: `${ht / DPX}px` });
    };
    canvas.fit();
    if (it.img) { const i = new Image(); i.onload = () => { canvas.fit(i.width, i.height); canvas.getContext('2d').drawImage(i, 0, 0); }; i.src = it.img; }
    let eng = null;
    const pt = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height, p: e.pointerType === 'pen' ? e.pressure : 1 }; };
    canvas.addEventListener('pointerdown', e => {
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);
      eng = new BrushEngine(PEN, { target: canvas.getContext('2d'), color: e.button === 2 ? '#ffffff' : '#1b1d23', symmetry: [(x, y, a) => [x, y, a, false]], profile: app.profile });
      eng.begin(pt(e));
    });
    canvas.addEventListener('pointermove', e => eng && (e.getCoalescedEvents?.() ?? [e]).forEach(ev => eng.move(pt(ev))));
    canvas.addEventListener('pointerup', e => { if (!eng) return; eng.end(pt(e)); eng = null; it.img = canvas.toDataURL(); save(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    return canvas;
  };

  // ---- groups (named frames that carry their notes) ----
  const placeGroup = g => {
    const el = els.get(`g${g.id}`);
    if (!el) return;
    el.classList.toggle('collapsed', !!g.collapsed);
    Object.assign(el.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: g.collapsed ? `${HEAD + 4}px` : `${g.h}px`, '--gc': g.color });
    el.querySelector('.grp-count').textContent = `${members(g).length}`;
  };

  const mountGroup = g => {
    els.get(`g${g.id}`)?.remove();
    const head = h('div.grp-head', {},
      iconBtn(g.collapsed ? 'chevronRight' : 'chevron', 'Collapse / expand group', () => setGroupCollapsed(g, !g.collapsed)),
      icon('folder'), titleField(g, 'Group name', 'grp-name'), h('span.grp-count'),
      iconBtn('plus', 'Add a note to this group', () => add('note', { x: g.x + 16, y: g.y + HEAD + 16 }, g)),
      iconBtn('grid', 'Tidy this group', () => tidyGroup(g)),
      iconBtn('x', 'Remove group (keeps its notes)', () => ungroup(g)));
    const el = h('div.note-group', { dataset: { id: g.id } }, head);
    dragger(head, (dx, dy) => {
      g.x += dx; g.y += dy;
      members(g).forEach(it => { it.x += dx; it.y += dy; placeCard(it); });
      placeGroup(g);
    });
    if (!g.collapsed) resizable(el, g, { minW: 180, minH: HEAD + 40, onChange: () => placeGroup(g) });
    els.set(`g${g.id}`, el);
    inner.prepend(el);
    placeGroup(g);
  };

  const setGroupCollapsed = (g, on) => { g.collapsed = on; mountGroup(g); members(g).forEach(placeCard); save(); };

  // A card belongs to the topmost group its centre is dropped inside.
  const assignGroup = it => {
    const cx = it.x + it.w / 2, cy = it.y + (it.collapsed ? HEAD : it.h) / 2;
    const g = [...state.groups].reverse().find(g => !g.collapsed && cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h);
    it.group = g?.id;
    state.groups.forEach(placeGroup);
  };

  const ungroup = g => { members(g).forEach(it => { it.group = undefined; placeCard(it); }); state.groups = state.groups.filter(x => x !== g); els.get(`g${g.id}`)?.remove(); save(); };

  // ---- layout helpers ----
  const grid = (items, x0, y0, width) => {
    let x = x0, y = y0, row = 0;
    for (const it of items) {
      if (x > x0 && x + it.w > x0 + width) { x = x0; y += row + 16; row = 0; }
      it.x = x; it.y = y; x += it.w + 16; row = Math.max(row, it.collapsed ? HEAD : it.h);
      placeCard(it);
    }
    return y + row;
  };
  const tidyGroup = g => {
    const bottom = grid(members(g), g.x + 16, g.y + HEAD + 16, Math.max(g.w - 32, 260));
    g.h = Math.max(g.h, bottom - g.y + 16);
    placeGroup(g); save();
  };
  const tidyAll = () => {
    state.groups.forEach(tidyGroup);
    const right = Math.max(0, ...state.groups.map(g => g.x + g.w + 40));
    grid(state.items.filter(i => !i.group), right, 0, 900);
    save();
  };
  const fitAll = () => {
    const boxes = [...state.items.filter(visible).map(i => [i.x, i.y, i.w, i.collapsed ? HEAD : i.h]), ...state.groups.map(g => [g.x, g.y, g.w, g.collapsed ? HEAD : g.h])];
    if (!boxes.length) { state.view = { x: 40, y: 40, z: 1 }; return applyView(); }
    const x0 = Math.min(...boxes.map(b => b[0])), y0 = Math.min(...boxes.map(b => b[1]));
    const x1 = Math.max(...boxes.map(b => b[0] + b[2])), y1 = Math.max(...boxes.map(b => b[1] + b[3])), r = board.getBoundingClientRect();
    const z = clamp(Math.min((r.width - 60) / (x1 - x0), (r.height - 60) / (y1 - y0)), 0.2, 1.5);
    state.view = { z, x: (r.width - (x1 - x0) * z) / 2 - x0 * z, y: (r.height - (y1 - y0) * z) / 2 - y0 * z };
    applyView(); save();
  };
  const centerOn = obj => {
    const r = board.getBoundingClientRect(), v = state.view;
    v.x = r.width / 2 - (obj.x + obj.w / 2) * v.z; v.y = r.height / 3 - obj.y * v.z;
    applyView(); save();
  };

  // ---- actions ----
  const add = (kind, at, group) => {
    const r = board.getBoundingClientRect(), [w, ht] = SIZES[kind];
    const k = state.items.length % 6 * 28, p = at ?? toBoard(r.left + r.width / 2 - w / 2 + k, r.top + r.height / 2 - ht / 2 + k);
    const it = { id: uid++, kind, x: p.x, y: p.y, w, h: ht, color: kind === 'note' ? COLORS[state.items.length % 5] : null, text: '', title: '' };
    state.items.push(it);
    const el = mountCard(it);
    if (group) { it.group = group.id; if (group.collapsed) setGroupCollapsed(group, false); placeGroup(group); } else assignGroup(it);
    el.querySelector('.card-text')?.focus();
    save();
    return it;
  };
  const addGroup = () => {
    const r = board.getBoundingClientRect(), p = toBoard(r.left + 60, r.top + 60);
    const g = { id: uid++, name: `Group ${state.groups.length + 1}`, x: p.x, y: p.y, w: 520, h: 340, color: GROUP_COLORS[state.groups.length % GROUP_COLORS.length], collapsed: false };
    state.groups.push(g);
    mountGroup(g);
    save();
    const name = els.get(`g${g.id}`).querySelector('.grp-name'), range = document.createRange();
    name.focus(); range.selectNodeContents(name);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  };
  const remove = it => { state.items = state.items.filter(i => i !== it); els.get(it.id)?.remove(); els.delete(it.id); state.groups.forEach(placeGroup); save(); };
  const collapseAll = on => {
    state.items.forEach(it => { if (!!it.collapsed !== on) { it.collapsed = on; mountCard(it); } });
    state.groups.forEach(g => { g.collapsed = on; mountGroup(g); });
    state.items.forEach(placeCard);
    save();
  };

  // One note on its own: a large editor over the board (the card itself is untouched).
  const focusNote = it => {
    const close = () => { back.remove(); if (it.kind === 'sketch') mountCard(it); };
    const body = it.kind === 'sketch' ? sketchCanvas(it) : h('div.focus-text', {
      contentEditable: 'true', spellcheck: true, textContent: it.text,
      oninput: e => { it.text = e.target.innerText; els.get(it.id).querySelector('.card-text').textContent = it.text; save(); },
      onkeydown: e => { e.stopPropagation(); if (e.key === 'Escape') close(); },
    });
    const back = h('div.note-focus', { onpointerdown: e => e.target === back && close() },
      h('div.focus-card', { style: { background: it.kind === 'note' ? it.color : '' } },
        h('div.focus-head', {}, icon(KIND_ICON[it.kind]), titleField(it, label(it), 'focus-title', false), h('span.spacer'), iconBtn('x', 'Close (Esc)', close)),
        body));
    root.append(back);
    (body.focus ? body : back).focus?.();
    addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && back.isConnected) { close(); removeEventListener('keydown', esc); } });
  };

  // ---- outline sidebar ----
  const refreshOutline = debounce(() => {
    const row = it => h('button.ol-item', {
      type: 'button', className: matches(it) ? '' : 'dim', onclick: () => { const g = groupOf(it); if (g?.collapsed) setGroupCollapsed(g, false); centerOn(it); flash(it); },
      ondblclick: () => focusNote(it),
    }, icon(KIND_ICON[it.kind]), h('span', {}, label(it)), it.collapsed && h('small', {}, '—'));
    outline.replaceChildren(
      h('div.ol-head', {}, iconBtn(showOutline ? 'chevronsLeft' : 'chevronsRight', showOutline ? 'Collapse the outline' : 'Expand the outline', () => setOutline(!showOutline)),
        h('span.ol-title', {}, 'Outline'), h('span.spacer'), h('small', {}, `${state.items.length}`)),
      search,
      ...state.groups.map(g => h('div.ol-group', {},
        h('button.ol-gname', { type: 'button', style: { '--gc': g.color }, onclick: () => centerOn(g) },
          h('span.ol-chev', { onclick: e => { e.stopPropagation(); setGroupCollapsed(g, !g.collapsed); } }, icon(g.collapsed ? 'chevronRight' : 'chevron')),
          icon('folder'), h('span', {}, g.name || 'Group'), h('small', {}, `${members(g).length}`)),
        !g.collapsed && members(g).map(row))),
      h('div.ol-sub', {}, 'Not in a group'),
      ...state.items.filter(i => !i.group).map(row));
  }, 60);
  const flash = it => { const el = els.get(it.id); el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 900); };
  search.addEventListener('input', () => { query = search.value.toLowerCase(); state.items.forEach(placeCard); refreshOutline(); });
  search.addEventListener('keydown', e => e.stopPropagation());

  // ---- board navigation: drag empty space to pan, wheel to scroll, Ctrl/Alt+wheel to zoom ----
  board.addEventListener('pointerdown', e => {
    if (e.target !== board && e.target !== inner) return;
    e.preventDefault();
    board.setPointerCapture(e.pointerId);
    let x = e.clientX, y = e.clientY;
    board.onpointermove = ev => { state.view.x += ev.clientX - x; state.view.y += ev.clientY - y; x = ev.clientX; y = ev.clientY; applyView(); };
    board.onpointerup = () => { board.onpointermove = null; persist(); };
  });
  board.addEventListener('dblclick', e => (e.target === board || e.target === inner) && add('note', toBoard(e.clientX - 20, e.clientY - 20)));
  board.addEventListener('wheel', e => {
    e.preventDefault();
    const v = state.view, r = board.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (!e.ctrlKey && !e.altKey) { v.x -= e.deltaX; v.y -= e.deltaY; }
    else {
      const z = clamp(v.z * Math.exp(-e.deltaY * 0.01), 0.2, 4);
      v.x = sx - (sx - v.x) * z / v.z; v.y = sy - (sy - v.y) * z / v.z; v.z = z;
    }
    applyView(); persist();
  }, { passive: false });

  // Drag the outline's edge to resize it.
  const outlineSizer = h('div.outline-sizer');
  outline.style.width = `${local.get('pp.notesOutlineW', 250)}px`;
  outlineSizer.addEventListener('pointerdown', e => {
    outlineSizer.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = outline.offsetWidth;
    outlineSizer.onpointermove = ev => { outline.style.width = `${clamp(w0 + ev.clientX - x0, 160, 520)}px`; };
    outlineSizer.onpointerup = () => { outlineSizer.onpointermove = null; local.set('pp.notesOutlineW', outline.offsetWidth); };
  });
  // The outline starts collapsed to a slim rail (the board gets the room); expand it from the rail or the bar.
  let showOutline = local.get('pp.notesOutline2', false);
  const setOutline = on => {
    showOutline = on; local.set('pp.notesOutline2', on);
    outline.classList.toggle('collapsed', !on); outlineSizer.hidden = !on; outlineBtn.classList.toggle('on', on);
    refreshOutline();
  };
  const outlineBtn = iconBtn('layers', 'Show / hide the outline', () => setOutline(!showOutline));
  const focusBtn = iconBtn('expand', 'Focus: full-screen board (Tab)', () => actions.run('view.focus'), { 'data-action': 'view.focus' });
  bus.on('mode', () => focusBtn.classList.toggle('on', !!app.focus));
  setOutline(showOutline);
  const btn = (ic, text, fn, tip) => h('button.btn.sm', { type: 'button', 'data-tip': tip, onclick: fn }, icon(ic), h('span', {}, text));

  root.append(
    h('div.optionsbar', {},
      h('span.opt-tool', {}, icon('note'), 'Notes'), outlineBtn, focusBtn,
      btn('note', 'Sticky', () => add('note'), 'New sticky note'),
      btn('text', 'Text', () => add('text'), 'New text block'),
      btn('sketch', 'Sketch', () => add('sketch'), 'New sketch card'),
      btn('folderPlus', 'Group', addGroup, 'New named group — drop notes into it'),
      h('span.tl-sep'),
      btn('chevronRight', 'Collapse all', () => collapseAll(true), 'Collapse every note and group'),
      btn('chevron', 'Expand all', () => collapseAll(false), 'Expand every note and group'),
      btn('grid', 'Tidy', tidyAll, 'Arrange notes neatly inside their groups'),
      btn('fit', 'Fit all', fitAll, 'Zoom to show everything'),
      h('span.muted', {}, 'Double-click the board for a quick note')),
    h('div.notes-main', {}, outline, outlineSizer, board));

  idb.get('notes').then(s => {
    if (s?.items) state = { groups: [], ...s };
    uid = Math.max(0, ...state.items.map(i => i.id), ...state.groups.map(g => g.id)) + 1;
    state.groups.forEach(mountGroup);
    state.items.forEach(mountCard);
    applyView();
    refreshOutline();
  }).catch(() => { applyView(); refreshOutline(); });

  return { slot, show: on => { root.hidden = !on; } };
}
