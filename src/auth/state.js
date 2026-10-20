/**
 * Signed, short-lived OAuth `state` parameter.
 * It carries the origin that opened the login flow so the callback can deliver
 * tokens to that exact origin only (never to "*").
 */

const MAX_AGE_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** @param {{origin: string, returnTo?: string}} payload */
export async function signState(payload, secret, now = Date.now()) {
  const body = toBase64Url(encoder.encode(JSON.stringify({ ...payload, iat: now, n: crypto.randomUUID() })));
  const sig = toBase64Url(await hmac(secret, body));
  return `${body}.${sig}`;
}

/** Returns the payload, or null when the state is missing, forged or expired. */
export async function verifyState(state, secret, now = Date.now()) {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const [body, sig] = state.split('.');
  const expected = toBase64Url(await hmac(secret, body));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (typeof payload.iat !== 'number' || now - payload.iat > MAX_AGE_MS || payload.iat > now + 60_000) return null;
    return payload;
  } catch {
    return null;
  }
}
