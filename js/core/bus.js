// Minimal pub/sub hub: the engine emits, the UI listens — neither imports the other.
const map = new Map();

export const bus = {
  on(ev, fn) {
    if (!map.has(ev)) map.set(ev, new Set());
    map.get(ev).add(fn);
    return () => map.get(ev).delete(fn);
  },
  emit(ev, data) { map.get(ev)?.forEach(fn => fn(data)); },
};
