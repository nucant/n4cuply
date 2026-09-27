// Small on-device database (IndexedDB) for song metadata and cover images.
// If IndexedDB is unavailable, every function quietly does nothing.
const DB_NAME = 'my-player';
const DB_VERSION = 2;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
          if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
          if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch (e) {
      resolve(undefined);
    }
  }));
}

export const idbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const idbPut = (store, key, value) => tx(store, 'readwrite', (s) => s.put(value, key));
export const idbClear = (store) => tx(store, 'readwrite', (s) => s.clear());
export const idbDelete = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));

export function idbGetAll(store) {
  return open().then((db) => new Promise((resolve) => {
    const out = new Map();
    if (!db) return resolve(out);
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out.set(c.key, c.value); c.continue(); } else resolve(out);
      };
      req.onerror = () => resolve(out);
    } catch (e) {
      resolve(out);
    }
  }));
}
