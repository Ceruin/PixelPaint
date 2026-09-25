import { $ } from './ui/dom.js';
import { bus } from './core/bus.js';
import { local } from './core/storage.js';
import { actions, bindKeys, isTyping } from './core/actions.js';
import { isTouchDevice } from './core/util.js';
import { flatten } from './engine/compositor.js';
import { initEink } from './ui/eink.js';
import { Doc } from './engine/document.js';
import { App } from './app.js';
import { createProject } from './project.js';
import { defineActions } from './appActions.js';
import { Panels } from './ui/panels.js';
import { toolbar } from './ui/toolbar.js';
import { colorPicker } from './ui/colorPanel.js';
import { brushLibrary, brushSettings, loadCustomTips } from './ui/brushPanel.js';
import { layersPanel } from './ui/layersPanel.js';
import { historyPanel } from './ui/historyPanel.js';
import { navigatorPanel, referencePanel } from './ui/navigator.js';
import { initPopupPalette } from './ui/popupPalette.js';
import { initTimeline } from './ui/timeline.js';
import { showWelcome } from './ui/welcome.js';
import { menubar } from './ui/menubar.js';
import { MODES, THEMES, LEGACY, modeSwitch } from './ui/modes.js';
import { optionsBar } from './ui/optionsbar.js';
import { statusbar } from './ui/statusbar.js';
import { initTooltips } from './ui/tooltip.js';
import { toast } from './ui/dialogs.js';
import { Mascot } from './ui/mascot.js';
import { careBody, openCareCard } from './ui/pyxlCare.js';
import { watchForUpdates, hideSplash } from './ui/updates.js';
import { initZen } from './ui/zen.js';
import { initNotes } from './ui/notes.js';

const welcome = showWelcome();
loadCustomTips();
const app = new App($('#view'));
const project = createProject(app);
const panels = new Panels($('#workspace'));
const mascot = new Mascot(app);
const zen = initZen(app, panels);
const notes = initNotes(app, c => { setMode('paint'); project.importLayer(c, 'Sketch note'); });

// Opens a panel where it lives; in Focus, or when its dock is folded, as a flyout by the clicked control.
const openPanel = (id, e) => {
  const s = panels.map.get(id).s;
  if (e?.currentTarget && (app.focus || (s.dock && panels.folded[s.dock]))) return panels.flyout(id, e.currentTarget);
  panels.patch(id, { hidden: false, collapsed: false });
};

panels.add('tools', 'Tools', 'brush', toolbar(app, e => openPanel('color', e)), { dock: 'left', order: 0 });
panels.add('color', 'Color', 'palette', colorPicker(app), { dock: 'right', order: 0 });
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

// Pixel mode: the pixel-art editor lives in #pixel (styles: css/pixel.css); its top bar replaces ours.
// Its script boots behind the boot splash, laid out at full size but parked off-screen: that one
// long task runs while the compositor-animated splash still covers the app. Out of Pixel mode it
// stays parked rather than display:none, so switching only moves it (no restyle of its ~500 nodes).
const pixelBox = $('#pixel'), pixelSlot = $('#pixelSlot'), pixelSpot = $('#pyxlSpot');
let pixelReady = null;
const loadPixel = () => pixelReady ??= new Promise(done => {
  const warm = app.mode !== 'pixel';
  pixelBox.classList.toggle('parked', warm); pixelBox.hidden = false;
  const s = Object.assign(document.createElement('script'), { src: 'js/pixel/editor.js' });
  s.onload = s.onerror = () => { if (app.mode === 'pixel') { if (warm) dispatchEvent(new Event('resize')); requestAnimationFrame(placePixelPyxl); } done(); };
  document.body.append(s);
});
const showPixel = on => {
  pixelSlot.hidden = true;
  if (!pixelReady) { if (on) loadPixel(); return; }
  pixelBox.classList.toggle('parked', !on);
  if (!on) return;
  dispatchEvent(new Event('resize'));
  requestAnimationFrame(placePixelPyxl);
};
// Pyxl stands in the editor's tool rail, over a spot it keeps free above Help (hidden if there's no room).
const placePixelPyxl = () => {
  const r = pixelSpot.getBoundingClientRect();
  pixelSlot.hidden = app.mode !== 'pixel' || r.width < 80 || r.height < 70;
  if (!pixelSlot.hidden) Object.assign(pixelSlot.style, { left: `${r.left + (r.width - 92) / 2}px`, top: `${r.bottom - 78}px` });
};
{ const ro = new ResizeObserver(placePixelPyxl); ro.observe(pixelSpot); ro.observe(pixelSpot.parentElement); }
pixelBox.addEventListener('click', e => {
  const b = e.target.closest('.mode-switch [data-mode]');
  if (b) { e.preventDefault(); setMode(b.dataset.mode); }
});
// App-wide items in the editor's Help menu (updates, guide, theme…).
pixelBox.addEventListener('pp-action', e => actions.run(e.detail));

