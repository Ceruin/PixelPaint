import { h, icon, iconBtn } from './dom.js';
import { drawPose } from './mascot.js';
import { pixelText } from './pixelFont.js';
import { modal, toast } from './dialogs.js';
import { download } from '../core/util.js';
import { local } from '../core/storage.js';
import { arena } from './pyxlRace.js';
import { COURSE_VERSION, generateCourse, prepareTrack, drawTrack, flag, normalizeCourse, LIMITS } from './raceCourse.js';
import { listCourses, saveCourse, deleteCourse, courseFile, fileName, readCourseFile, courseLink } from './courseShare.js';

// The course builder, Line Rider / Mario Maker style: draw lines right over your drawing (it's the
// backdrop, untouched), add water, jump pads, spikes and the two flags, then test-ride it with your
// Pyxl or race it against rivals. Courses save on this device and share as a link or a .course file.
const TOOLS = [
  ['pen', 'Pen: draw the ground (P)', 'pen', 'p'],
  ['line', 'Straight line (L) — Shift snaps', 'line', 'l'],
  ['eraser', 'Eraser (E)', 'eraser', 'e'],
  ['water', 'Water: drag a pool (W)', 'water', 'w'],
  ['pad', 'Jump pad: tap on the ground (J)', 'spring', 'j'],
  ['hazard', 'Spikes: drag a zone — touching it sends a racer back (H)', 'spikes', 'h'],
  ['start', 'Start flag (S)', 'flag', 's'],
  ['finish', 'Finish flag (F)', 'finish', 'f'],
];
const ERASE_R = 9, PEN_STEP = 6;
const blank = (W, H) => ({ v: COURSE_VERSION, name: 'My course', w: W, h: H, segs: [], water: [], hazards: [], takes: [], start: null, finish: null });
const segDist = (px, py, [ax, ay, bx, by]) => { const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1, u = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)); return Math.hypot(px - ax - ex * u, py - ay - ey * u); };
// Ramer–Douglas–Peucker: a hand-drawn stroke as few straight lines as keep its shape
function simplify(pts, tol = 1.6) {
  if (pts.length < 3) return pts;
  let at = 0, far = 0; const [a, b] = [pts[0], pts.at(-1)];
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i][0], pts[i][1], [...a, ...b]); if (d > far) { far = d; at = i; } }
  return far > tol ? [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)] : [a, b];
}

// A little picture of a course, for the list.
export function courseThumb(c, w = 96, hh = 56) {
  const cv = h('canvas.cb-thumb', { width: w, height: hh }), x = cv.getContext('2d'), k = Math.min(w / c.w, hh / c.h), ox = (w - c.w * k) / 2, oy = (hh - c.h * k) / 2;
  const P = (px, py) => [ox + px * k, oy + py * k];
  x.fillStyle = 'rgba(70,140,255,.5)'; for (const [a, b, d, e] of c.water) { const [p, q] = P(a, b), [r, s] = P(d, e); x.fillRect(p, q, r - p, s - q); }
  x.fillStyle = 'rgba(224,72,90,.6)'; for (const [a, b, d, e] of c.hazards) { const [p, q] = P(a, b), [r, s] = P(d, e); x.fillRect(p, q, r - p, s - q); }
  x.strokeStyle = '#221822'; x.lineWidth = 1.2; x.lineCap = 'round'; x.beginPath();
  for (const [a, b, d, e] of c.segs) { x.moveTo(...P(a, b)); x.lineTo(...P(d, e)); }
  x.stroke();
  const dot = (p, col) => { if (!p) return; const [px, py] = P(...p); x.fillStyle = col; x.fillRect(px - 2, py - 6, 4, 6); };
  dot(c.start, '#2fb36b'); dot(c.finish, '#221822');
  return cv;
}

