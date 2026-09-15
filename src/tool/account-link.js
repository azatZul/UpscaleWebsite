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
  const state = {known: false, identity: null, balance: null, prices: null, packs: null, device: null};
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(state); };
  let started = false;
  let loading = null;

  function refresh() {
    if (!state.identity) return Promise.resolve();
    loading ||= (async () => {
      try {
        const [me, catalogue, device] = await Promise.all([call('/api/me'), call('/api/billing/packs'), call('/api/device-upscales')]);
        state.balance = me.credits;
        state.prices = catalogue.prices || null;
        state.packs = catalogue.packs || null;
        state.device = device;
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
        if (!identity) { state.balance = null; state.device = null; }
        emit();
        if (identity) refresh();
      })).catch(() => { state.known = true; emit(); });
    },
    refresh,
    /** Merge balance and allowance figures any worker response carries. */
    apply(update) {
      if (!update) return;
      if (typeof update.balance === 'number') state.balance = update.balance;
      if (typeof update.freeRemaining === 'number') {
        state.device = {...(state.device || {}), freeRemaining: update.freeRemaining,
          ...(typeof update.freeLimit === 'number' ? {freeLimit: update.freeLimit} : {}),
          ...(typeof update.freeUsed === 'number' ? {freeUsed: update.freeUsed} : {}),
          ...(typeof update.credits === 'number' ? {credits: update.credits} : {})};
      }
      emit();
    },
    signInUrl: (path = location.pathname + location.search) => `/account/?next=${encodeURIComponent(path)}`,
    process: (mode, form) => call(`/api/cloud/${mode}`, {method: 'POST', body: form}),
    checkout: amountCents => call('/api/billing/checkout', {method: 'POST', json: {amountCents}}),
    claimDevice: requestId => call('/api/device-upscales', {method: 'POST', json: {requestId}}),
  };
}
