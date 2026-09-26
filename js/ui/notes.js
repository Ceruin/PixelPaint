import { h, icon, iconBtn } from './dom.js';
import { idb, local } from '../core/storage.js';
import { modal, form } from './dialogs.js';
import { debounce, download, toBlob } from '../core/util.js';

// Notes, after reMarkable's Paper Pro: a library of notebooks (list or thumbnails, sort, search,
// favourites, tags, trash) and a calm paper page to write on with a few pens, an eraser, a lasso
// and undo. Pages keep their strokes as vectors, so they redraw crisply at any size.
const PW = 1404, PH = 1872;   // page size (reMarkable's 3:4)
const TEMPLATES = [['blank', 'Blank'], ['lined', 'Lined'], ['checklist', 'Checklist'], ['grid', 'Grid'], ['dots', 'Dots'], ['cornell', 'Cornell']];
const PENS = [['fineliner', 'Fineliner'], ['ballpoint', 'Ballpoint'], ['pencil', 'Pencil'], ['marker', 'Marker'], ['highlighter', 'Highlighter'], ['calligraphy', 'Calligraphy']];
const SIZES = [['thin', 'Thin', 1], ['medium', 'Medium', 2], ['thick', 'Thick', 3.6]];
const INKS = [['#1b1d23', 'Black'], ['#8c8f97', 'Gray'], ['#ffffff', 'White'], ['#4a57b8', 'Blue'], ['#c8505e', 'Red'], ['#4f9a6e', 'Green'], ['#e8c547', 'Yellow'], ['#3fa7c9', 'Cyan'], ['#c84f9a', 'Magenta']];
const SORTS = [['modified', 'Last modified'], ['name', 'Alphabetical (A–Z)'], ['created', 'Date created']];
const uid = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- paper and ink ----
function drawTemplate(ctx, kind, s = 1) {
  ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, PW * s, PH * s);
  ctx.strokeStyle = '#c9c7c0'; ctx.fillStyle = '#b4b2ab'; ctx.lineWidth = Math.max(1, 1.5 * s);
  const hl = y => { ctx.beginPath(); ctx.moveTo(90 * s, y * s); ctx.lineTo((PW - 90) * s, y * s); ctx.stroke(); };
  if (kind === 'lined' || kind === 'checklist' || kind === 'cornell') for (let y = 240; y < PH - 80; y += 70) hl(y);
  if (kind === 'checklist') for (let y = 240; y < PH - 80; y += 70) ctx.strokeRect(100 * s, (y - 50) * s, 38 * s, 38 * s);
  if (kind === 'cornell') { ctx.beginPath(); ctx.moveTo(430 * s, 170 * s); ctx.lineTo(430 * s, (PH - 380) * s); ctx.moveTo(90 * s, (PH - 380) * s); ctx.lineTo((PW - 90) * s, (PH - 380) * s); ctx.stroke(); }
  if (kind === 'grid') { ctx.globalAlpha = 0.7; for (let x = 72; x < PW; x += 72) { ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, PH * s); ctx.stroke(); } for (let y = 72; y < PH; y += 72) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(PW * s, y * s); ctx.stroke(); } ctx.globalAlpha = 1; }
  if (kind === 'dots') for (let y = 72; y < PH; y += 72) for (let x = 72; x < PW; x += 72) { ctx.beginPath(); ctx.arc(x * s, y * s, 2.6 * s, 0, 7); ctx.fill(); }
}
const PEN_STYLE = {
  fineliner: { w: 3, press: 0, alpha: 1 }, ballpoint: { w: 3.2, press: 0.6, alpha: 0.92 }, pencil: { w: 3.6, press: 0.8, alpha: 0.55 },
  marker: { w: 9, press: 0.3, alpha: 1 }, highlighter: { w: 30, press: 0, alpha: 0.35, flat: true }, calligraphy: { w: 7, press: 0.8, alpha: 1, nib: true },
};
function drawStroke(ctx, st, s = 1) {
  const P = PEN_STYLE[st.pen] ?? PEN_STYLE.fineliner, p = st.pts, base = P.w * st.size * s;
  if (!p.length) return;
  ctx.save();
  ctx.globalAlpha = P.alpha; ctx.strokeStyle = ctx.fillStyle = st.color; ctx.lineCap = P.flat ? 'butt' : 'round'; ctx.lineJoin = 'round';
  if (st.pen === 'highlighter') ctx.globalCompositeOperation = 'multiply';
  if (p.length <= 3) { ctx.beginPath(); ctx.arc(p[0] * s, p[1] * s, base / 2, 0, 7); ctx.fill(); ctx.restore(); return; }
  if (!P.press && !P.nib) {   // even width: one smooth path
    ctx.lineWidth = base; ctx.beginPath(); ctx.moveTo(p[0] * s, p[1] * s);
    for (let i = 3; i < p.length - 3; i += 3) ctx.quadraticCurveTo(p[i] * s, p[i + 1] * s, (p[i] + p[i + 3]) / 2 * s, (p[i + 1] + p[i + 4]) / 2 * s);
    ctx.lineTo(p.at(-3) * s, p.at(-2) * s); ctx.stroke();
  } else for (let i = 3; i < p.length; i += 3) {   // width follows pressure (and the nib's angle)
    const dx = p[i] - p[i - 3], dy = p[i + 1] - p[i - 2], nib = P.nib ? 0.35 + 0.65 * Math.abs(Math.sin(Math.atan2(dy, dx) - Math.PI / 4)) : 1;
    ctx.lineWidth = base * nib * (1 - P.press + P.press * (p[i + 2] + p[i - 1])) ;
    ctx.beginPath(); ctx.moveTo(p[i - 3] * s, p[i - 2] * s); ctx.lineTo(p[i] * s, p[i + 1] * s); ctx.stroke();
  }
  ctx.restore();
}
function renderPage(ctx, page, template, s = 1, skip) {
  drawTemplate(ctx, template, s);
  for (const st of page.strokes) if (!skip?.has(st)) drawStroke(ctx, st, s);
}
const bbox = st => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let i = 0; i < st.pts.length; i += 3) { x0 = Math.min(x0, st.pts[i]); x1 = Math.max(x1, st.pts[i]); y0 = Math.min(y0, st.pts[i + 1]); y1 = Math.max(y1, st.pts[i + 1]); } return { x0, y0, x1, y1 }; };
const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) if ((poly[i + 1] > y) !== (poly[j + 1] > y) && x < (poly[j] - poly[i]) * (y - poly[i + 1]) / (poly[j + 1] - poly[i + 1]) + poly[i]) c = !c; return c; };

