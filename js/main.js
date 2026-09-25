import { $, h, segmented } from './ui/dom.js';
import { bus } from './core/bus.js';
import { local } from './core/storage.js';
import { bindKeys, isTyping } from './core/actions.js';
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
import { menubar } from './ui/menubar.js';
import { optionsBar } from './ui/optionsbar.js';
import { statusbar } from './ui/statusbar.js';
import { initTooltips } from './ui/tooltip.js';
import { toast } from './ui/dialogs.js';
import { Mascot } from './ui/mascot.js';
import { initZen } from './ui/zen.js';
import { initNotes } from './ui/notes.js';

loadCustomTips();
const app = new App($('#view'));
const project = createProject(app);
const panels = new Panels($('#workspace'));
const mascot = new Mascot();
const zen = initZen(app, panels);
const notes = initNotes(app, c => { setMode('studio'); project.importLayer(c, 'Sketch note'); });

const openPanel = id => (app.mode === 'zen' ? zen.pop(id) : panels.patch(id, { hidden: false, collapsed: false }));

panels.add('tools', 'Tools', toolbar(app, () => openPanel('color')), { dock: 'left', order: 0 });
panels.add('color', 'Color', colorPicker(app), { dock: 'right', order: 0 });
panels.add('brushes', 'Brushes', brushLibrary(app), { dock: 'right', order: 1 }, { grow: true });
panels.add('brushSettings', 'Brush Settings', brushSettings(app), { dock: null, hidden: true, x: 70, y: 16, w: 290, h: 520 });
panels.add('layers', 'Layers', layersPanel(app), { dock: 'right', order: 2 }, { grow: true });
panels.add('history', 'History', historyPanel(app), { dock: null, hidden: true, x: 380, y: 16, w: 230, h: 320 });

function setMode(mode) {
  app.tool.interrupt?.();
  app.mode = mode;
  document.body.dataset.mode = mode;
  local.set('pp.mode', mode);
  app.profile = mode === 'paper' ? { smoothing: 0.3, grain: 0.35 } : {};
  notes.show(mode === 'notes');
  mascot.mount(mode === 'zen' ? zen.slot : mode === 'notes' ? notes.slot : $('#mascotSlot'));
  bus.emit('mode', mode);
  requestAnimationFrame(() => app.view.resize());
}

const { menus, modes } = defineActions(app, { panels, project, setMode });
const modeSwitch = h('div.mode-switch');
const renderModes = () => modeSwitch.replaceChildren(segmented(modes.map(([id, label]) => [id, label.split(' ')[0]]), app.mode, setMode));
bus.on('mode', renderModes);
menubar($('#menubar'), menus, modeSwitch);
optionsBar(app, $('#optionsbar'), () => openPanel('brushes'));
statusbar(app, $('#statusbar'), $('#view'));
initTooltips();
bindKeys();
panels.apply(local.get('pp.layout'));
bus.on('toast', toast);

// Space = temporary hand tool.
addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e) && !app.keys.space) { app.keys.space = true; app.input.updateCursor(); e.preventDefault(); } });
addEventListener('keyup', e => { if (e.code === 'Space') { app.keys.space = false; app.input.updateCursor(); } });

// Drop files: projects/images open; images dropped on an open canvas become layers.
const stage = $('#stage');
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault();
  for (const f of e.dataTransfer.files) /\.ppaint$/i.test(f.name) ? project.openFile(f) : f.type.startsWith('image/') && project.importLayer(f, f.name);
});

const doc = await project.restore().catch(() => null) ?? new Doc(1920, 1080);
app.setDoc(doc);
setMode(local.get('pp.mode', isTouchDevice ? 'zen' : 'studio'));
globalThis.pixelpaint = app;
