import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { clearSessionCache } from '../src/auth/session.js';
import { createCtx, env, isUserInfo, jsonResponse, mockFetch, userInfoOk } from './helpers.js';

const BASE = 'https://smti.uk/drive-pro/api';
const FILE_ID = '1FileIdFileIdFileId_abc';
const FOLDER_ID = '1FolderIdFolderId_xyz';
const AUTH = { Authorization: 'Bearer token-123', 'Content-Type': 'application/json' };

let fetchMock;
const call = (path, init = {}, e = env) => worker.fetch(new Request(BASE + path, init), e, createCtx());
const post = (path, body) => call(path, { method: 'POST', headers: AUTH, body: JSON.stringify(body) });
const drive = (path) => (url) => url.hostname === 'www.googleapis.com' && url.pathname === `/drive/v3${path}`;

beforeEach(() => clearSessionCache());
afterEach(() => fetchMock?.restore());

describe('public routes', () => {
  test('health check works with and without the /drive-pro prefix', async () => {
    for (const url of [`${BASE}/health`, 'https://drive-pro.example.workers.dev/api']) {
      const res = await worker.fetch(new Request(url), env, createCtx());
      assert.equal(res.status, 200);
      assert.equal((await res.json()).ok, true);
    }
  });

  test('unknown route → 404, wrong method → 405', async () => {
    assert.equal((await call('/nope')).status, 404);
    assert.equal((await call('/copy-file')).status, 405);
  });

  test('CORS is granted only to allowed origins', async () => {
    const ok = await call('/health', { method: 'OPTIONS', headers: { Origin: 'https://smti.uk' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://smti.uk');

    const bad = await call('/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  });

  test('login redirects to Google with a signed state, and rejects unknown origins', async () => {
    const res = await call('/login?origin=https://smti.uk');
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get('Location'));
    assert.equal(location.hostname, 'accounts.google.com');
    assert.equal(location.searchParams.get('client_id'), 'client-id');
    assert.ok(location.searchParams.get('state').includes('.'));

    const bad = await call('/login?origin=https://evil.example');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'origin_not_allowed');
  });

  test('auth callback delivers tokens to the verified origin only', async () => {
    const login = await call('/login?origin=https://smti.uk');
    const state = new URL(login.headers.get('Location')).searchParams.get('state');

    fetchMock = mockFetch([
      [(u) => u.hostname === 'oauth2.googleapis.com', () => jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, id_token: 'secret-id-token' })],
      [isUserInfo, userInfoOk],
    ]);
    const res = await call(`/auth-callback?code=abc&state=${encodeURIComponent(state)}`);
    const page = await res.text();
    assert.equal(res.status, 200);
    assert.match(page, /postMessage\(message, origin\)/);
    assert.match(page, /var origin = "https:\/\/smti.uk"/);
    assert.match(page, /"refresh_token":"rt"/);
    assert.doesNotMatch(page, /secret-id-token/);
    assert.doesNotMatch(page, /'\*'/);
  });

  test('auth callback refuses a forged state', async () => {
    const res = await call('/auth-callback?code=abc&state=forged.state');
    assert.equal(res.status, 400);
    assert.match(await res.text(), /AUTH_ERROR/);
  });

  test('refresh with a revoked token → 401 session_expired', async () => {
    fetchMock = mockFetch([[(u) => u.hostname === 'oauth2.googleapis.com', () => jsonResponse({ error: 'invalid_grant' }, 400)]]);
    const res = await call('/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: 'x' }) });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'session_expired');
  });
});

describe('authentication', () => {
  test('missing token → 401', async () => {
    const res = await call('/me');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'missing_token');
  });

  test('expired Google token → 401 (so the client refreshes)', async () => {
    fetchMock = mockFetch([[isUserInfo, () => jsonResponse({ error: { message: 'expired' } }, 401)]]);
    const res = await call('/me', { headers: AUTH });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'invalid_token');
  });

  test('identity is cached between requests', async () => {
    fetchMock = mockFetch([[isUserInfo, userInfoOk]]);
    await call('/me', { headers: AUTH });
    const res = await call('/me', { headers: AUTH });
    assert.equal((await res.json()).email, 'user@example.com');
    assert.equal(fetchMock.calls.length, 1);
  });

  test('blocked users get 403', async () => {
    fetchMock = mockFetch([[isUserInfo, userInfoOk]]);
    const DB = { prepare: () => ({ bind: () => ({ first: async () => ({ email: 'user@example.com' }), run: async () => {} }) }) };
    const res = await call('/me', { headers: AUTH }, { ...env, DB });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'user_blocked');
  });
});