let current = null;   // one builder at a time
export function openBuilder(pyxl, { course = null, id = null, shared = false, list = false } = {}) {
  if (current) { current.load(course, id); if (list) current.showList(); return current; }
  let c = course ? normalizeCourse(course) : null, savedId = id, savedJSON = c && id ? JSON.stringify(c) : null, tool = 'pen';
  const undo = [], redo = [];
  let W = 0, H = 0, T = null, ver = 0, tVer = -1, raf = 0, drag = null, hover = null, revealAt = 0, closed = false;

  const cv = h('canvas.race-canvas.cb-canvas'), ctx = cv.getContext('2d');
  const toolBtns = TOOLS.map(([tid, tip, ic]) => iconBtn(ic, tip, () => setTool(tid), { dataset: { tool: tid } }));
  const nameIn = h('input.cb-name', { type: 'text', maxLength: 40, 'aria-label': 'Course name', spellcheck: false });
  // the tool bar folds down to just the current tool (handy on a phone, where it covers the page)
  const fold = iconBtn('chevronsLeft', 'Fold the tools away', () => setFolded(!tools.classList.contains('folded')), { className: 'ibtn cb-fold' });
  const setFolded = on => { tools.classList.toggle('folded', on); fold.replaceChildren(icon(on ? 'chevronsRight' : 'chevronsLeft')); fold.dataset.tip = fold.ariaLabel = on ? 'Show all the tools' : 'Fold the tools away'; local.set('pp.cbFolded', on); };
  const undoBtn = iconBtn('undo', 'Undo (Ctrl+Z)', () => history(undo, redo)), redoBtn = iconBtn('redo', 'Redo (Ctrl+Shift+Z)', () => history(redo, undo));
  const tools = h('div.cb-tools', {}, fold, ...toolBtns, h('span.cb-sep'), undoBtn, redoBtn, iconBtn('trash', 'Clear the course', () => clearAll()));
  // folded, tapping the current tool opens the bar again
  tools.addEventListener('click', e => { if (tools.classList.contains('folded') && e.target.closest('.ibtn.on')) setFolded(false); });
  setFolded(local.get('pp.cbFolded', matchMedia('(max-width: 640px)').matches));
  const layer = h('div.race-layer.course.builder', {}, cv,
    tools,
    h('div.race-head', {}, icon('film'), nameIn, iconBtn('folder', 'My courses', () => showList()), iconBtn('x', 'Close the builder (Esc)', () => close())),
    h('div.race-foot.cb-foot', {},
      h('button.btn', { type: 'button', 'data-tip': 'Pyxl draws a course for you to change', onclick: () => pyxlDraws() }, icon('sparkle'), h('span.lbl', {}, 'Pyxl draws one')),
      h('button.btn', { type: 'button', 'data-tip': 'Ride it alone to try it out', onclick: () => ride('test') }, icon('play'), h('span.lbl', {}, 'Test ride')),
      h('button.btn', { type: 'button', 'data-tip': 'Race three rivals on it', onclick: () => ride('race') }, icon('star'), h('span.lbl', {}, 'Race')),
      h('button.btn', { type: 'button', 'data-tip': 'Save to My courses (Ctrl+S)', onclick: () => save() }, icon('save'), h('span.lbl', {}, 'Save')),
      h('button.btn.primary', { type: 'button', 'data-tip': 'Share as a link or a .course file', onclick: () => share() }, icon('share'), h('span.lbl', {}, 'Share'))));
  document.body.append(layer);
  document.body.dataset.game = '';

  const touch = () => { ver++; };
  const commit = () => { undo.push(JSON.stringify(c)); if (undo.length > 120) undo.shift(); redo.length = 0; syncBtns(); };
  const history = (from, to) => { if (!from.length) return; to.push(JSON.stringify(c)); c = JSON.parse(from.pop()); nameIn.value = c.name; touch(); syncBtns(); };
  const syncBtns = () => { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length; };
  const setTool = tid => { tool = tid; for (const b of toolBtns) b.classList.toggle('on', b.dataset.tool === tid); cv.dataset.tool = tid; };
  const load = (course2, id2 = null) => {
    if (!course2) return;
    c = normalizeCourse(course2); savedId = id2; savedJSON = id2 ? JSON.stringify(c) : null;
    undo.length = redo.length = 0; nameIn.value = c.name; touch(); syncBtns();
  };
  nameIn.addEventListener('input', () => { c.name = nameIn.value.slice(0, 40); });
  nameIn.addEventListener('change', () => { c.name = nameIn.value.trim() || 'My course'; nameIn.value = c.name; });

  const area = arena(pyxl.app, layer, cv, (w, hh) => { W = w; H = hh; if (!c) { c = blank(W, H); nameIn.value = c.name; } touch(); });
  nameIn.value = c.name;
  setTool('pen'); syncBtns();

  // ---------------------------------------------------------------- coordinates
  // the same fit the race uses (see prepareTrack): a course from another canvas shape is stretched a little
  const fitK = () => { const k = Math.min(W / c.w, H / c.h), kx = Math.min(W / c.w, k * 1.5), ky = Math.min(H / c.h, k * 1.5); return { k, kx, ky, ox: (W - c.w * kx) / 2, oy: (H - c.h * ky) / 2 }; };
  const toCourse = e => {
    const r = cv.getBoundingClientRect(), sx = (e.clientX - r.left) * cv.width / r.width, sy = (e.clientY - r.top) * cv.height / r.height, { kx, ky, ox, oy } = fitK();
    return [Math.round(Math.max(0, Math.min(c.w, (sx - ox) / kx))), Math.round(Math.max(0, Math.min(c.h, (sy - oy) / ky)))];
  };
  // a flag / pad goes on the ground just under where you tap (if there's ground close below)
  const snapDown = ([x, y]) => {
    let best = null;
    for (const [ax, ay, bx, by] of c.segs) {
      if (ax === bx || x < Math.min(ax, bx) || x > Math.max(ax, bx)) continue;
      const gy = ay + (by - ay) * (x - ax) / (bx - ax);
      if (gy >= y - 10 && gy - y < 48 && (best == null || gy < best)) best = gy;
    }
    return [x, Math.round(best ?? y)];
  };
  const full = (key, n) => { if (c[key].length < n) return false; toast('That’s as many as a course can have'); return true; };

  // ---------------------------------------------------------------- editing
  const eraseAt = ([x, y]) => {
    const r = ERASE_R / fitK().k * 1.6, n0 = c.segs.length + c.water.length + c.hazards.length + c.takes.length, inBox = ([a, b, d, e]) => x >= a - 2 && x <= d + 2 && y >= b - 2 && y <= e + 2;
    c.segs = c.segs.filter(s => segDist(x, y, s) > r);
    c.water = c.water.filter(z => !inBox(z)); c.hazards = c.hazards.filter(z => !inBox(z));
    c.takes = c.takes.filter(([tx, ty]) => Math.hypot(tx - x, ty - y) > r + 3);
    if (c.segs.length + c.water.length + c.hazards.length + c.takes.length !== n0) touch();
  };
  const snapAngle = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(dx, dy); return [Math.round(a[0] + Math.cos(ang) * L), Math.round(a[1] + Math.sin(ang) * L)]; };
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const p = toCourse(e);
    if (tool === 'pad' || tool === 'start' || tool === 'finish') {
      if (tool === 'pad' && full('takes', LIMITS.takes)) return;
      commit();
      const q = snapDown(p);
      if (tool === 'pad') c.takes.push(q);
      else c[tool] = q;
      return touch();
    }
    if (tool === 'eraser') { drag = { id: e.pointerId, before: JSON.stringify(c) }; eraseAt(p); return; }
    drag = { id: e.pointerId, a: p, b: p, pts: [p] };
  });
  cv.addEventListener('pointermove', e => {
    hover = toCourse(e);
    if (!drag || e.pointerId !== drag.id) return;
    const p = hover;
    if (tool === 'eraser') return eraseAt(p);
    if (tool === 'pen') { const l = drag.pts.at(-1); if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= PEN_STEP) drag.pts.push(p); }
    drag.b = tool === 'line' && e.shiftKey ? snapAngle(drag.a, p) : p;
  });
  const up = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (tool === 'eraser') { if (JSON.stringify(c) !== d.before) { undo.push(d.before); redo.length = 0; syncBtns(); } return; }
    if (tool === 'pen' || tool === 'line') {
      const pts = tool === 'pen' ? simplify([...d.pts, d.b]) : [d.a, d.b];
      const segs = []; for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) >= 3) segs.push([...pts[i - 1], ...pts[i]]);
      if (!segs.length) return;
      if (c.segs.length + segs.length > LIMITS.segs) return toast('That’s as many lines as a course can have');
      commit(); c.segs.push(...segs); return touch();
    }
    const box = [Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.max(d.a[0], d.b[0]), Math.max(d.a[1], d.b[1])];
    if (box[2] - box[0] < 8 || box[3] - box[1] < 6) return;
    const key = tool === 'water' ? 'water' : 'hazards';
    if (full(key, LIMITS[key])) return;
    commit(); c[key].push(box); touch();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', e => { if (drag?.id === e.pointerId) drag = null; });
  cv.addEventListener('pointerleave', () => { hover = null; });

  const clearAll = async () => {
    if (!c.segs.length && !c.water.length && !c.hazards.length && !c.takes.length && !c.start && !c.finish) return;
    commit(); Object.assign(c, { segs: [], water: [], hazards: [], takes: [], start: null, finish: null }); touch();
    toast('Cleared — Undo brings it back');
  };
  const pyxlDraws = () => {
    commit();
    const name = c.name, lvl = ['beginner', 'jewel', 'challenge'][Math.floor(Math.random() * 3)];
    c = { ...generateCourse(W, H, lvl), name }; touch(); revealAt = performance.now();
  };

  // ---------------------------------------------------------------- ride / save / share
  const ready = () => {
    if (!c.segs.length) { toast('Draw some ground first'); return false; }
    if (!c.start || !c.finish) { toast(`Put down a ${!c.start ? 'start' : 'finish'} flag first`); setTool(!c.start ? 'start' : 'finish'); return false; }
    return true;
  };
  const hide = on => { layer.hidden = on; if (on) cancelAnimationFrame(raf); else { area.fit(); raf = requestAnimationFrame(frame); document.body.dataset.game = ''; } };
  const ride = mode => {
    if (!ready()) return;
    hide(true);
    const r = pyxl.race(-1, { course: normalizeCourse(c), mode, onDone: () => !closed && hide(false) });
    if (!r) hide(false);   // she's asleep / too tired: stay here
  };
  const save = async () => {
    c.name = nameIn.value.trim() || 'My course'; nameIn.value = c.name;
    try { savedId = await saveCourse(c, savedId); savedJSON = JSON.stringify(c); toast(`Saved “${c.name}” to My courses`); }
    catch { toast('Couldn’t save — is storage full?'); }
  };
  const share = async () => {
    if (!ready()) return;
    const link = await courseLink(c).catch(() => null);
    const out = h('input.cb-link', { type: 'text', readOnly: true, value: link ?? '' });
    const body = h('div.cb-share', {},
      link ? [h('p', {}, 'Anyone who opens this link gets the course in their PixelPaint — no account, nothing uploaded.'), h('div.cb-linkrow', {}, out,
        h('button.btn.primary', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { out.select(); toast('Select the link and copy it'); } } }, icon('link'), h('span.lbl', {}, 'Copy link')))]
        : h('p', {}, 'This course is too big to fit in a link — share it as a file instead.'),
      h('p', {}, h('button.btn', { type: 'button', onclick: () => { download(courseFile(c), fileName(c)); toast('Course file saved'); } }, icon('download'), h('span.lbl', {}, `Save ${fileName(c)}`))),
      navigator.share && link ? h('p', {}, h('button.btn', { type: 'button', onclick: () => navigator.share({ title: c.name, text: `Race my PixelPaint course “${c.name}”!`, url: link }).catch(() => {}) }, icon('share'), h('span.lbl', {}, 'Share…'))) : '');
    modal(`Share “${c.name}”`, body, [['Done', null, true]]);
    out.addEventListener('focus', () => out.select());
  };
  const openFile = () => {
    const inp = h('input', { type: 'file', accept: '.course,application/json' });
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const got = f.size < 2e6 ? readCourseFile(await f.text()) : null;
      if (!got) return toast('That isn’t a PixelPaint course file');
      if (await keepChanges()) { load(got); toast(`Opened “${got.name}” — Save keeps it in My courses`); }
    };
    inp.click();
  };
  const dirty = () => (savedJSON ? JSON.stringify(c) !== savedJSON : !!(c.segs.length || c.start || c.finish));
  // before replacing / closing: true = go ahead (saved, or fine to drop the changes)
  const keepChanges = async () => {
    if (!dirty()) return true;
    const v = await modal('Save this course first?', h('p', {}, `“${c.name}” has changes that aren’t saved.`), [['Cancel', null], ['Don’t save', 'drop', 'danger'], ['Save', 'save', true]]);
    if (v === 'save') { await save(); return true; }
    return v === 'drop';
  };
  const showList = async () => {
    const all = await listCourses(), body = h('div.cb-list');
    let closeList = () => {};
    const row = e => h('div.cb-item', {}, courseThumb(e.course),
      h('div.cb-meta', {}, h('b', {}, e.course.name), h('small', {}, new Date(e.saved).toLocaleDateString())),
      h('button.btn.sm.primary', { type: 'button', onclick: async () => { closeList(); if (await keepChanges()) load(e.course, e.id); } }, h('span.lbl', {}, 'Open')),
      iconBtn('download', 'Save as a .course file', () => download(courseFile(e.course), fileName(e.course))),
      iconBtn('trash', 'Delete', async ev => {
        const it = ev.currentTarget.closest('.cb-item');
        await deleteCourse(e.id); it.remove(); if (savedId === e.id) { savedId = null; savedJSON = null; }
        if (!body.querySelector('.cb-item')) body.prepend(h('p.cb-empty', {}, 'No saved courses yet.'));
      }));
    body.append(...(all.length ? all.map(row) : [h('p.cb-empty', {}, 'No saved courses yet. Draw one and press Save!')]),
      h('div.cb-listacts', {},
        h('button.btn', { type: 'button', onclick: () => { closeList(); openFile(); } }, icon('upload'), h('span.lbl', {}, 'Open a .course file')),
        h('button.btn', { type: 'button', onclick: async () => { closeList(); if (await keepChanges()) { load(blank(W, H)); } } }, icon('plus'), h('span.lbl', {}, 'New course'))));
    const p = modal('My courses', body, [['Close', null]], 'cb-modal');
    closeList = () => document.querySelector('.cb-modal')?.closest('.modal-back')?.querySelector('.modal-foot .btn')?.click();
    await p;
  };

  // ---------------------------------------------------------------- drawing
  const frame = now => {
    raf = requestAnimationFrame(frame);
    if (tVer !== ver) { T = prepareTrack(c, W, H); tVer = ver; }
    ctx.clearRect(0, 0, W, H);
    const { kx, ky, ox, oy } = fitK(), S = (x, y) => [ox + x * kx, oy + y * ky];
    if (ox > 1 || oy > 1) {   // the course was made for another shape: show its edges
      ctx.fillStyle = 'rgba(34,24,34,.35)';
      for (let x = Math.round(ox); x < ox + c.w * kx; x += 6) { ctx.fillRect(x, Math.round(oy), 3, 1); ctx.fillRect(x, Math.round(oy + c.h * ky) - 1, 3, 1); }
      for (let y = Math.round(oy); y < oy + c.h * ky; y += 6) { ctx.fillRect(Math.round(ox), y, 1, 3); ctx.fillRect(Math.round(ox + c.w * kx) - 1, y, 1, 3); }
    }
    const reveal = revealAt ? T.inkLen * Math.min(1, (now - revealAt) / 1400) : Infinity;
    const tip = drawTrack(ctx, T, { now, reveal, flags: false });
    if (revealAt && reveal >= T.inkLen) revealAt = 0;
    if (tip) drawPose(ctx, 'brush', tip[0] - 14, tip[1] + 2, 1);
    if (!revealAt) {
      if (c.start) { const [x, y] = S(...c.start); flag(ctx, x - 10, y, false); }
      if (c.finish) { const [x, y] = S(...c.finish); flag(ctx, x, y, true); }
    }
    // what you're drawing right now
    ctx.fillStyle = '#3b7bff';
    if (drag && (tool === 'pen' || tool === 'line')) {
      const pts = tool === 'pen' ? [...drag.pts, drag.b] : [drag.a, drag.b];
      ctx.strokeStyle = '#3b7bff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(...S(...pts[0])); for (const p of pts.slice(1)) ctx.lineTo(...S(...p)); ctx.stroke();
    } else if (drag && (tool === 'water' || tool === 'hazard')) {
      const [a, b] = S(...drag.a), [d, e] = S(...drag.b);
      ctx.fillStyle = tool === 'water' ? 'rgba(70,140,255,.35)' : 'rgba(224,72,90,.3)'; ctx.fillRect(Math.min(a, d), Math.min(b, e), Math.abs(d - a), Math.abs(e - b));
    }
    if (hover && tool === 'eraser') { const [x, y] = S(...hover); ctx.strokeStyle = 'rgba(34,24,34,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, ERASE_R * 1.6, 0, Math.PI * 2); ctx.stroke(); }
    else if (hover && !drag && (tool === 'pad' || tool === 'start' || tool === 'finish')) {   // where it'll land
      const [x, y] = S(...snapDown(hover));
      ctx.globalAlpha = 0.5; if (tool === 'pad') { ctx.fillStyle = '#ffd23f'; ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 7, 2); } else flag(ctx, tool === 'start' ? x - 10 : x, y, tool === 'finish'); ctx.globalAlpha = 1;
    }
    if (!c.segs.length && !drag && !revealAt) {
      pixelText(ctx, 'DRAW A COURSE!', W / 2, H * 0.36, '#221822', { size: 16, align: 'center', outline: '#ffffff' });
      pixelText(ctx, 'Pen for ground, then a start and a finish flag', W / 2, H * 0.36 + 34, '#221822', { align: 'center', outline: '#ffffff' });
    }
  };
  raf = requestAnimationFrame(frame);

  // ---------------------------------------------------------------- keys / closing
  const key = e => {
    if (layer.hidden || document.querySelector('.modal-back, .menu-drop, .tool-menu, .dd-pop')) return;   // a menu or dialog open over it has the keys
    e.stopPropagation();   // the app's own shortcuts sit this out
    if (e.target === nameIn) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); nameIn.blur(); } return; }
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? history(redo, undo) : history(undo, redo); }
    else if (mod && k === 'y') { e.preventDefault(); history(redo, undo); }
    else if (mod && k === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (!mod && !e.altKey) { const t = TOOLS.find(x => x[3] === k); if (t) { e.preventDefault(); setTool(t[0]); } }
  };
  addEventListener('keydown', key, true);
  const close = async () => {
    if (!(await keepChanges())) return;
    closed = true; current = null;
    cancelAnimationFrame(raf); area.stop(); removeEventListener('keydown', key, true);
    layer.remove(); delete document.body.dataset.game;
  };

  if (shared) toast(`“${c.name}” was shared with you — Test ride or Race it, and Save to keep it`);
  if (list) showList();
  current = { load: async (course2, id2) => { if (course2 && await keepChanges()) load(course2, id2); }, showList, close };
  return current;
}
