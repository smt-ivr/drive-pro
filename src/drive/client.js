/**
 * Thin Drive v3 REST client: retries transient failures and converts Google
 * errors into HttpErrors with clear Hebrew messages and stable codes.
 */
import { HttpError } from '../http.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const RETRYABLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function quotaUser() {
  return `u_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function toDriveError(status, payload) {
  const googleMessage = payload?.error?.message || '';
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || '';
  const details = { status, reason, message: googleMessage };

  if (status === 401) return new HttpError(401, 'invalid_token', 'פג תוקף ההתחברות לגוגל.', details);
  if (status === 404) return new HttpError(404, 'not_found', 'הקובץ או התיקייה לא נמצאו – ייתכן שנמחקו, שהקישור שגוי או שאין לך גישה אליהם.', details);
  if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return new HttpError(429, 'rate_limited', 'גוגל מגבילה כרגע את קצב הבקשות. נסה שוב בעוד מספר שניות.', details);
  }
  if (reason === 'storageQuotaExceeded' || reason === 'quotaExceeded') {
    return new HttpError(507, 'storage_full', 'אין מספיק מקום פנוי בחשבון הגוגל שלך.', details);
  }
  if (reason === 'cannotCopyFile' || reason === 'fileNotDownloadable') {
    return new HttpError(403, 'copy_restricted', 'בעל הקובץ חסם את האפשרות להעתיק או להוריד אותו.', details);
  }
  if (status === 403) {
    return new HttpError(403, 'forbidden', 'אין לך הרשאה לגשת לפריט הזה. ודא שהקישור משותף איתך.', details);
  }
  if (status === 400) return new HttpError(400, 'bad_request', googleMessage || 'בקשה לא תקינה לגוגל דרייב.', details);
  return new HttpError(502, 'upstream_error', 'שירות Google Drive לא הגיב כצפוי. נסה שוב.', details);
}

function isRetryable(status, payload) {
  const reason = payload?.error?.errors?.[0]?.reason;
  return status >= 500 || status === 429 || (status === 403 && RETRYABLE_REASONS.has(reason));
}

/**
 * @param {string} token
 * @param {string} path  e.g. "/files/abc"
 * @param {{method?: string, query?: Record<string, unknown>, body?: unknown, retries?: number, resourceKey?: string}} [opts]
 */
export async function driveRequest(token, path, { method = 'GET', query = {}, body, retries = 2, resourceKey } = {}) {
  const url = new URL(DRIVE_API + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('quotaUser', quotaUser());

  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (resourceKey) headers['X-Goog-Drive-Resource-Keys'] = resourceKey;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await res.json().catch(() => null);
    if (res.ok) return payload ?? {};
    if (attempt < retries && isRetryable(res.status, payload)) {
      await sleep(250 * 2 ** attempt + Math.random() * 150);
      continue;
    }
    throw toDriveError(res.status, payload);
  }
}
