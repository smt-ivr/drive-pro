import { HttpError } from '../http.js';

const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

const URL_PATTERNS = [
  /\/(?:file|document|spreadsheets|presentation|forms|drawings)\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]{10,})/,
  /\/folders\/([A-Za-z0-9_-]{10,})/,
  /\/d\/([A-Za-z0-9_-]{10,})/,
  /[?&#]id=([A-Za-z0-9_-]{10,})/,
];

export function isDriveId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

/** Extracts a Drive file/folder id from any common Google link, or accepts a bare id. */
export function extractDriveId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;
  if (isDriveId(value)) return value;
  for (const pattern of URL_PATTERNS) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function requireDriveId(input, label = 'הקישור') {
  const id = extractDriveId(input);
  if (!id) throw new HttpError(400, 'invalid_link', `${label} שהוזן אינו קישור Google Drive תקין.`);
  return id;
}

/**
 * Older shared links carry a `resourcekey` that Drive requires (via a header) to grant access.
 * Returns the "id/key" pair for the X-Goog-Drive-Resource-Keys header, or undefined.
 */
export function extractResourceKey(input, id) {
  if (typeof input !== 'string' || !id) return undefined;
  const match = input.match(/[?&]resourcekey=([A-Za-z0-9_-]+)/i);
  return match ? `${id}/${match[1]}` : undefined;
}

/** Escapes a literal for use inside a Drive `q` query string. */
export function escapeQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
