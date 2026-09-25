const free = v => [v, v?.mask].forEach(c => { if (c?.owned) c.width = c.height = 0; });

// Generic reversible state swap: apply(before) / apply(after). Covers pixels, tree, props, selection, resize.
export class StateCommand {
  constructor(label, apply, before, after, bytes = 0) { Object.assign(this, { label, apply, before, after, bytes }); }
  undo() { this.apply(this.before); }
  redo() { this.apply(this.after); }
  dispose() { free(this.before); free(this.after); }
}

export class Compound {
  constructor(label, cmds) {
    this.label = label;
    this.cmds = cmds.filter(Boolean);
    this.bytes = this.cmds.reduce((s, c) => s + c.bytes, 0);
  }
  undo() { for (let i = this.cmds.length; i--;) this.cmds[i].undo(); }
  redo() { this.cmds.forEach(c => c.redo()); }
  dispose() { this.cmds.forEach(c => c.dispose?.()); }
}
