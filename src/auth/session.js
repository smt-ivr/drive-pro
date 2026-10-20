/**
 * Resolves the caller from the bearer token.
 * Identity lookups are cached per isolate (keyed by a hash of the token), which
 * removes an extra Google round-trip from almost every API call.
 */
import { HttpError } from '../http.js';
import { isUserBlocked, logAction } from '../db.js';
import { fetchUserInfo } from './google.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function authenticate(request, config, ctx) {
  const token = getBearerToken(request);
  if (!token) throw new HttpError(401, 'missing_token', 'יש להתחבר לחשבון גוגל.');

  const key = await sha256(token);
  const now = Date.now();
  let entry = cache.get(key);

  if (!entry || entry.expires < now) {
    const user = await fetchUserInfo(token);
    const blocked = await isUserBlocked(config.db, user.email);
    entry = { user, blocked, expires: now + CACHE_TTL_MS };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
  }

  if (entry.blocked) {
    ctx.waitUntil(logAction(config.db, entry.user.email, 'BLOCKED_ACCESS', new URL(request.url).pathname));
    throw new HttpError(403, 'user_blocked', 'המשתמש שלך נחסם מגישה למערכת.');
  }

  return { token, user: entry.user };
}

/** Test hook. */
export function clearSessionCache() {
  cache.clear();
}
