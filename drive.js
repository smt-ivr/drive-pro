import { generateUserKey, extractDriveId } from './utils.js';

async function getOrCreateFolder(token, folderName, parentId = null) {
  const safeName = folderName.replace(/'/g, "\\'");
  let query = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  
  if (parentId) {
      query += ` and '${parentId}' in parents`;
  } else {
      query += ` and 'root' in parents`;
  }

  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;

  const body = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const createData = await createRes.json();
  if (!createRes.ok) throw new Error('שגיאה ביצירת התיקייה');
  
  return createData.id;
}

// פונקציה חדשה: קוראת את כל המידע האפשרי על הקישור לפני ביצוע פעולה
export async function getFileDetails(linkOrId, token) {
  const fileId = extractDriveId(linkOrId);
  if (!fileId) throw new Error('הקישור שהוזן אינו תקין ולא ניתן לחלץ ממנו את מזהה הקובץ.');

  const quotaUser = generateUserKey();
  // מבקשים לקבל את ה-ID, השם, הסוג, הגודל בבתים, יכולות פעולה, סטטוס אשפה, פרטי קיצור דרך ובעלים
  const fields = 'id,name,mimeType,size,capabilities,trashed,shortcutDetails,owners';
  
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=${fields}&quotaUser=${quotaUser}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const data = await res.json();
  if (!res.ok) {
      throw new Error(data.error ? data.error.message : 'שגיאה: הקובץ אינו קיים, או שאין לך הרשאות לגשת אליו.');
  }
  
  return data;
}

export async function copyFileToDrivePro(fileIdOrUrl, token, targetFolderName = null) {
  const fileId = extractDriveId(fileIdOrUrl);
  const quotaUser = generateUserKey();
  
  const infoRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,shortcutDetails&quotaUser=${quotaUser}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const infoData = await infoRes.json();
  if (!infoRes.ok) throw new Error(infoData.error ? infoData.error.message : 'לא הצלחנו לקרוא את פרטי הקובץ.');

  if (infoData.mimeType === 'application/vnd.google-apps.folder') {
    return { isFolderShortcut: true, targetId: infoData.id, folderName: infoData.name };
  }

  let targetIdToCopy = fileId;
  if (infoData.mimeType === 'application/vnd.google-apps.shortcut') {
    const targetMime = infoData.shortcutDetails?.targetMimeType;
    if (targetMime === 'application/vnd.google-apps.folder') {
      return { isFolderShortcut: true, targetId: infoData.shortcutDetails.targetId, folderName: infoData.name };
    }
    if (infoData.shortcutDetails?.targetId) targetIdToCopy = infoData.shortcutDetails.targetId;
  }

  const driveProId = await getOrCreateFolder(token, 'Drive Pro');
  let finalFolderId = driveProId;

  if (targetFolderName && targetFolderName.trim() !== '') {
      finalFolderId = await getOrCreateFolder(token, targetFolderName.trim(), driveProId);
  }

  const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetIdToCopy}/copy?fields=id,name,webViewLink&quotaUser=${quotaUser}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ parents: [finalFolderId] })
  });

  const copyData = await copyRes.json();
  if (!copyRes.ok) throw new Error(copyData.error ? copyData.error.message : 'שגיאה בהעתקה');

  return { 
      newLink: copyData.webViewLink,
      originalName: infoData.name,
      detectedType: infoData.mimeType,
      folderLink: `https://drive.google.com/drive/folders/${finalFolderId}`
  };
}

export async function listFolder(folderIdOrUrl, token) {
  const folderId = extractDriveId(folderIdOrUrl);
  const quotaUser = generateUserKey();
  
  const infoRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name&quotaUser=${quotaUser}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  let folderName = 'תיקייה סרוקה';
  if (infoRes.ok) {
    const infoData = await infoRes.json();
    if (infoData.name) folderName = infoData.name;
  }

  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,webViewLink)&pageSize=1000&quotaUser=${quotaUser}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error ? data.error.message : 'שגיאה בסריקת תיקייה');

  return { files: data.files || [], folderName: folderName };
}
