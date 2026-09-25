// IndexedDB key/value store for heavy data (projects, notes); localStorage for small prefs.
let dbp;
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open('pixelpaint-studio', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function tx(mode, fn) {
  const db = await (dbp ??= open());
  return new Promise((res, rej) => {
    const t = db.transaction('kv', mode), req = fn(t.objectStore('kv'));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
}

export const idb = {
  get: k => tx('readonly', s => s.get(k)),
  set: (k, v) => tx('readwrite', s => s.put(v, k)),
  del: k => tx('readwrite', s => s.delete(k)),
};

export const local = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / private mode */ } },
};
