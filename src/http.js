/**
 * HTTP helpers: a typed error, JSON responses and CORS handling.
 */

export class HttpError extends Error {
  /**
   * @param {number} status   HTTP status returned to the client
   * @param {string} code     Stable machine readable code (the UI branches on it)
   * @param {string} message  Human readable message (Hebrew, shown to the user)
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function errorJson(err) {
  if (err instanceof HttpError) {
    const body = { error: err.message, code: err.code };
    if (err.details !== undefined) body.details = err.details;
    return json(body, err.status);
  }
  console.error('Unhandled error:', err);
  return json({ error: 'אירעה שגיאה פנימית בשרת. נסה שוב בעוד רגע.', code: 'internal_error' }, 500);
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new HttpError(400, 'invalid_json', 'גוף הבקשה אינו JSON תקין.');
  }
}

export function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/** Origin is allowed when it appears in ALLOWED_ORIGINS (or the list contains "*"). */
export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

export function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.get('Origin');
  if (!isOriginAllowed(origin, allowedOrigins)) return {};
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes('*') ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function withHeaders(response, headers) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}