// Workspaces: Draw ('paint'), Pixel, Notes. Focus hides the chrome (remembered per workspace; Draw
// starts focused on touch screens). The chrome's CSS follows data-layout, which Pixel leaves as it
// was (it covers the app), and the theme follows data-theme.
const focus = local.get('pp.focus', { paint: isTouchDevice, notes: false });
function setMode(mode) {
  const legacy = LEGACY[mode];
  if (legacy) { if (legacy.focus) { focus.paint = true; local.set('pp.focus', focus); } if (legacy.theme) setTheme(legacy.theme); mode = legacy.mode; }
  if (!MODES.some(m => m[0] === mode)) mode = 'paint';
  app.tool.interrupt?.();
  app.mode = mode;
  document.body.dataset.mode = mode;
  local.set('pp.mode', mode);
  if (mode !== 'pixel') notes.show(mode === 'notes');   // Pixel covers the app: leave it as it was
  showPixel(mode === 'pixel');
  applyFocus();
}
function applyFocus() {
  const mode = app.mode;
  app.focus = mode !== 'pixel' && !!focus[mode];
  if (mode !== 'pixel') {
    document.body.dataset.layout = mode === 'notes' ? 'notes' : app.focus ? 'zen' : 'paint';
    document.body.toggleAttribute('data-focus', app.focus);
  }
  mascot.mount(mode === 'notes' ? notes.slot : mode === 'pixel' ? pixelSlot : app.focus ? zen.slot : $('#mascotSlot'));
  modeBox.replaceChildren(modeSwitch(mode, { focus: app.focus, theme: app.settings.theme }));
  bus.emit('mode', mode);
  if (mode !== 'pixel') requestAnimationFrame(() => app.view.resize());
}
function toggleFocus(on = !app.focus) {
  if (app.mode === 'pixel') return;
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
  app.view.flat = theme === 'paper'; app.view.redraw();
  if (modeBox.isConnected) modeBox.replaceChildren(modeSwitch(app.mode, { focus: app.focus, theme }));
  bus.emit('theme', theme);
}

const timeline = initTimeline(app, $('#timeline'));
const modeBox = document.createElement('div');
const { menus } = defineActions(app, { panels, project, setMode, toggleFocus, setTheme, timeline });
// Hand-offs between Draw and the Pixel editor: the picture opens there as a new pixel drawing, and
// the Pixel editor's current frame comes back to Draw as a layer.
actions.define([
  { id: 'file.toPixel', label: 'Open in Pixel Editor', icon: 'pixel', run: async () => {
    const blob = await new Promise(r => flatten(app.doc).toBlob(r, 'image/png'));
    await loadPixel(); setMode('pixel');
    pixelBox.dispatchEvent(new CustomEvent('pp-open-image', { detail: new File([blob], `${app.doc.name || 'Drawing'}.png`, { type: 'image/png' }) }));
  } },
  { id: 'file.fromPixel', label: 'Send to Draw as a Layer', icon: 'brush', run: () => pixelBox.dispatchEvent(new CustomEvent('pp-get-frame', { detail: c => { setMode('paint'); project.importLayer(c, 'From Pixel'); } })) },
]);
menubar($('#menubar'), menus, modeBox);
optionsBar(app, $('#optionsbar'), e => openPanel('brushes', e));
// Mouse wheel scrolls the options bar sideways when it overflows (sliders keep their own wheel).
$('#optionsbar').addEventListener('wheel', e => {
  const bar = e.currentTarget;
  if (bar.scrollWidth <= bar.clientWidth || e.deltaX || e.target.matches('input[type=range], select')) return;
  bar.scrollLeft += e.deltaY; e.preventDefault();
}, { passive: false });
statusbar(app, $('#statusbar'), $('#view'));
initTooltips();
bindKeys(a => app.mode !== 'pixel' || /^mode\./.test(a.id));
panels.apply(local.get('pp.layout'));
bus.on('toast', toast);
watchForUpdates(() => project.saveLocal(true));

// Space = temporary hand tool.
addEventListener('keydown', e => { if (e.code === 'Space' && app.mode !== 'pixel' && !isTyping(e) && !app.keys.space) { app.keys.space = true; app.input.updateCursor(); e.preventDefault(); } });
addEventListener('keyup', e => { if (e.code === 'Space') { app.keys.space = false; app.input.updateCursor(); } });

// Drop files: projects/images open; images dropped on an open canvas become layers.
const stage = $('#stage');
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault();
  for (const f of e.dataTransfer.files) /\.ora$/i.test(f.name) ? project.openFile(f) : f.type.startsWith('image/') && project.importLayer(f, f.name);
});

initEink(app, mascot);
const doc = await project.restore().catch(() => null) ?? new Doc(1920, 1080);
app.setDoc(doc);
// ?mode=… (links from the Pixel editor) wins over the remembered mode.
const asked = new URLSearchParams(location.search).get('mode');
if (asked) history.replaceState(null, '', location.pathname);
setTheme(app.settings.theme);
setMode(asked ?? local.get('pp.mode', 'paint'));
globalThis.pixelpaint = app;
hideSplash(loadPixel());
await welcome;
