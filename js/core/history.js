import { bus } from './bus.js';
import { isTouchDevice } from './util.js';

// Command-pattern undo stack. Commands expose undo/redo/bytes/dispose; the stack is
// trimmed by step count and by pixel-memory budget (smaller on mobile GPUs).
export class History {
  constructor(maxBytes = (isTouchDevice ? 160 : 1024) * 2 ** 20, maxSteps = 200) {
    Object.assign(this, { maxBytes, maxSteps, done: [], undone: [] });
  }

  push(cmd) {
    if (!cmd) return;
    this.undone.forEach(c => c.dispose?.());
    this.undone = [];
    this.done.push(cmd);
    while (this.done.length > 1 && (this.done.length > this.maxSteps || this.bytes > this.maxBytes)) this.done.shift().dispose?.();
    this.changed();
  }

  undo() { return this.move(this.done, this.undone, 'undo'); }
  redo() { return this.move(this.undone, this.done, 'redo'); }

  move(from, to, op) {
    const c = from.pop();
    if (!c) return false;
    c[op](); to.push(c); this.changed();
    return true;
  }

  jump(n) {
    while (this.done.length > n && this.undo());
    while (this.done.length < n && this.redo());
  }

  get bytes() { return [...this.done, ...this.undone].reduce((s, c) => s + (c.bytes || 0), 0); }
  changed() { bus.emit('history', this); }
}