export function initNotes(app, sendToCanvas) {
  const root = document.getElementById('notes');
  const slot = h('div.board-slot');
  let lib = { notebooks: [] }, view = 'library', book = null, pageIx = 0;
  const save = debounce(() => idb.set('notebooks', lib), 400);
  const opts = { sort: local.get('pp.nbSort', 'modified'), grid: local.get('pp.nbGrid', true), filter: 'all', tag: null, q: '' };
  const pen = { pen: 'fineliner', size: 'medium', color: '#1b1d23', ...local.get('pp.nbPen', {}) };

  // ================= library =================
  const thumbs = new Map();
  const thumbOf = b => {
    const key = `${b.id}|${b.modified}`;
    if (!thumbs.has(key)) { const c = h('canvas', { width: 156, height: 208 }); renderPage(c.getContext('2d'), b.pages[0], b.template, 156 / PW); thumbs.set(key, c.toDataURL()); }
    return thumbs.get(key);
  };
  const listed = () => {
    let l = lib.notebooks.filter(b => (opts.filter === 'trash' ? b.trashed : !b.trashed) && (opts.filter !== 'favs' || b.fav) && (!opts.tag || b.tags?.includes(opts.tag)) && (!opts.q || b.name.toLowerCase().includes(opts.q.toLowerCase())));
    const by = { name: (a, b) => a.name.localeCompare(b.name), created: (a, b) => b.created - a.created, modified: (a, b) => b.modified - a.modified }[opts.sort];
    return l.sort(by);
  };
  const libEl = h('div.nb-lib'), drawer = h('div.nb-drawer', { hidden: true });
  const renderLibrary = () => {
    const items = listed(), title = opts.filter === 'trash' ? 'Trash' : opts.filter === 'favs' ? 'Favorites' : opts.tag ? `#${opts.tag}` : 'My files';
    const search = h('input.nb-search', { type: 'search', placeholder: 'Search notebooks', value: opts.q, hidden: !opts.searching, oninput: e => { opts.q = e.target.value; renderItems(); } });
    const list = h('div', { className: opts.grid ? 'nb-grid' : 'nb-list' });
    const renderItems = () => list.replaceChildren(...(listed().length ? listed().map(item) : [h('p.nb-empty', {}, opts.filter === 'trash' ? 'Trash is empty.' : 'No notebooks yet — tap + to start one.')]));
    libEl.replaceChildren(
      h('header.nb-head', {},
        iconBtn('menu', 'Menu', () => { drawer.hidden = !drawer.hidden; renderDrawer(); }),
        h('h2', {}, title),
        h('select.nb-sort', { 'aria-label': 'Sort', onchange: e => { opts.sort = e.target.value; local.set('pp.nbSort', opts.sort); renderLibrary(); } }, SORTS.map(([v, l]) => h('option', { value: v, selected: v === opts.sort }, l)))),
      h('div.nb-sub', {}, h('span', {}, `${items.length} item${items.length === 1 ? '' : 's'}`), search),
      list,
      h('div.nb-pill', {},
        iconBtn('zoom', 'Search', () => { opts.searching = !opts.searching; if (!opts.searching) opts.q = ''; renderLibrary(); if (opts.searching) libEl.querySelector('.nb-search').focus(); }),
        opts.filter !== 'trash' && iconBtn('plus', 'New notebook', newNotebook),
        iconBtn(opts.grid ? 'menu' : 'grid', opts.grid ? 'List view' : 'Thumbnails', () => { opts.grid = !opts.grid; local.set('pp.nbGrid', opts.grid); renderLibrary(); })));
    renderItems();
    libEl.append(drawer);
  };
  const ago = t => { const d = (Date.now() - t) / 1000; return d < 60 ? 'just now' : d < 3600 ? `${Math.floor(d / 60)} min ago` : d < 86400 ? `${Math.floor(d / 3600)} h ago` : new Date(t).toLocaleDateString(); };
  const item = b => h('div.nb-item', {},
    h('button.nb-open', { type: 'button', onclick: () => (b.trashed ? null : openBook(b)) },
      h('img.nb-thumb', { src: thumbOf(b), alt: '' }),
      h('span.nb-meta', {}, h('b', {}, b.name), h('small', {}, `Page ${Math.min(b.last ?? 1, b.pages.length)} of ${b.pages.length} · ${ago(b.modified)}`), b.tags?.length ? h('small.nb-tags', {}, b.tags.map(t => `#${t}`).join(' ')) : null)),
    h('div.nb-acts', {},
      b.trashed ? [iconBtn('undo', 'Restore', () => { b.trashed = false; touch(b, true); }), iconBtn('trash', 'Delete forever', async () => { if (await modal('Delete forever?', h('p', {}, `“${b.name}” can’t be recovered.`), [['Cancel', null], ['Delete', 'ok', 'danger']])) { lib.notebooks = lib.notebooks.filter(x => x !== b); save(); renderLibrary(); } })]
        : [iconBtn(b.fav ? 'star' : 'star', b.fav ? 'Unfavorite' : 'Favorite', () => { b.fav = !b.fav; touch(b, true); }, { className: `ibtn${b.fav ? ' on' : ''}` }),
          iconBtn('text', 'Rename', async () => { const v = await form('Rename', [{ id: 'n', label: 'Name', type: 'text', value: b.name }], 'Rename'); if (v?.n?.trim()) { b.name = v.n.trim(); touch(b, true); } }),
          iconBtn('tag', 'Tags', async () => { const v = await form('Tags', [{ id: 't', label: 'Tags (comma separated)', type: 'text', value: (b.tags ?? []).join(', ') }], 'Save'); if (v) { b.tags = v.t.split(',').map(s => s.trim()).filter(Boolean); touch(b, true); } }),
          iconBtn('trash', 'Move to trash', () => { b.trashed = true; touch(b, true); })]));
  const renderDrawer = () => {
    const tags = [...new Set(lib.notebooks.flatMap(b => b.tags ?? []))].sort();
    const go = (filter, tag = null) => { Object.assign(opts, { filter, tag }); drawer.hidden = true; renderLibrary(); };
    const row = (ic, label, on, fn) => h('button.nb-drow', { type: 'button', className: on ? 'on' : '', onclick: fn }, icon(ic), h('span', {}, label));
    drawer.replaceChildren(
      row('folder', 'My files', opts.filter === 'all' && !opts.tag, () => go('all')),
      row('star', 'Favorites', opts.filter === 'favs', () => go('favs')),
      tags.length ? h('div.nb-dlabel', {}, 'Tags') : null, ...tags.map(t => row('tag', t, opts.tag === t, () => go('all', t))),
      h('span.nb-dspace'),
      row('trash', 'Trash', opts.filter === 'trash', () => go('trash')));
  };
  const touch = (b, rerender) => { b.modified = Date.now(); save(); if (rerender) renderLibrary(); };

  async function newNotebook() {
    let pick = 'lined';
    const tiles = h('div.nb-templates', {}, TEMPLATES.map(([id, label]) => {
      const c = h('canvas', { width: 96, height: 128 }); drawTemplate(c.getContext('2d'), id, 96 / PW);
      return h('button.nb-tpl', { type: 'button', className: id === pick ? 'on' : '', dataset: { id }, onclick: e => { pick = id; tiles.querySelectorAll('.nb-tpl').forEach(t => t.classList.toggle('on', t.dataset.id === id)); } }, c, h('span', {}, label));
    }));
    const name = h('input.nb-name', { type: 'text', value: `Notebook ${lib.notebooks.length + 1}`, 'aria-label': 'Name' });
    const ok = await modal('New notebook', h('div.nb-new', {}, name, h('div.sub-label', {}, 'Template'), tiles), [['Cancel', null], ['Create', 'ok', true]], 'wide');
    if (!ok) return;
    const now = Date.now(), b = { id: uid(), name: name.value.trim() || 'Notebook', template: pick, created: now, modified: now, pages: [{ strokes: [] }], tags: [], fav: false };
    lib.notebooks.push(b); save(); openBook(b);
  }

  // ================= editor =================
  const cv = h('canvas.nb-page'), ctx = cv.getContext('2d'), wrap = h('div.nb-paper', {}, cv);
  const pageLabel = h('span.nb-pageno');
  let hist = [], redo = [], sel = null, scale = 1, cache = null;
  const page = () => book.pages[pageIx];
  const fit = () => {
    const r = wrap.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (!r.width) return;
    const css = Math.min((r.width - 24) / PW, (r.height - 24) / PH);
    scale = css * dpr;
    Object.assign(cv, { width: Math.round(PW * scale), height: Math.round(PH * scale) });
    Object.assign(cv.style, { width: `${PW * css}px`, height: `${PH * css}px` });
    redraw();
  };
  new ResizeObserver(() => view === 'editor' && fit()).observe(wrap);
  // the finished strokes are cached on a canvas; the live stroke / lasso draw over it
  const redraw = () => {
    cache ??= document.createElement('canvas');
    Object.assign(cache, { width: cv.width, height: cv.height });
    renderPage(cache.getContext('2d'), page(), book.template, scale, sel?.moving ? new Set(sel.strokes) : null);
    paint();
  };
  const paint = (live) => {
    ctx.drawImage(cache, 0, 0);
    if (live) drawStroke(ctx, live, scale);
    if (sel) {
      const d = sel.moving ? sel.d : [0, 0];
      if (sel.moving) { ctx.save(); ctx.translate(d[0] * scale, d[1] * scale); sel.strokes.forEach(st => drawStroke(ctx, st, scale)); ctx.restore(); }
      if (sel.box) { const b = sel.box; ctx.save(); ctx.setLineDash([8, 6]); ctx.strokeStyle = '#4a57b8'; ctx.lineWidth = 2; ctx.strokeRect((b.x0 + d[0] - 10) * scale, (b.y0 + d[1] - 10) * scale, (b.x1 - b.x0 + 20) * scale, (b.y1 - b.y0 + 20) * scale); ctx.restore(); }
    }
    if (lasso) { ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = '#4a57b8'; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < lasso.length; i += 2) ctx.lineTo(lasso[i] * scale, lasso[i + 1] * scale); ctx.stroke(); ctx.restore(); }
  };
  const commit = () => { redo = []; book.last = pageIx + 1; touch(book); redraw(); syncBar(); };
  const snap = () => { hist.push({ ix: pageIx, strokes: page().strokes.slice() }); if (hist.length > 100) hist.shift(); };
  const undo = () => { const s = hist.pop(); if (!s) return; redo.push({ ix: s.ix, strokes: book.pages[s.ix].strokes.slice() }); book.pages[s.ix].strokes = s.strokes; go(s.ix); touch(book); };
  const redoIt = () => { const s = redo.pop(); if (!s) return; hist.push({ ix: s.ix, strokes: book.pages[s.ix].strokes.slice() }); book.pages[s.ix].strokes = s.strokes; go(s.ix); touch(book); };
  const go = ix => { pageIx = Math.max(0, Math.min(book.pages.length - 1, ix)); sel = null; pageLabel.textContent = `Page ${pageIx + 1} of ${book.pages.length}`; book.last = pageIx + 1; redraw(); syncBar(); };

  // ---- pen input ----
  let tool = 'pen', live = null, lasso = null, drag = null, eraseHit = false;
  const at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * PW, (e.clientY - r.top) / r.height * PH, e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.5]; };
  const hits = (st, x, y, rad) => { for (let i = 0; i < st.pts.length; i += 3) if ((st.pts[i] - x) ** 2 + (st.pts[i + 1] - y) ** 2 < rad * rad) return true; return false; };
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 5 && e.pointerType !== 'touch' || (e.pointerType === 'touch' && penSeen)) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const [x, y, p] = at(e), eraser = tool === 'eraser' || e.button === 5;
    if (sel?.box && x > sel.box.x0 - 14 && x < sel.box.x1 + 14 && y > sel.box.y0 - 14 && y < sel.box.y1 + 14) { drag = [x, y]; sel.moving = true; sel.d = [0, 0]; redraw(); return; }
    if (sel) { sel = null; syncBar(); }
    if (tool === 'select') { lasso = [x, y]; paint(); return; }
    if (eraser) { snap(); eraseHit = false; eraseAt(x, y); return; }
    live = { pen: pen.pen, size: SIZES.find(s => s[0] === pen.size)[2], color: pen.color, pts: [x, y, p] };
    paint(live);
  });
  let penSeen = false;
  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'pen') penSeen = true;
    if (!cv.hasPointerCapture(e.pointerId)) return;
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs.length ? evs : [e]) {
      const [x, y, p] = at(ev);
      if (drag) { sel.d = [x - drag[0], y - drag[1]]; }
      else if (lasso) lasso.push(x, y);
      else if (tool === 'eraser' || e.buttons & 32) eraseAt(x, y);
      else if (live) { const q = live.pts; if ((q.at(-3) - x) ** 2 + (q.at(-2) - y) ** 2 > 2) q.push(x, y, p); }
    }
    paint(live);
  });
  const eraseAt = (x, y) => {
    const st = page().strokes, keep = st.filter(s => !hits(s, x, y, 16));
    if (keep.length !== st.length) { page().strokes = keep; eraseHit = true; redraw(); }
  };
  const end = () => {
    if (drag) {
      const [dx, dy] = sel.d; drag = null; sel.moving = false;
      if (dx || dy) { snap(); sel.strokes.forEach(st => { for (let i = 0; i < st.pts.length; i += 3) { st.pts[i] += dx; st.pts[i + 1] += dy; } }); sel.box = unionBox(sel.strokes); commit(); } else redraw();
      return;
    }
    if (lasso) {
      const strokes = page().strokes.filter(st => { let n = 0, inside = 0; for (let i = 0; i < st.pts.length; i += 3) { n++; if (inPoly(st.pts[i], st.pts[i + 1], lasso)) inside++; } return inside / n > 0.5; });
      lasso = null; sel = strokes.length ? { strokes, box: unionBox(strokes) } : null; paint(); syncBar(); return;
    }
    if (tool === 'eraser') { if (eraseHit) commit(); else hist.pop(); return; }
    if (live) { snap(); page().strokes.push(live); live = null; commit(); }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  const unionBox = sts => sts.map(bbox).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));

  // ---- selection actions ----
  let clip = null;
  const clone = sts => sts.map(st => ({ ...st, pts: st.pts.slice() }));
  const selBar = h('div.nb-selbar', { hidden: true },
    h('button', { type: 'button', onclick: () => { clip = clone(sel.strokes); } }, icon('copy'), h('span', {}, 'Copy')),
    h('button', { type: 'button', onclick: () => { clip = clone(sel.strokes); snap(); page().strokes = page().strokes.filter(s => !sel.strokes.includes(s)); sel = null; commit(); } }, icon('scissors'), h('span', {}, 'Cut')),
    h('button', { type: 'button', onclick: () => { snap(); const c = clone(sel.strokes); c.forEach(st => { for (let i = 0; i < st.pts.length; i += 3) { st.pts[i] += 40; st.pts[i + 1] += 40; } }); page().strokes.push(...c); sel = { strokes: c, box: unionBox(c) }; commit(); } }, icon('copy'), h('span', {}, 'Duplicate')),
    h('button', { type: 'button', onclick: () => { snap(); page().strokes = page().strokes.filter(s => !sel.strokes.includes(s)); sel = null; commit(); } }, icon('trash'), h('span', {}, 'Delete')));
  const paste = () => { if (!clip) return; snap(); const c = clone(clip); page().strokes.push(...c); sel = { strokes: c, box: unionBox(c) }; commit(); };
  const syncBar = () => {
    selBar.hidden = !sel?.box;
    if (sel?.box) { const r = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), k = r.width / PW; Object.assign(selBar.style, { left: `${r.left - wr.left + (sel.box.x0 + sel.box.x1) / 2 * k}px`, top: `${Math.max(8, r.top - wr.top + sel.box.y0 * k - 58)}px` }); }
    undoB.disabled = !hist.length; redoB.disabled = !redo.length;
  };

  // ---- toolbar ----
  let popEl = null;
  const closePop = () => { popEl?.remove(); popEl = null; };
  const pop = (anchor, ...kids) => {
    const again = popEl?.anchor === anchor; closePop(); if (again) return;
    popEl = h('div.nb-pop', {}, ...kids); popEl.anchor = anchor; root.append(popEl);
    const r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    Object.assign(popEl.style, { left: `${Math.max(8, Math.min(rr.width - popEl.offsetWidth - 8, r.left - rr.left))}px`, top: `${r.bottom - rr.top + 6}px` });
  };
  addEventListener('pointerdown', e => { if (popEl && !popEl.contains(e.target) && !popEl.anchor.contains(e.target)) closePop(); }, true);
  const setTool = t => { tool = t; sel = null; closePop(); paint(); syncTools(); syncBar(); };
  const choice = (list, cur, fn, render) => h('div.nb-choices', {}, list.map(it => h('button.nb-choice', { type: 'button', className: it[0] === cur ? 'on' : '', onclick: () => { fn(it[0]); local.set('pp.nbPen', pen); penPop(); syncTools(); } }, render(it))));
  const penDot = (id) => { const c = h('canvas', { width: 64, height: 28 }), x = c.getContext('2d'); x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, 64, 28); drawStroke(x, { pen: id, size: 1.2, color: pen.color, pts: [8, 20, .3, 20, 10, .6, 34, 18, .9, 48, 8, .6, 56, 14, .4] }, 1); return c; };
  const penPop = () => { const a = penB; if (popEl?.anchor === a) closePop(); pop(a,
    h('div.nb-plabel', {}, 'Pen'), choice(PENS, pen.pen, v => { pen.pen = v; if (v === 'highlighter' && ['#1b1d23', '#8c8f97'].includes(pen.color)) pen.color = '#e8c547'; }, ([id, l]) => [penDot(id), h('span', {}, l)]),
    h('div.nb-plabel', {}, 'Thickness'), choice(SIZES, pen.size, v => { pen.size = v; }, ([, l, w]) => [h('i.nb-thick', { style: { height: `${w * 2.5}px` } }), h('span', {}, l)]),
    h('div.nb-plabel', {}, 'Color'), choice(INKS, pen.color, v => { pen.color = v; }, ([c, l]) => [h('i.nb-ink', { style: { background: c } }), h('span', {}, l)])); };
  const penB = h('button.ibtn.nb-tool', { type: 'button', 'data-tip': 'Pens', onclick: () => { if (tool !== 'pen') setTool('pen'); else penPop(); } }, icon('pen'));
  const eraseB = iconBtn('eraser', 'Eraser (erases whole strokes)', () => setTool('eraser'), { className: 'ibtn nb-tool' });
  const selB = iconBtn('lasso', 'Select (lasso strokes, then drag, copy or delete)', () => setTool('select'), { className: 'ibtn nb-tool' });
  const undoB = iconBtn('undo', 'Undo', undo), redoB = iconBtn('redo', 'Redo', redoIt);
  const syncTools = () => { penB.classList.toggle('on', tool === 'pen'); eraseB.classList.toggle('on', tool === 'eraser'); selB.classList.toggle('on', tool === 'select'); penB.style.setProperty('--ink', pen.color); };
  const menuItem = (ic, label, fn) => h('button.nb-mitem', { type: 'button', onclick: () => { closePop(); fn(); } }, icon(ic), h('span', {}, label));
  const exportPage = async () => { const c = h('canvas', { width: PW, height: PH }); renderPage(c.getContext('2d'), page(), book.template); download(await toBlob(c, 'image/png'), `${book.name} p${pageIx + 1}.png`); };
  const moreB = iconBtn('menu', 'Page menu', e => pop(e.currentTarget,
    menuItem('plus', 'New page after this', () => { snapBook(); book.pages.splice(pageIx + 1, 0, { strokes: [] }); touch(book); go(pageIx + 1); }),
    menuItem('copy', 'Duplicate page', () => { book.pages.splice(pageIx + 1, 0, { strokes: clone(page().strokes) }); touch(book); go(pageIx + 1); }),
    menuItem('paste', 'Paste', paste),
    menuItem('grid', 'Change template…', changeTemplate),
    menuItem('image', 'Export page as PNG', exportPage),
    menuItem('brush', 'Send page to Draw as a layer', () => { const c = h('canvas', { width: PW, height: PH }), x = c.getContext('2d'); page().strokes.forEach(st => drawStroke(x, st)); sendToCanvas(c); }),
    menuItem('trash', 'Delete page', async () => { if (book.pages.length === 1) { snap(); page().strokes = []; return commit(); } if (await modal('Delete this page?', h('p', {}, 'Its writing goes with it.'), [['Cancel', null], ['Delete', 'ok', 'danger']])) { book.pages.splice(pageIx, 1); hist = []; redo = []; touch(book); go(pageIx); } })));
  const snapBook = () => { hist = []; redo = []; };
  async function changeTemplate() {
    const v = await form('Template', [{ id: 't', label: 'Template', type: 'select', options: TEMPLATES, value: book.template }], 'Apply');
    if (v) { book.template = v.t; touch(book); redraw(); }
  }
  const bar = h('header.nb-bar', {},
    iconBtn('chevronLeft', 'My files', () => showLibrary()),
    penB, eraseB, selB, undoB, redoB,
    h('span.nb-title', {}),
    moreB,
    iconBtn('x', 'Close notebook', () => showLibrary()));
  const nav = h('div.nb-nav', {},
    iconBtn('chevronLeft', 'Previous page', () => go(pageIx - 1)), pageLabel,
    iconBtn('chevronRight', 'Next page (adds one at the end)', () => { if (pageIx === book.pages.length - 1) { book.pages.push({ strokes: [] }); touch(book); } go(pageIx + 1); }));
  const editor = h('div.nb-editor', {}, bar, h('div.nb-stage', {}, wrap, selBar), nav);
  addEventListener('keydown', e => {
    if (view !== 'editor' || root.hidden || e.target.closest?.('input, textarea')) return;
    const k = (e.ctrlKey || e.metaKey) && e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? redoIt() : undo(); }
    else if (k === 'y') { e.preventDefault(); e.stopPropagation(); redoIt(); }
    else if (k === 'v') { e.preventDefault(); e.stopPropagation(); paste(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); snap(); page().strokes = page().strokes.filter(s => !sel.strokes.includes(s)); sel = null; commit(); }
    else if (e.key === 'PageDown' || e.key === 'ArrowRight' && !sel) go(pageIx + 1);
    else if (e.key === 'PageUp' || e.key === 'ArrowLeft' && !sel) go(pageIx - 1);
  }, true);

  function openBook(b) {
    book = b; view = 'editor'; hist = []; redo = []; sel = null; tool = 'pen';
    bar.querySelector('.nb-title').textContent = b.name;
    root.replaceChildren(editor, slot);
    requestAnimationFrame(() => { fit(); go((b.last ?? 1) - 1); syncTools(); });
  }
  function showLibrary() { closePop(); view = 'library'; book = null; root.replaceChildren(libEl, slot); renderLibrary(); }

  idb.get('notebooks').then(s => { if (s?.notebooks) lib = s; showLibrary(); }).catch(showLibrary);
  root.classList.add('nb');
  return { slot, show: on => { root.hidden = !on; if (on && view === 'editor') requestAnimationFrame(fit); } };
}
