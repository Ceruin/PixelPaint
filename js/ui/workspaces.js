// Workspaces (Krita's, Photoshop's, Clip Studio's): one panel arrangement per kind of work, switched
// from View > Workspace. Each remembers how you left it; Reset Layout puts its preset back. They change
// only the panels and a few view settings, never the drawing.
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';

export const WORKSPACES = [['painting', 'Painting', 'brush'], ['pixel', 'Pixel Art', 'pixel'], ['animation', 'Animation', 'film']];

// Each preset is a patch over the panels' defaults (main.js).
const PRESETS = {
  painting: {},
  // the palette up top, the navigator as a live 1:1 preview; no brush library (the Pixel Pencil has no presets)
  pixel: { panels: {
    palette: { dock: 'right', order: 0, hidden: false, collapsed: false },
    color: { dock: 'right', order: 1, collapsed: true },
    layers: { dock: 'right', order: 2 },
    navigator: { dock: 'right', order: 3, hidden: false },
    brushes: { hidden: true },
  } },
  // layers and a preview first; the brushes fold away until wanted
  animation: { panels: {
    layers: { dock: 'right', order: 0 },
    navigator: { dock: 'right', order: 1, hidden: false },
    color: { dock: 'right', order: 2, collapsed: true },
    brushes: { dock: 'right', order: 3, collapsed: true },
  } },
};

export function initWorkspaces(app, panels, { timeline } = {}) {
  let current = local.get('pp.workspace', 'painting');
  const saved = () => local.get('pp.workspaceLayouts', {});
  const preset = id => PRESETS[id] ?? {};
  const ws = {
    get current() { return current; },
    use(id) {
      if (id === current || !PRESETS[id]) return;
      local.set('pp.workspaceLayouts', { ...saved(), [current]: panels.layout() });   // leave this one as it was
      current = id; local.set('pp.workspace', id);
      if (id === 'pixel') local.set('pp.wsOffers', 0);   // taken: it may offer again later
      panels.apply(saved()[id] ?? preset(id));
      if (id === 'animation') timeline?.expand();
      bus.emit('workspace', id);
    },
    reset() { panels.apply(preset(current)); },
  };
  // A pixel canvas offers the Pixel Art workspace, once per drawing, and stops offering once it has
  // been passed over twice (never switched without asking).
  const offered = new WeakSet();
  bus.on('doc', d => {
    const shown = local.get('pp.wsOffers', 0);
    if (!d?.pixelArt || current === 'pixel' || offered.has(d) || shown >= 2) return;
    offered.add(d); local.set('pp.wsOffers', shown + 1);
    app.toast('This is a pixel art canvas', { label: 'Use the Pixel Art workspace', run: () => ws.use('pixel') });
  });
  return ws;
}
