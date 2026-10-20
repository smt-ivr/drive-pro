/**
 * Drive Pro API – Cloudflare Worker entry point.
 *
 * Served under  https://<host>/drive-pro/api/*  (the "/drive-pro" prefix is optional,
 * so the worker also works on its workers.dev URL). See README.md for the API reference.
 */
import { VERSION, assertOAuthConfigured, getConfig } from './config.js';
import { HttpError, corsHeaders, errorJson, html, isOriginAllowed, json, readJson, withHeaders } from './http.js';
import { buildAuthUrl, exchangeCode, fetchUserInfo, refreshAccessToken } from './auth/google.js';
import { signState, verifyState } from './auth/state.js';
import { authenticate } from './auth/session.js';
import { copyFile, ensureFolder, getFileDetails, listFolder } from './drive/service.js';
import { logAction } from './db.js';
import { authResultPage } from './pages.js';

const MOUNT_PREFIX = /^\/drive-pro(?=\/|$)/;

function requireString(body, key, message) {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'missing_field', message);
  return value.trim();
}

// ---------------------------------------------------------------- public routes

function health() {
  return json({ ok: true, service: 'drive-pro', version: VERSION });
}

async function login({ url, config }) {
  assertOAuthConfigured(config);
  const origin = (url.searchParams.get('origin') || config.allowedOrigins.find((o) => o !== '*') || '').replace(/\/+$/, '');
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    throw new HttpError(400, 'origin_not_allowed', 'האתר שממנו בוצעה ההתחברות אינו מורשה.');
  }

  let returnTo = url.searchParams.get('return_to') || '';
  try {
    if (returnTo && new URL(returnTo).origin !== origin) returnTo = '';
  } catch {
    returnTo = '';
  }

  const state = await signState({ origin, returnTo }, config.stateSecret);
  return Response.redirect(buildAuthUrl(config, state), 302);
}

async function authCallback({ url, config, ctx }) {
  assertOAuthConfigured(config);
  const state = await verifyState(url.searchParams.get('state'), config.stateSecret);
  if (!state) {
    return html(authResultPage({ origin: null, message: { type: 'AUTH_ERROR', error: 'תהליך ההתחברות פג תוקף. נסה שוב.' } }), 400);
  }

  const respond = (message, status = 200) => html(authResultPage({ origin: state.origin, returnTo: state.returnTo, message }), status);

  if (url.searchParams.get('error')) {
    return respond({ type: 'AUTH_ERROR', error: 'ההתחברות בוטלה.' });
  }
  const code = url.searchParams.get('code');
  if (!code) return respond({ type: 'AUTH_ERROR', error: 'חסר קוד אימות מגוגל.' }, 400);

  try {
    const tokens = await exchangeCode(code, config);
    ctx.waitUntil(
      fetchUserInfo(tokens.access_token)
        .then((u) => logAction(config.db, u.email, 'LOGIN', state.origin))
        .catch(() => {}),
    );
    return respond({ type: 'AUTH_SUCCESS', tokens });
  } catch (e) {
    return respond({ type: 'AUTH_ERROR', error: e instanceof HttpError ? e.message : 'שגיאה בהשלמת ההתחברות.' }, 502);
  }
}

async function refresh({ request, config }) {
  assertOAuthConfigured(config);
  const body = await readJson(request);
  const token = requireString(body, 'refreshToken', 'חסר Refresh Token.');
  return json(await refreshAccessToken(token, config));
}

// ------------------------------------------------------------- protected routes

async function me({ session }) {
  return json(session.user);
}

async function fileInfo({ request, session, config, ctx }) {
  const body = await readJson(request);
  const link = requireString(body, 'linkOrId', 'חסר קישור לקובץ או לתיקייה.');
  const result = await getFileDetails(session.token, link, body.resourceKey);
  ctx.waitUntil(logAction(config.db, session.user.email, 'FILE_INFO', `${result.name} (${result.id})`));
  return json(result);
}

async function listFolderRoute({ request, session, config, ctx }) {
  const body = await readJson(request);
  const folder = requireString(body, 'folderId', 'חסר קישור או מזהה תיקייה.');
  const result = await listFolder(session.token, folder, body.resourceKey);
  ctx.waitUntil(logAction(config.db, session.user.email, 'LIST_FOLDER', `${result.folderName} (${result.folderId}) – ${result.files.length} פריטים`));
  return json(result);
}

async function ensureFolderRoute({ request, session, config }) {
  const body = await readJson(request);
  const result = await ensureFolder(session.token, config.rootFolderName, {
    name: body.name,
    path: body.path,
    parentId: body.parentId,
  });
  return json(result);
}

async function copyFileRoute({ request, session, config, ctx }) {
  const body = await readJson(request);
  const fileId = requireString(body, 'fileId', 'חסר קישור או מזהה קובץ.');
  const result = await copyFile(session.token, config.rootFolderName, {
    fileId,
    resourceKey: body.resourceKey,
    targetFolderId: body.targetFolderId,
    targetFolderName: body.targetFolderName,
    name: body.name,
  });
  if (!result.isFolder) {
    ctx.waitUntil(logAction(config.db, session.user.email, 'COPY_FILE', `${result.originalName} (${fileId}) → ${result.folderId}`));
  }
  return json(result);
}

// ---------------------------------------------------------------------- router

const ROUTES = {
  'GET /': { handler: health },
  'GET /health': { handler: health },
  'GET /login': { handler: login },
  'GET /auth-callback': { handler: authCallback },
  'POST /refresh': { handler: refresh },
  'GET /me': { handler: me, auth: true },
  'POST /file-info': { handler: fileInfo, auth: true },
  'POST /list-folder': { handler: listFolderRoute, auth: true },
  'POST /ensure-folder': { handler: ensureFolderRoute, auth: true },
  'POST /copy-file': { handler: copyFileRoute, auth: true },
};

async function route(request, url, config, ctx) {
  const path = url.pathname.replace(MOUNT_PREFIX, '');
  if (!/^\/api(\/|$)/.test(path)) throw new HttpError(404, 'not_found', 'הנתיב לא נמצא.');

  const apiPath = path.slice(4).replace(/\/+$/, '') || '/';
  const entry = ROUTES[`${request.method} ${apiPath}`];
  if (!entry) {
    const exists = Object.keys(ROUTES).some((k) => k.endsWith(` ${apiPath}`));
    throw exists ? new HttpError(405, 'method_not_allowed', 'שיטת הבקשה אינה נתמכת.') : new HttpError(404, 'not_found', 'הנתיב לא נמצא.');
  }

  const session = entry.auth ? await authenticate(request, config, ctx) : null;
  return entry.handler({ request, url, config, ctx, session });
}

export default {
  async fetch(request, env, ctx) {
    const config = getConfig(env);
    const cors = corsHeaders(request, config.allowedOrigins);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    let response;
    try {
      response = await route(request, new URL(request.url), config, ctx);
    } catch (err) {
      response = errorJson(err);
    }
    // Redirect responses have immutable headers and do not need CORS.
    return response.status >= 300 && response.status < 400 ? response : withHeaders(response, cors);
  },
};
