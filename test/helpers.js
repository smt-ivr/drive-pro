/**
 * Test helpers: a programmable fake for `fetch` and a minimal Worker context.
 */

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Replaces globalThis.fetch. `routes` is a list of [predicate(url, init), responder(url, init)].
 * Every outgoing call is recorded in `calls`.
 */
export function mockFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, init });
    for (const [match, respond] of routes) {
      if (match(url, init)) return respond(url, init);
    }
    throw new Error(`Unexpected fetch: ${init.method || 'GET'} ${url}`);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

export function createCtx() {
  const pending = [];
  return { waitUntil: (p) => pending.push(p), passThroughOnException() {}, flush: () => Promise.all(pending) };
}

export const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://smti.uk/drive-pro/api/auth-callback',
  ALLOWED_ORIGINS: 'https://smti.uk',
};

export const isUserInfo = (url) => url.hostname === 'www.googleapis.com' && url.pathname === '/oauth2/v2/userinfo';
export const userInfoOk = () => jsonResponse({ email: 'user@example.com', name: 'Test User', picture: '' });
