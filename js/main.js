import { $, h } from './ui/dom.js';
import { bus } from './core/bus.js';
import { local } from './core/storage.js';
import { actions, bindKeys, isTyping } from './core/actions.js';
import { isTouchDevice } from './core/util.js';
import { initEink } from './ui/eink.js';
import { Doc } from './engine/document.js';
import { App } from './app.js';
import { createProject } from './project.js';
import { defineActions } from './appActions.js';
import { Panels } from './ui/panels.js';
import { toolbar } from './ui/toolbar.js';
import { colorPicker } from './ui/colorPanel.js';
import { palettePanel } from './ui/palettePanel.js';
import { initWorkspaces } from './ui/workspaces.js';
import { initTiles, tilesPanel } from './ui/tiles.js';
import { initVoxels } from './ui/voxels.js';
import { docTabs } from './ui/tabs.js';
import { migrateSpriteStudio } from './ui/spriteMigration.js';
import { brushLibrary, brushSettings, loadCustomTips } from './ui/brushPanel.js';
import { layersPanel } from './ui/layersPanel.js';
import { historyPanel } from './ui/historyPanel.js';
import { navigatorPanel, referencePanel } from './ui/navigator.js';
import { initPopupPalette } from './ui/popupPalette.js';
import { initTimeline } from './ui/timeline.js';
import { showWelcome } from './ui/welcome.js';
import { menubar } from './ui/menubar.js';
import { MODES, THEMES, LEGACY, modeSwitch, modeToggles } from './ui/modes.js';
import { optionsBar } from './ui/optionsbar.js';
import { statusbar } from './ui/statusbar.js';
import { initTooltips } from './ui/tooltip.js';
import { initSelects } from './ui/selects.js';
import { toast } from './ui/dialogs.js';
import { Mascot } from './ui/mascot.js';
import { initRoster } from './ui/pyxlRoster.js';
import { initCamera } from './ui/camera.js';
import { openBuilder } from './ui/courseBuilder.js';
import { readCourseLink, readCourseFile } from './ui/courseShare.js';
import { careBody, openCareCard } from './ui/pyxlCare.js';
import { watchForUpdates, hideSplash } from './ui/updates.js';
import { initZen } from './ui/zen.js';
import { initNotes } from './ui/notes.js';
import { TOOL_META } from './tools/index.js';

const welcome = showWelcome();
loadCustomTips();
const app = new App($('#view'));
app.cameraUI = initCamera(app);   // camera folders (multiplane)
document.body.toggleAttribute('data-advanced', !!app.settings.advanced);
const project = createProject(app);
if (new URLSearchParams(location.search).has('perf')) import('./ui/perfHud.js').then(m => m.perfHud(app));   // frame monitor for hunting hitches
const panels = new Panels($('#workspace'));
const mascot = new Mascot(app);
initRoster(app, mascot);   // and her friends from shop eggs
mascot.keepDrawing = (c, name) => { setMode('paint'); project.importLayer(c, name); };
const zen = initZen(app, panels);
const notes = initNotes(app, c => { setMode('paint'); project.importLayer(c, 'Sketch note'); }, () => setMode('paint'));

// Opens a panel where it lives; in Focus, or when its dock is folded, as a flyout by the clicked control.
// isFolded, not folded[]: narrow screens fold the docks on their own, and a panel "opened" inside a
// folded rail never shows - the brush / eraser picker used to do nothing there.
const openPanel = (id, e) => {
  const p = panels.map.get(id), s = p.s;
  if (e?.currentTarget && (app.focus || (s.dock && panels.isFolded(s.dock)))) return panels.flyout(id, e.currentTarget);
  const wasShown = !s.hidden && !s.collapsed;
  panels.patch(id, { hidden: false, collapsed: false });
  // already open: point at it, so the click visibly does something
  if (wasShown) { p.el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); p.el.classList.remove('flash'); void p.el.offsetWidth; p.el.classList.add('flash'); }
};

