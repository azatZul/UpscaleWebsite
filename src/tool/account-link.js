// The upscaler page's session: who is signed in, their credits and on-device
// allowance, and the worker calls that need them.
//
// Sign-in itself happens on /account/ -- every provider lives there -- and
// comes back with ?next=. This page only reads the shared Firebase state, via
// the account page's identity module, which nothing else here imports.

export class ApiError extends Error {
  constructor(code, status, body) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let identityModule;
const loadIdentity = () => (identityModule ||= import(/* @vite-ignore */ '/account/identity.js'));

async function call(path, {method = 'GET', body, json} = {}) {
  const {getAccessToken} = await loadIdentity();
  const token = await getAccessToken();
  if (!token) throw new ApiError('unauthorized', 401, null);
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {Authorization: `Bearer ${token}`, ...(json ? {'Content-Type': 'application/json'} : {})},
      body: json ? JSON.stringify(json) : body,
    });
  } catch {
    throw new ApiError('network', 0, null);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(payload?.error || 'error', response.status, payload);
  return payload;
}

export function createSession() {
  // known: the provider has answered at least once, so identity is meaningful.
  // stalled: the check timed out, so `identity` being null means "unknown",
  // not "signed out".
  const state = {known: false, identity: null, balance: null, prices: null, packs: null, stalled: false};
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(state); };
  let started = false;
  let loading = null;

  function refresh() {
    if (!state.identity) return Promise.resolve();
    loading ||= (async () => {
      try {
        const [me, catalogue] = await Promise.all([call('/api/me'), call('/api/billing/packs')]);
        state.balance = me.credits;
        state.prices = catalogue.prices || null;
        state.packs = catalogue.packs || null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) state.identity = null;
      } finally {
        loading = null;
      }
      emit();
    })();
    return loading;
  }

  return {
    state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() {
      if (started) return;
      started = true;
      loadIdentity().then(module => module.onIdentityChanged(identity => {
        state.identity = identity;
        state.known = true;
        state.stalled = module.identityStalled?.() ?? false;
        if (!identity) state.balance = null;
        emit();
        if (identity) refresh();
      })).catch(() => { state.known = true; state.stalled = true; emit(); });
    },
    refresh,
    /** Merge balance and allowance figures any worker response carries. */
    apply(update) {
      if (!update) return;
      if (typeof update.balance === 'number') state.balance = update.balance;
      emit();
    },
    signInUrl: (path = location.pathname + location.search) => `/account/?next=${encodeURIComponent(path)}`,
    process: (mode, form) => call(`/api/cloud/${mode}`, {method: 'POST', body: form}),
    /** One tile of a tiled upscale, fetched through the worker so the browser
     *  can read its pixels: a cross-origin image cannot be drawn to a canvas
     *  on this page and then read back. */
    async tile(tile, jobId) {
      const {getAccessToken} = await loadIdentity();
      const token = await getAccessToken();
      if (!token) throw new ApiError('unauthorized', 401, null);
      let response;
      try {
        response = await fetch('/api/cloud/tile', {
          method: 'POST',
          headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({jobId, index: tile.index, url: tile.url, sig: tile.sig}),
        });
      } catch {
        throw new ApiError('network', 0, null);
      }
      if (!response.ok) throw new ApiError('tile_unavailable', response.status, null);
      return await response.blob();
    },
    /** Keep the stitched photo, which only the browser has. */
    saveResult(jobId, result, original) {
      const form = new FormData();
      form.append('jobId', jobId);
      form.append('result', new File([result], 'result.jpg', {type: 'image/jpeg'}));
      if (original) form.append('original', new File([original], 'original.jpg', {type: 'image/jpeg'}));
      return call('/api/cloud/result', {method: 'POST', body: form});
    },
    checkout: amountCents => call('/api/billing/checkout', {method: 'POST', json: {amountCents}}),
  };
}
