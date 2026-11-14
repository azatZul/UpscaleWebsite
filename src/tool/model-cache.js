// Model files also live in Cache Storage. The HTTP cache alone is not enough:
// browsers cap a single entry (Firefox at about 50 MB, embedded browsers far
// lower), so the 15 MB Photo 4× graph and the 85 MB face model were
// downloaded again on every visit there. Cache Storage has no per-entry cap
// and keeps files until the browser evicts the whole origin.
//
// Model URLs carry a content hash, so a stored entry never goes stale. After a
// new file is stored, entries that the current release no longer uses are
// removed so an old model does not hold storage forever.
export const MODEL_CACHE = 'uscale-models-v1';

// CacheStorage.open() can return a new Cache wrapper, so coordinate by storage
// and absolute URL instead. A rejected model must be deleted after every write
// already queued for that URL, even when one of those writes fails.
const mutations = new WeakMap();

function mutate(storage, url, action) {
  let pending = mutations.get(storage);
  if (!pending) mutations.set(storage, pending = new Map());
  const key = absolute(url, globalThis.location?.href);
  const operation = (pending.get(key) ?? Promise.resolve()).then(action).catch(() => {});
  pending.set(key, operation);
  operation.then(() => {
    if (pending.get(key) === operation) pending.delete(key);
  });
  return operation;
}

async function openCache(storage) {
  // Private windows, blocked site data and insecure contexts reject or lack it.
  try { return storage ? await storage.open(MODEL_CACHE) : undefined; } catch { return undefined; }
}

function absolute(url, base) {
  try { return new URL(url, base).href; } catch { return url; }
}

export async function prune(cache, keep, base = globalThis.location?.href) {
  if (!keep) return;
  const current = new Set([...keep].map(url => absolute(url, base)));
  for (const request of await cache.keys()) {
    if (!current.has(request.url)) await cache.delete(request);
  }
}

// Returns a Response like fetch(). A stored copy is served without touching the
// network; otherwise the network response is returned at once and a copy is
// stored as it streams, so progress reporting is unchanged.
export async function fetchModel(url, {storage = globalThis.caches, fetcher = (...args) => globalThis.fetch(...args), keep} = {}) {
  const cache = await openCache(storage);
  if (cache) {
    try {
      const stored = await cache.match(url);
      if (stored) return stored;
    } catch { /* A broken entry is replaced by the network copy below. */ }
  }
  const response = await fetcher(url);
  if (cache && response.ok && response.body) {
    // put() rejects if the body stream fails or the quota is exhausted, so a
    // partial file is never stored and the download itself is unaffected.
    try {
      const copy = response.clone();
      void mutate(storage, url, async () => {
        await cache.put(url, copy);
        await prune(cache, keep);
      });
    } catch { /* Cloning is optional too; the download can still proceed. */ }
  }
  return response;
}

export async function forgetModel(url, storage = globalThis.caches) {
  const cache = await openCache(storage);
  if (cache) await mutate(storage, url, () => cache.delete(url));
}
