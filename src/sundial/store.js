// IndexedDB cache for the player's own archive files. Key: lower-case file name. Value: ArrayBuffer.
const DB = 'sundial', STORE = 'files';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export const cache = {
  get: key => tx('readonly', s => s.get(key.toLowerCase())),
  put: (key, buf) => tx('readwrite', s => s.put(buf, key.toLowerCase())),
  keys: () => tx('readonly', s => s.getAllKeys()),
  clear: () => tx('readwrite', s => s.clear()),
};
