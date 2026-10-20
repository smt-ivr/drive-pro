/**
 * Drive operations used by the API: inspect a link, list a folder, create
 * destination folders and copy files into the user's "Drive Pro" folder.
 */
import { HttpError } from '../http.js';
import { driveRequest } from './client.js';
import { escapeQueryValue, extractResourceKey, requireDriveId } from './ids.js';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

const ALL_DRIVES = { supportsAllDrives: true };
const ITEM_FIELDS =
  'id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink,resourceKey,shortcutDetails,capabilities(canCopy,canDownload)';
const DETAIL_FIELDS = `${ITEM_FIELDS},createdTime,trashed,driveId,owners(displayName,emailAddress,photoLink)`;
const MAX_LIST_ITEMS = 5000;

export const folderLink = (id) => `https://drive.google.com/drive/folders/${id}`;

/** Accepts a link or id (+ optional bare resource key) and returns what the Drive client needs. */
function resolveRef(input, resourceKey, label) {
  const id = requireDriveId(input, label);
  const key = resourceKey ? `${id}/${resourceKey}` : extractResourceKey(input, id);
  return { id, resourceKey: key };
}

function targetResourceKey(file) {
  const d = file.shortcutDetails;
  return d?.targetResourceKey ? `${d.targetId}/${d.targetResourceKey}` : undefined;
}

/** A uniform shape for files, folders and shortcuts. */
export function normalizeItem(f) {
  const isShortcut = f.mimeType === SHORTCUT_MIME;
  const effectiveMime = isShortcut ? f.shortcutDetails?.targetMimeType : f.mimeType;
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    kind: effectiveMime === FOLDER_MIME ? 'folder' : 'file',
    isShortcut,
    targetId: isShortcut ? f.shortcutDetails?.targetId || f.id : f.id,
    targetMimeType: effectiveMime || f.mimeType,
    resourceKey: f.resourceKey || f.shortcutDetails?.targetResourceKey || undefined,
    size: f.size != null ? Number(f.size) : null,
    modifiedTime: f.modifiedTime || null,
    webViewLink: f.webViewLink || null,
    iconLink: f.iconLink || null,
    thumbnailLink: f.thumbnailLink || null,
    canCopy: f.capabilities?.canCopy ?? null,
  };
}

function getFile(token, id, fields, resourceKey) {
  return driveRequest(token, `/files/${id}`, { query: { fields, ...ALL_DRIVES }, resourceKey });
}

export async function getFileDetails(token, linkOrId, resourceKey) {
  const ref = resolveRef(linkOrId, resourceKey);
  let file = await getFile(token, ref.id, DETAIL_FIELDS, ref.resourceKey);
  let shortcut = null;

  if (file.mimeType === SHORTCUT_MIME && file.shortcutDetails?.targetId) {
    shortcut = { id: file.id, name: file.name };
    try {
      file = await getFile(token, file.shortcutDetails.targetId, DETAIL_FIELDS, targetResourceKey(file));
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      // Target not accessible: still describe the shortcut itself.
    }
  }

  if (file.trashed) throw new HttpError(410, 'trashed', 'הפריט נמצא בפח של הבעלים ולא ניתן להעתיק אותו.');

  const owner = file.owners?.[0];
  return {
    ...normalizeItem(file),
    createdTime: file.createdTime || null,
    owner: owner ? { name: owner.displayName, email: owner.emailAddress, photo: owner.photoLink } : null,
    owners: file.owners || [],
    isSharedDrive: Boolean(file.driveId),
    shortcut,
  };
}

