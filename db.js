/* ============================================================
   db.js — Wrapper de IndexedDB
   - Cachea imágenes recientes para abrir rápido
   - Cachea modelo(s) si en el futuro se añaden (ej: quitar fondo IA)
   - Guarda preferencias secundarias no críticas
   ============================================================ */

const DB_NAME = 'jpb-editor';
const DB_VERSION = 1;

const STORES = {
  // Imágenes y blobs temporales / recientes
  blobs: { keyPath: 'id', indexes: ['kind', 'createdAt'] },
  // Modelos de IA (cache para uso offline)
  models: { keyPath: 'id' },
  // Metadatos y preferencias
  meta: { keyPath: 'key' }
};

let _dbPromise = null;

/**
 * Abre (o crea) la base de datos. Devuelve una Promise<IDBDatabase>.
 */
export function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no soportado'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;

      // Store: blobs
      if (!db.objectStoreNames.contains('blobs')) {
        const s = db.createObjectStore('blobs', { keyPath: 'id' });
        s.createIndex('kind', 'kind', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Store: models
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models', { keyPath: 'id' });
      }

      // Store: meta
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return _dbPromise;
}

/** Ejecuta una transacción sobre un store. */
async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/* ─── API pública ──────────────────────────────────────────── */

/** Guarda un blob (imagen, modelo, etc.). */
export async function putBlob(id, blob, kind = 'image', extra = {}) {
  const record = {
    id,
    kind,
    createdAt: Date.now(),
    blob,
    ...extra
  };
  await tx('blobs', 'readwrite', (s) => s.put(record));
  return id;
}

/** Recupera un blob por id. */
export async function getBlob(id) {
  return tx('blobs', 'readonly', (s) => s.get(id));
}

/** Elimina un blob por id. */
export async function deleteBlob(id) {
  return tx('blobs', 'readwrite', (s) => s.delete(id));
}

/** Lista blobs por kind (p.ej. 'recent'). */
export async function listBlobs(kind = null, limit = 50) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('blobs', 'readonly');
    const store = transaction.objectStore('blobs');
    const results = [];
    const source = kind ? store.index('kind') : store;

    const req = kind ? source.openCursor(IDBKeyRange.only(kind)) : source.openCursor();
    req.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (!cursor || results.length >= limit) {
        resolve(results.sort((a, b) => b.createdAt - a.createdAt));
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Guarda o recupera metadatos simples (preferencias). */
export async function setMeta(key, value) {
  return tx('meta', 'readwrite', (s) => s.put({ key, value }));
}
export async function getMeta(key) {
  const rec = await tx('meta', 'readonly', (s) => s.get(key));
  return rec ? rec.value : undefined;
}

/** Guarda un modelo IA (ArrayBuffer o Blob). */
export async function putModel(id, blob, meta = {}) {
  await tx('models', 'readwrite', (s) => s.put({ id, blob, ...meta, savedAt: Date.now() }));
  return id;
}
export async function getModel(id) {
  return tx('models', 'readonly', (s) => s.get(id));
}

/** Limpia todo el almacenamiento (útil en pruebas o reset). */
export async function clearAll() {
  const db = await openDB();
  const names = Array.from(db.objectStoreNames);
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    names.forEach((n) => t.objectStore(n).clear());
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Estima cuota y uso (para mostrar en la UI). */
export async function estimateQuota() {
  if (navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate();
  }
  return { usage: 0, quota: 0 };
}