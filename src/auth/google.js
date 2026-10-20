/**
 * Google OAuth 2.0 endpoints.
 */
import { HttpError } from '../http.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export function buildAuthUrl({ clientId, redirectUri }, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant = the refresh token was revoked/expired: the user must sign in again.
    if (data.error === 'invalid_grant') {
      throw new HttpError(401, 'session_expired', 'החיבור לחשבון גוגל פג תוקף. יש להתחבר מחדש.');
    }
    throw new HttpError(502, 'oauth_error', data.error_description || 'שגיאה בתקשורת מול שרת ההזדהות של גוגל.', data.error);
  }
  return data;
}

/** Keeps only what the browser needs (drops id_token etc.). */
function publicTokens(data) {
  const out = { access_token: data.access_token, expires_in: data.expires_in, token_type: data.token_type, scope: data.scope };
  if (data.refresh_token) out.refresh_token = data.refresh_token;
  return out;
}

export async function exchangeCode(code, config) {
  const data = await tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  return publicTokens(data);
}

export async function refreshAccessToken(refreshToken, config) {
  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });
  return publicTokens(data);
}

export async function fetchUserInfo(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new HttpError(401, 'invalid_token', 'פג תוקף ההתחברות. מתחבר מחדש...');
  if (!res.ok) throw new HttpError(502, 'userinfo_error', data.error?.message || 'שגיאה בקבלת פרטי חשבון הגוגל.');
  return {
    email: data.email,
    name: data.name || '',
    givenName: data.given_name || '',
    picture: data.picture || '',
    // Legacy field names kept for older clients.
    given_name: data.given_name || '',
  };
}
