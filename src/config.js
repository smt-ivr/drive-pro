import { HttpError } from './http.js';

export const VERSION = '2.0.0';

/** Reads and validates the Worker environment once per request. */
export function getConfig(env) {
  const allowedOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    // Signs the OAuth `state` parameter. A dedicated secret is preferred, the client secret is a safe fallback.
    stateSecret: env.STATE_SECRET || env.GOOGLE_CLIENT_SECRET,
    allowedOrigins,
    rootFolderName: env.ROOT_FOLDER_NAME || 'Drive Pro',
    db: env.DB || null,
  };
}

export function assertOAuthConfigured(config) {
  const missing = [];
  if (!config.clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!config.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!config.redirectUri) missing.push('GOOGLE_REDIRECT_URI');
  if (missing.length) {
    throw new HttpError(500, 'misconfigured', `השרת אינו מוגדר כראוי (חסר: ${missing.join(', ')}).`);
  }
}