panels.add('tools', 'Tools', 'brush', toolbar(app, e => openPanel('color', e)), { dock: 'left', order: 0 });
panels.add('color', 'Color', 'palette', colorPicker(app), { dock: 'right', order: 0 });
panels.add('palette', 'Palette', 'pixel', palettePanel(app), { dock: 'right', order: 5, hidden: true });
app.tiles = initTiles(app);
initVoxels(app);
panels.add('tiles', 'Tiles', 'tile', tilesPanel(app, app.tiles), { dock: 'right', order: 6, hidden: true });
// a tilesheet shows its panel when it opens or is made
const showTiles = d => d?.sheet && !panels.isOpen('tiles') && panels.patch('tiles', { hidden: false, collapsed: false });
bus.on('doc', showTiles); bus.on('sheet', showTiles);
panels.add('brushes', 'Brushes', 'grid', brushLibrary(app), { dock: 'right', order: 2 }, { grow: true });
panels.add('brushSettings', 'Brush Settings', 'sliders', brushSettings(app), { dock: null, hidden: true, x: 130, y: 16, w: 290, h: 520 });
panels.add('layers', 'Layers', 'layers', layersPanel(app), { dock: 'right', order: 1 }, { grow: true });
panels.add('navigator', 'Navigator', 'navigator', navigatorPanel(app), { dock: 'right', order: 3, hidden: true });
panels.add('reference', 'Reference', 'image', referencePanel(app), { dock: null, hidden: true, x: 440, y: 60, w: 280, h: 320 });
panels.add('pyxl', 'Pyxl', 'heart', careBody(mascot), { dock: 'right', order: 4, hidden: true });
// Clicking Pyxl shows her docked panel when it's open, else her draggable popup (which can dock itself).
const dockable = () => app.mode === 'paint' && !app.focus;
mascot.openCare = () => (dockable() && panels.isOpen('pyxl') ? openPanel('pyxl') : openCareCard(mascot, dockable() && (() => openPanel('pyxl'))));
panels.add('history', 'History', 'history', historyPanel(app), { dock: null, hidden: true, x: 440, y: 16, w: 230, h: 320 });
initPopupPalette(app);

// Modes: Draw ('paint') and Notes. Focus hides the chrome (remembered per mode; Draw starts focused on
// touch screens). The chrome's CSS follows data-layout, and the theme follows data-theme. Pixel art is
// part of Draw: the old 'pixel' mode (Sprite Studio, links, installs) opens Draw's Pixel Art workspace.
const focus = local.get('pp.focus', { paint: isTouchDevice, notes: false });
function setMode(mode) {
  const legacy = LEGACY[mode];
  if (legacy) { if (legacy.focus) { focus.paint = true; local.set('pp.focus', focus); } if (legacy.theme) setTheme(legacy.theme); mode = legacy.mode; }
  if (mode === 'pixel') { mode = 'paint'; workspaces.use('pixel'); }
  if (!MODES.some(m => m[0] === mode)) mode = 'paint';
  app.tool.interrupt?.();
  app.mode = mode;
  document.body.dataset.mode = mode;
  local.set('pp.mode', mode);
  notes.show(mode === 'notes');
  applyFocus();
}
function applyFocus() {
  const mode = app.mode;
  app.focus = !!focus[mode];
  document.body.dataset.layout = mode === 'notes' ? 'notes' : app.focus ? 'zen' : 'paint';
  document.body.toggleAttribute('data-focus', app.focus);
  mascot.mount(mode === 'notes' ? notes.slot : app.focus ? zen.slot : $('#mascotSlot'));
  modeBox.replaceChildren(modeSwitch(mode, { focus: app.focus, theme: app.settings.theme }));
  notes.toggles.replaceChildren(...modeToggles(mode, { focus: app.focus, theme: app.settings.theme }));
  bus.emit('mode', mode);
  requestAnimationFrame(() => app.view.resize());
}
function toggleFocus(on = !app.focus) {
  focus[app.mode] = on;
  local.set('pp.focus', focus);
  applyFocus();
}
// Paper is a theme with its own feel: e-ink colours, no animation, and a pencil-on-paper brush profile.
function setTheme(theme) {
  if (!THEMES.some(t => t[0] === theme)) theme = 'dark';
  if (app.settings.theme !== theme) app.setSetting('theme', theme);
  document.body.classList.toggle('light', theme === 'light');
  document.body.dataset.theme = theme;
  app.profile = theme === 'paper' ? { smoothing: 0.3, grain: 0.35 } : {};
  app.view.flat = theme === 'paper'; app.view.themeChecker(); app.view.redraw();
  if (modeBox.isConnected) modeBox.replaceChildren(modeSwitch(app.mode, { focus: app.focus, theme }));
  notes.toggles.replaceChildren(...modeToggles(app.mode, { focus: app.focus, theme }));
  bus.emit('theme', theme);
}