export async function listFolder(token, folderLinkOrId, resourceKey) {
  const ref = resolveRef(folderLinkOrId, resourceKey, 'קישור התיקייה');
  let folder = await getFile(token, ref.id, 'id,name,mimeType,shortcutDetails,resourceKey', ref.resourceKey);
  let folderKey = ref.resourceKey;

  if (folder.mimeType === SHORTCUT_MIME && folder.shortcutDetails?.targetMimeType === FOLDER_MIME) {
    folderKey = targetResourceKey(folder);
    folder = await getFile(token, folder.shortcutDetails.targetId, 'id,name,mimeType,resourceKey', folderKey);
  }
  if (folder.mimeType !== FOLDER_MIME) {
    throw new HttpError(400, 'not_a_folder', 'הקישור מוביל לקובץ ולא לתיקייה.');
  }

  const files = [];
  let pageToken;
  do {
    const page = await driveRequest(token, '/files', {
      resourceKey: folderKey,
      query: {
        q: `'${folder.id}' in parents and trashed = false`,
        fields: `nextPageToken,files(${ITEM_FIELDS})`,
        orderBy: 'folder,name_natural',
        pageSize: 1000,
        pageToken,
        includeItemsFromAllDrives: true,
        ...ALL_DRIVES,
      },
    });
    for (const f of page.files || []) files.push(normalizeItem(f));
    pageToken = page.nextPageToken;
  } while (pageToken && files.length < MAX_LIST_ITEMS);

  return {
    folderId: folder.id,
    folderName: folder.name,
    folderLink: folderLink(folder.id),
    files,
    truncated: Boolean(pageToken),
  };
}

function cleanName(name) {
  // eslint-disable-next-line no-control-regex
  return String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
}

async function findOrCreateFolder(token, name, parentId) {
  const q = `name = '${escapeQueryValue(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false and '${parentId}' in parents`;
  const found = await driveRequest(token, '/files', {
    query: { q, fields: 'files(id,name)', pageSize: 1, includeItemsFromAllDrives: true, ...ALL_DRIVES },
  });
  if (found.files?.length) return found.files[0];
  return driveRequest(token, '/files', {
    method: 'POST',
    query: { fields: 'id,name', ...ALL_DRIVES },
    body: { name, mimeType: FOLDER_MIME, parents: [parentId] },
  });
}

/**
 * Ensures a destination folder exists and returns it.
 *  - `parentId` omitted  → relative to the "Drive Pro" root folder in My Drive.
 *  - `path` ("a/b/c")    → nested folders, used for names the user typed.
 *  - `name`              → a single literal folder name (may contain "/"), used when mirroring source folders.
 */
export async function ensureFolder(token, rootFolderName, { name, path, parentId } = {}) {
  let parent;
  if (parentId) {
    parent = { id: requireDriveId(parentId, 'תיקיית היעד'), name: null };
  } else {
    parent = await findOrCreateFolder(token, rootFolderName, 'root');
  }

  const segments = name != null && String(name).trim() !== ''
    ? [cleanName(name)]
    : String(path ?? '').split('/').map(cleanName);

  for (const segment of segments.filter(Boolean)) {
    parent = await findOrCreateFolder(token, segment, parent.id);
  }
  return { id: parent.id, name: parent.name, link: folderLink(parent.id) };
}

export async function copyFile(token, rootFolderName, { fileId, resourceKey, targetFolderId, targetFolderName, name }) {
  const ref = resolveRef(fileId, resourceKey, 'הקובץ');
  const info = await getFile(token, ref.id, 'id,name,mimeType,shortcutDetails', ref.resourceKey);
  const item = normalizeItem(info);

  if (item.kind === 'folder') {
    // Folders are copied recursively by the client (ensure-folder + list-folder + copy-file).
    return { isFolder: true, isFolderShortcut: true, targetId: item.targetId, folderName: item.name };
  }

  const sourceKey = item.isShortcut ? targetResourceKey(info) : ref.resourceKey;
  const destinationId = targetFolderId
    ? requireDriveId(targetFolderId, 'תיקיית היעד')
    : (await ensureFolder(token, rootFolderName, { path: targetFolderName })).id;

  const copy = await driveRequest(token, `/files/${item.targetId}/copy`, {
    method: 'POST',
    resourceKey: sourceKey,
    query: { fields: 'id,name,mimeType,webViewLink', ...ALL_DRIVES },
    body: { name: cleanName(name) || item.name, parents: [destinationId] },
  });

  return {
    id: copy.id,
    name: copy.name,
    mimeType: copy.mimeType,
    webViewLink: copy.webViewLink,
    newLink: copy.webViewLink,
    originalName: item.name,
    detectedType: info.mimeType,
    folderId: destinationId,
    folderLink: folderLink(destinationId),
  };
}
