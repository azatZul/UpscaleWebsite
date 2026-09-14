// The upscaler page's view of sign-in and the worker API.
//
// Sign-in reuses the account page's identity module, loaded only when a cloud
// mode needs it, so on-device use never downloads the auth SDK. Firebase's own
// popup cannot run here: this page is cross-origin isolated (threaded wasm
// needs it), which severs the popup. So sign-in happens in a small window on
// /account/, and this page follows the signed-in state Firebase shares across
// tabs of the same origin.

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

export function connectAccount() {
  return {
    watch(listener) {
      loadIdentity().then(module => module.onIdentityChanged(listener)).catch(() => listener(null));
    },
    /** Returns false when the browser blocked the window. */
    openSignIn() {
      return Boolean(window.open('/account/?popup=1', 'uscale-sign-in', 'popup,width=480,height=720'));
    },
    me: () => call('/api/me'),
    catalogue: () => call('/api/billing/packs'),
    process: (mode, form) => call(`/api/cloud/${mode}`, {method: 'POST', body: form}),
    checkout: amountCents => call('/api/billing/checkout', {method: 'POST', json: {amountCents}}),
  };
}