const timeline = initTimeline(app, $('#timeline'));
const modeBox = document.createElement('div');
const workspaces = initWorkspaces(app, panels, { timeline });
const { menus } = defineActions(app, { panels, project, setMode, toggleFocus, setTheme, timeline, mascot, workspaces });
menubar($('#menubar'), menus, modeBox);
// The drawing's name in the middle of the menu bar (Krita's document tab): click it to rename.
const docName = h('input.doc-title', { spellcheck: false, 'aria-label': 'Drawing name', 'data-tip': 'Drawing name: click to rename',
  onkeydown: e => (e.key === 'Enter' || e.key === 'Escape') && docName.blur(),
  onfocus: () => { docName.value = app.doc.name || 'Untitled'; },
  onblur: () => showName(),
  onchange: () => { const n = docName.value.trim() || 'Untitled'; app.doc.name = docName.value = n; if (app.doc.libId) project.library.rename(app.doc.libId, n); } });
// a drawing saved to a file says which, and shows a dot while it has changes the file doesn't
const showName = () => {
  const d = app.doc;
  if (document.activeElement !== docName) docName.value = `${d?.name || 'Untitled'}${project.files.unsaved(d) ? ' •' : ''}`;
  docName.dataset.tip = d?.fileHandle ? `${d.fileHandle.name}${project.files.unsaved(d) ? ': not saved yet (Ctrl+S)' : ': saved'} · click to rename` : 'Drawing name: click to rename';
};
bus.on('doc', showName); bus.on('saved', showName); bus.on('history', showName); showName();
$('#menubar > .spacer').append(docName);
// the brush chip always drops the library down under itself, wherever the Brushes panel lives
optionsBar(app, $('#optionsbar'), e => panels.flyout('brushes', e.currentTarget));
// Mouse wheel scrolls the options bar sideways when it overflows (sliders keep their own wheel).
$('#optionsbar').addEventListener('wheel', e => {
  const bar = e.currentTarget;
  if (bar.scrollWidth <= bar.clientWidth || e.deltaX || e.target.matches('input[type=range], select')) return;
  bar.scrollLeft += e.deltaY; e.preventDefault();
}, { passive: false });
statusbar(app, $('#statusbar'), $('#view'));
initTooltips();
initSelects();
// Ask the browser to keep this app's storage (Pyxl, drawings, notebooks) instead of clearing it when
// space runs low or the site goes unused for a while. Asked on the first tap / click, since some
// browsers show a prompt for it; most grant it quietly.
addEventListener('pointerdown', () => navigator.storage?.persisted?.().then(p => p || navigator.storage.persist()).catch(() => {}), { once: true, capture: true });
bindKeys();
panels.apply(local.get('pp.layout'));
bus.on('toast', toast);
// touch: a finger covers the button it just tapped, so a tool change also names the new tool
const coarsePointer = matchMedia('(pointer: coarse)');
bus.on('tool', t => coarsePointer.matches && toast(TOOL_META.find(m => m[0] === t.id)?.[1] ?? t.id));
watchForUpdates(() => project.saveLocal(true));

// Right-click belongs to the app (the colour pop-up, the editors' menus): the browser's own menu, with
// its "Save image as…", only appears where text is being edited.
// Palm rejection for the whole app: while drawing with a pen, a hand resting on the screen must not
// press buttons or move panels — touches right after pen activity, and palm-sized contacts, are swallowed.
{
  let penAt = -1e9, penUsed = false;
  const rejected = new Set();
  const note = e => { if (e.pointerType === 'pen') { penAt = e.timeStamp; penUsed = true; } };
  addEventListener('pointermove', note, { capture: true, passive: true });
  addEventListener('pointerdown', e => {
    note(e);
    if (e.pointerType !== 'touch' || !penUsed || e.target.closest?.('#view, .nb-paper')) return;   // the canvases handle their own
    if (e.timeStamp - penAt < 600 || e.width * e.height > 1600) { rejected.add(e.pointerId); e.stopPropagation(); e.preventDefault(); }
  }, true);
  const drop = e => { if (rejected.has(e.pointerId)) { e.stopPropagation(); e.preventDefault(); if (e.type === 'click' || e.type === 'pointercancel') rejected.delete(e.pointerId); } };
  ['pointermove', 'pointerup', 'pointercancel', 'click'].forEach(t => addEventListener(t, drop, true));
}
addEventListener('contextmenu', e => { if (!e.target.closest?.('input, textarea, [contenteditable="true"]')) e.preventDefault(); });

