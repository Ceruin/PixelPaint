import { toolCursor } from '../ui/cursors.js';

// The Tile tool: click a tile to pick it (the tiles you draw in), Shift-click or drag across cells to
// pick a block (what Join merges). Picking is the whole job: drawing happens with the other tools.
export class TileTool {
  constructor(app) { Object.assign(this, { app, id: 'tile', cursor: toolCursor('marquee') }); }
  down(p, e) {
    const t = this.app.tiles?.cellAt(p);
    if (!this.app.doc.sheet) { this.app.toast('Make a tilesheet first: Image > Tilesheet'); return false; }
    if (!t) return false;
    this.app.tiles.select(t.r, t.c, e.shiftKey);
    return true;
  }
  move(pts) { const t = this.app.tiles.cellAt(pts.at(-1)); if (t) this.app.tiles.select(t.r, t.c, true); }
  up() {}
}
