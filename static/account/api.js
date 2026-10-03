// The worker API, as the page sees it. Every call carries a fresh Firebase ID
// token; nothing here knows how that token is obtained.
import {getAccessToken} from './identity.js';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const MESSAGES = {
  401: 'Your session expired. Sign in again to continue.',
  503: 'Payments are not switched on yet. Check back shortly.',
};
// Only the test site answers this way: see worker/src/test-mode.ts.
const TEST_MODE_MESSAGE = "This is UScale's test site, where credits are free, so buying and using them is limited to the team. If you're a developer, ask for your email to be added to TEST_ALLOWED_EMAILS.";

async function call(path, {method = 'GET', body} = {}) {
  const token = await getAccessToken();
  if (!token) throw new ApiError(MESSAGES[401], 401, null);

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {'Content-Type': 'application/json'} : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach UScale. Check your connection and try again.', 0, null);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error === 'test_mode_restricted' ? TEST_MODE_MESSAGE
      : MESSAGES[response.status] || 'Something went wrong on our side. Please try again.';
    throw new ApiError(message, response.status, payload);
  }
  return payload;
}

export const fetchAccount = () => call('/api/me');
export const fetchPacks = () => call('/api/billing/packs');
export const fetchActivity = () => call('/api/account/activity');
export const startCheckout = amountCents => call('/api/billing/checkout', {method: 'POST', body: {amountCents}});
export const fetchHistory = () => call('/api/history');
export const deleteHistoryItem = id => call(`/api/history/${encodeURIComponent(id)}`, {method: 'DELETE'});