// Touch and pen: sliders take sideways drags and let up/down scroll their panel (CSS pan-y). A
// finger that lands on one as a scroll begins has already moved it, so it's put back.
addEventListener('pointerdown', e => {
  const i = e.target;
  if (e.pointerType === 'mouse' || !(i instanceof HTMLInputElement) || i.type !== 'range' || i.classList.contains('vslider')) return;
  const v = i.value;
  const done = () => { i.removeEventListener('pointercancel', undo); i.removeEventListener('pointerup', done); };
  const undo = () => { done(); if (i.value !== v) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } };
  i.addEventListener('pointercancel', undo); i.addEventListener('pointerup', done);
}, true);

// Keeps the screen on while you work: some tablets dim mid-drawing because pen input doesn't
// always count as activity to the system. Let go after two quiet minutes.
{
  let lock = null, asking = false, timer = 0;
  const awake = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { lock?.release(); lock = null; }, 2 * 60000);
    if (lock || asking || !navigator.wakeLock || document.hidden) return;
    asking = true;
    navigator.wakeLock.request('screen').then(l => { lock = l; l.addEventListener('release', () => { if (lock === l) lock = null; }); }).catch(() => {}).finally(() => { asking = false; });
  };
  addEventListener('pointerdown', awake, { capture: true, passive: true });
  addEventListener('keydown', awake, { capture: true, passive: true });
}

// Space = temporary hand tool.
addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e) && !app.keys.space) { app.keys.space = true; app.input.updateCursor(); e.preventDefault(); } });
addEventListener('keyup', e => { if (e.code === 'Space') { app.keys.space = false; app.input.updateCursor(); } });
// Space released while another window had focus never sends keyup: without this every press would pan.
addEventListener('blur', () => { if (app.keys.space) { app.keys.space = false; app.input.updateCursor(); } });

// Drop files: projects/images open; images dropped on an open canvas become layers.
const stage = $('#stage');
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault();
  // the file's handle (Chrome / Edge) has to be asked for during the drop itself: with it, Save writes back to that file
  const handles = [...e.dataTransfer.items].map(i => (i.kind === 'file' ? i.getAsFileSystemHandle?.() : null));
  [...e.dataTransfer.files].forEach(async (f, i) => {
    if (/\.course$/i.test(f.name)) return f.text().then(t => { const c = readCourseFile(t); c ? openBuilder(mascot, { course: c, shared: true }) : toast('That isn’t a PixelPaint course file'); });
    if (/\.(ora|pp|aseprite|ase|pxpaint)$/i.test(f.name)) return project.openFile(f, (await handles[i]?.catch(() => null)) ?? null);
    if (f.type.startsWith('image/')) project.importLayer(f, f.name);
  });
});

// Escape leaves a text box (a dialog's Escape closes the dialog instead)
addEventListener('keydown', e => { if (e.key === 'Escape' && isTyping(e) && !e.target.closest('.modal-back, #notes')) e.target.blur(); }, true);

initEink(app, mascot);
// the drawing you had open (a blank one is 'fresh': opening something replaces it rather than adding a tab)
const blank = () => Object.assign(new Doc(1920, 1080), { fresh: true });
const doc = await project.restore().catch(() => null) ?? blank();
if (!doc.libId) doc.fresh = true;
app.setDoc(doc);
// text starts at a size that suits the canvas (a speech bubble on a page, a label on a sprite), until you pick one
const textFits = d => { if (d && !app.opts.fontSizeSet) app.opts.fontSize = Math.max(8, Math.min(160, Math.round(Math.min(d.w, d.h) / 25))); };
bus.on('doc', textFits); textFits(app.doc);
app.files = project.files;
app.tabs = docTabs(app, $('#docTabs'), blank);
project.restoreTabs().catch(() => {});
// ?mode=… (old links and installs, e.g. ?mode=pixel) wins over the remembered mode.
const asked = new URLSearchParams(location.search).get('mode');
if (asked) history.replaceState(null, '', location.pathname);
setTheme(app.settings.theme);
setMode(asked ?? local.get('pp.mode', 'paint'));
globalThis.pixelpaint = app;
hideSplash(Promise.resolve());
migrateSpriteStudio(app, project.library).catch(() => {});
await welcome;

// A shared race course arrives in the link (#course=…): open it in the course builder.
const sharedCourse = async () => {
  if (!location.hash.startsWith('#course=')) return;
  const c = await readCourseLink();
  history.replaceState(null, '', location.pathname + location.search);
  if (!c) return toast('That course link looks broken — ask for the .course file instead');
  if (app.mode === 'notes') setMode('paint');
  openBuilder(mascot, { course: c, shared: true });
};
sharedCourse();
addEventListener('hashchange', sharedCourse);