describe('drive routes', () => {
  test('file-info resolves shortcuts to their target', async () => {
    fetchMock = mockFetch([
      [isUserInfo, userInfoOk],
      [drive(`/files/${FILE_ID}`), () => jsonResponse({ id: FILE_ID, name: 'link', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'targetTargetTarget1', targetMimeType: 'application/pdf' } })],
      [drive('/files/targetTargetTarget1'), () => jsonResponse({ id: 'targetTargetTarget1', name: 'doc.pdf', mimeType: 'application/pdf', size: '2048', owners: [{ displayName: 'Owner' }] })],
    ]);
    const res = await post('/file-info', { linkOrId: `https://drive.google.com/file/d/${FILE_ID}/view` });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.name, 'doc.pdf');
    assert.equal(data.kind, 'file');
    assert.equal(data.size, 2048);
    assert.equal(data.owner.name, 'Owner');
    assert.deepEqual(data.shortcut, { id: FILE_ID, name: 'link' });
  });

  test('file-info rejects invalid links with 400', async () => {
    fetchMock = mockFetch([[isUserInfo, userInfoOk]]);
    const res = await post('/file-info', { linkOrId: 'https://example.com/hello' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'invalid_link');
  });

  test('list-folder follows pagination and normalizes items', async () => {
    fetchMock = mockFetch([
      [isUserInfo, userInfoOk],
      [drive(`/files/${FOLDER_ID}`), () => jsonResponse({ id: FOLDER_ID, name: 'Shared', mimeType: 'application/vnd.google-apps.folder' })],
      [
        (u) => drive('/files')(u) && !u.searchParams.get('pageToken'),
        () => jsonResponse({ nextPageToken: 'p2', files: [{ id: 'sub', name: 'Sub', mimeType: 'application/vnd.google-apps.folder' }] }),
      ],
      [drive('/files'), () => jsonResponse({ files: [{ id: 'f1', name: 'a.txt', mimeType: 'text/plain', size: '5' }] })],
    ]);
    const res = await post('/list-folder', { folderId: `https://drive.google.com/drive/folders/${FOLDER_ID}` });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.folderName, 'Shared');
    assert.deepEqual(data.files.map((f) => [f.name, f.kind]), [['Sub', 'folder'], ['a.txt', 'file']]);
    const listCall = fetchMock.calls.find((c) => c.url.pathname === '/drive/v3/files');
    assert.equal(listCall.url.searchParams.get('q'), `'${FOLDER_ID}' in parents and trashed = false`);
    assert.equal(listCall.url.searchParams.get('supportsAllDrives'), 'true');
  });

  test('copy-file creates "Drive Pro/<path>" and copies into it', async () => {
    const created = [];
    fetchMock = mockFetch([
      [isUserInfo, userInfoOk],
      [drive(`/files/${FILE_ID}`), () => jsonResponse({ id: FILE_ID, name: 'report.pdf', mimeType: 'application/pdf' })],
      [(u, i) => drive('/files')(u) && i.method === 'POST', (u, i) => {
        const body = JSON.parse(i.body);
        created.push(body);
        return jsonResponse({ id: `new_${body.name}`, name: body.name });
      }],
      [drive('/files'), () => jsonResponse({ files: [] })],
      [drive(`/files/${FILE_ID}/copy`), (u, i) => jsonResponse({ id: 'copy1', name: JSON.parse(i.body).name, webViewLink: 'https://drive.google.com/file/d/copy1/view' })],
    ]);
    const res = await post('/copy-file', { fileId: FILE_ID, targetFolderName: "Work/It's 2026" });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(created.map((c) => c.name), ['Drive Pro', 'Work', "It's 2026"]);
    assert.equal(data.folderId, "new_It's 2026");
    assert.equal(data.newLink, 'https://drive.google.com/file/d/copy1/view');

    const searches = fetchMock.calls.filter((c) => c.url.pathname === '/drive/v3/files' && c.init.method !== 'POST');
    assert.match(searches.at(-1).url.searchParams.get('q'), /name = 'It\\'s 2026'/);
  });

  test('copy-file to an explicit folder id skips folder lookup', async () => {
    fetchMock = mockFetch([
      [isUserInfo, userInfoOk],
      [drive(`/files/${FILE_ID}`), () => jsonResponse({ id: FILE_ID, name: 'a.txt', mimeType: 'text/plain' })],
      [drive(`/files/${FILE_ID}/copy`), () => jsonResponse({ id: 'c', name: 'a.txt', webViewLink: 'l' })],
    ]);
    const res = await post('/copy-file', { fileId: FILE_ID, targetFolderId: FOLDER_ID });
    assert.equal((await res.json()).folderId, FOLDER_ID);
    assert.equal(fetchMock.calls.length, 3);
  });

  test('copy restrictions and quota errors get clear codes', async () => {
    const cases = [
      [{ error: { message: 'x', errors: [{ reason: 'cannotCopyFile' }] } }, 403, 403, 'copy_restricted'],
      [{ error: { message: 'x', errors: [{ reason: 'storageQuotaExceeded' }] } }, 403, 507, 'storage_full'],
      [{ error: { message: 'x', errors: [{ reason: 'notFound' }] } }, 404, 404, 'not_found'],
    ];
    for (const [payload, googleStatus, status, code] of cases) {
      clearSessionCache();
      fetchMock?.restore();
      fetchMock = mockFetch([
        [isUserInfo, userInfoOk],
        [drive(`/files/${FILE_ID}`), () => jsonResponse({ id: FILE_ID, name: 'a', mimeType: 'text/plain' })],
        [drive(`/files/${FILE_ID}/copy`), () => jsonResponse(payload, googleStatus)],
      ]);
      const res = await post('/copy-file', { fileId: FILE_ID, targetFolderId: FOLDER_ID });
      assert.equal(res.status, status, code);
      assert.equal((await res.json()).code, code);
    }
  });

  test('transient Google failures are retried', async () => {
    let attempts = 0;
    fetchMock = mockFetch([
      [isUserInfo, userInfoOk],
      [drive(`/files/${FILE_ID}`), () => (++attempts < 2 ? jsonResponse({ error: { message: 'boom' } }, 503) : jsonResponse({ id: FILE_ID, name: 'a', mimeType: 'text/plain' }))],
    ]);
    const res = await post('/file-info', { linkOrId: FILE_ID });
    assert.equal(res.status, 200);
    assert.equal(attempts, 2);
  });

  test('copy-file reports folders instead of copying them', async () => {
    fetchMock = mockFetch([
      [isUserInfo, userInfoOk],
      [drive(`/files/${FOLDER_ID}`), () => jsonResponse({ id: FOLDER_ID, name: 'Dir', mimeType: 'application/vnd.google-apps.folder' })],
    ]);
    const data = await (await post('/copy-file', { fileId: FOLDER_ID })).json();
    assert.equal(data.isFolder, true);
    assert.equal(data.targetId, FOLDER_ID);
  });
});
