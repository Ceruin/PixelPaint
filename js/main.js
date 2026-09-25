import { $ } from './ui/dom.js';
import { bus } from './core/bus.js';
import { local } from './core/storage.js';
import { actions, bindKeys, isTyping } from './core/actions.js';
import { isTouchDevice } from './core/util.js';
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
import { MODES, modeSwitch } from './ui/modes.js';
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

// Opens a panel where it lives; in Zen, or when its dock is folded, as a flyout by the clicked control.
const openPanel = (id, e) => {
  const s = panels.map.get(id).s;
  if (e?.currentTarget && (app.mode === 'zen' || (s.dock && panels.folded[s.dock]))) return panels.flyout(id, e.currentTarget);
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
const dockable = () => !['zen', 'notes'].includes(app.mode);
mascot.openCare = () => (dockable() && panels.isOpen('pyxl') ? openPanel('pyxl') : openCareCard(mascot, dockable() && (() => openPanel('pyxl'))));
panels.add('history', 'History', 'history', historyPanel(app), { dock: null, hidden: true, x: 440, y: 16, w: 230, h: 320 });
initPopupPalette(app);
document.body.classList.toggle('light', app.settings.theme === 'light');

// Pixel mode: the pixel-art editor lives in #pixel (styles: css/pixel.css). Its script loads the
// first time the mode opens, so it sizes itself for a visible stage; its top bar replaces ours.
const pixelBox = $('#pixel'), pixelSlot = $('#pixelSlot'), pixelSpot = $('#pyxlSpot');
let pixelLoaded = false;
const showPixel = on => {
  pixelBox.hidden = !on;
  pixelSlot.hidden = true;
  if (!on) return;
  if (!pixelLoaded) {
    pixelLoaded = true;
    document.body.append(Object.assign(document.createElement('script'), { src: 'js/pixel/editor.js' }));
  } else dispatchEvent(new Event('resize'));
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

function setMode(mode) {
  if (!MODES.some(m => m[0] === mode)) mode = 'paint';
  app.tool.interrupt?.();
  app.mode = mode;
  document.body.dataset.mode = mode;
  local.set('pp.mode', mode);
  app.profile = mode === 'paper' ? { smoothing: 0.3, grain: 0.35 } : {};
  notes.show(mode === 'notes');
  showPixel(mode === 'pixel');
  mascot.mount(mode === 'zen' ? zen.slot : mode === 'notes' ? notes.slot : mode === 'pixel' ? pixelSlot : $('#mascotSlot'));
  modeBox.replaceChildren(modeSwitch(mode, setMode));
  bus.emit('mode', mode);
  requestAnimationFrame(() => app.view.resize());
}

const timeline = initTimeline(app, $('#timeline'));
const { menus } = defineActions(app, { panels, project, setMode, timeline });
const modeBox = document.createElement('div');
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
bindKeys(a => app.mode !== 'pixel' || /^mode\.(?!toggle)/.test(a.id));
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

const doc = await project.restore().catch(() => null) ?? new Doc(1920, 1080);
app.setDoc(doc);
// ?mode=… (links from the Pixel editor) wins over the remembered mode.
const asked = new URLSearchParams(location.search).get('mode');
if (asked) history.replaceState(null, '', location.pathname);
setMode(asked ?? local.get('pp.mode', isTouchDevice ? 'zen' : 'paint'));
globalThis.pixelpaint = app;
hideSplash();
await welcome;
