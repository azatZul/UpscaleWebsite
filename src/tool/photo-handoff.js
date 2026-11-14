// Carries the chosen photo (and, for sign-in, the tool's settings) from one
// tool page to the next. Each mode is its own page, so switching modes or
// leaving to sign in is a real navigation; the photo would otherwise be lost.
//
// The file goes to IndexedDB; the record's id goes to sessionStorage, which is
// per tab, so a second tab never picks up someone else's photo. Navigation
// waits for the write transaction to complete. A record is taken once, and
// records nobody took expire. Any storage failure sets a flag instead, so the
// next page can say the photo has to be chosen again.

export const HANDOFF_ID_KEY = 'uscale-handoff-id';
export const HANDOFF_FAILED_KEY = 'uscale-handoff-failed';
export const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

const DB_NAME = 'uscale-handoff';
const STORE = 'photos';

const done = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
// Resolves only when the whole transaction has committed.
const committed = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('aborted'));
});

/** The IndexedDB side: put, take (get + delete in one transaction) and sweep. */
export function indexedDbStore(indexedDB = globalThis.indexedDB) {
  let opened;
  const open = () => {
    if (!indexedDB) return Promise.reject(new Error('no indexedDB'));
    opened ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: 'id'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
    return opened;
  };
  return {
    async put(record) {
      const tx = (await open()).transaction(STORE, 'readwrite');
      const finished = committed(tx);
      tx.objectStore(STORE).put(record);
      await finished;
    },
    async take(id) {
      const tx = (await open()).transaction(STORE, 'readwrite');
      const finished = committed(tx);
      const store = tx.objectStore(STORE);
      const record = await done(store.get(id));
      store.delete(id);
      await finished;
      return record || null;
    },
    async sweep(olderThan) {
      const tx = (await open()).transaction(STORE, 'readwrite');
      const finished = committed(tx);
      const records = await done(tx.objectStore(STORE).getAll());
      for (const record of records) if (!(record.createdAt > olderThan)) tx.objectStore(STORE).delete(record.id);
      await finished;
    },
  };
}

const randomId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createHandoff({store = indexedDbStore(), session = safeSession(), now = Date.now, id = randomId} = {}) {
  const get = key => { try { return session?.getItem(key) ?? null; } catch { return null; } };
  const set = (key, value) => { try { session?.setItem(key, value); return true; } catch { return false; } };
  const remove = key => { try { session?.removeItem(key); } catch { /* Storage is optional. */ } };

  return {
    /** Store the photo before leaving the page. Resolves true once it is safely
     *  written; false (with the failure flag set) when it could not be. */
    async save({file, settings} = {}) {
      remove(HANDOFF_ID_KEY);
      if (!file) return false;
      const record = {id: id(), blob: file, name: file.name || 'photo', type: file.type || '',
        lastModified: file.lastModified || now(), settings: settings ?? null, createdAt: now()};
      try {
        await store.put(record);
        if (!set(HANDOFF_ID_KEY, record.id)) throw new Error('no sessionStorage');
        remove(HANDOFF_FAILED_KEY);
        return true;
      } catch {
        set(HANDOFF_FAILED_KEY, '1');
        return false;
      }
    },
    /** On arrival: the photo left for this tab, once. {file, settings} when
     *  there is one, {failed: true} when one was meant to arrive but did not,
     *  null when nothing was handed over. Old, untaken records are cleared. */
    async take() {
      const handoffId = get(HANDOFF_ID_KEY);
      const failed = get(HANDOFF_FAILED_KEY) === '1';
      remove(HANDOFF_ID_KEY); remove(HANDOFF_FAILED_KEY);
      let result = failed ? {failed: true} : null;
      if (handoffId) {
        try {
          const record = await store.take(handoffId);
          if (record && now() - record.createdAt <= HANDOFF_MAX_AGE_MS) {
            const file = typeof File === 'function'
              ? new File([record.blob], record.name, {type: record.type, lastModified: record.lastModified})
              : record.blob;
            result = {file, settings: record.settings};
          } else {
            result = {failed: true};
          }
        } catch {
          result = {failed: true};
        }
      }
      try { await store.sweep(now() - HANDOFF_MAX_AGE_MS); } catch { /* Nothing to clean, or no storage. */ }
      return result;
    },
  };
}

function safeSession() {
  try { return globalThis.sessionStorage; } catch { return null; }
}
