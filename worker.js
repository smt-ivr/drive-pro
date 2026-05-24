import { getAuthUrl, exchangeCode, refreshToken, getUserInfo } from './auth.js';
import { listFolder, copyFileToDrivePro, getFileDetails } from './drive.js';
import { jsonResponse, errorResponse, handleCors } from './utils.js';
import { logAction, isUserBlocked } from './db.js'; // ייבוא מסד הנתונים

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return handleCors();
    }

    const url = new URL(request.url);
    const basePath = url.pathname.replace(/^\/drive-pro/, '');

    try {
      if (basePath.startsWith('/api')) {
        const apiPath = basePath.replace(/^\/api/, '');
        
        const authHeader = request.headers.get('Authorization');
        const token = authHeader ? authHeader.replace('Bearer ', '').trim() : null;
        if (!env.GOOGLE_CLIENT_SECRET) return new Response("הסוד חסר! קלאודפלייר לא מעביר אותו", { status: 500 });

        // --- בדיקת חסימות וזיהוי משתמש ללוגים ---
        let userEmail = 'unknown';
        if (token) {
           try {
             const userInfo = await getUserInfo(token);
             userEmail = userInfo.email || 'unknown';
             
             // אם המשתמש מופיע בטבלת החסומים, אנחנו עוצרים אותו מיד
             if (await isUserBlocked(env.DB, userEmail)) {
                 ctx.waitUntil(logAction(env.DB, userEmail, 'BLOCKED_ACCESS', `ניסיון גישה חסום לנתיב: ${apiPath}`));
                 return errorResponse('המשתמש שלך נחסם מגישה למערכת.', 403);
             }
           } catch (e) {
             console.error("שגיאה באימות פרטי משתמש");
           }
        }

        // --- ניתוב הבקשות ---
        if ((apiPath === '/' || apiPath === '') && request.method === 'GET') {
          return new Response('Drive Pro API Online', { status: 200 });
        }

        if (apiPath === '/login' && request.method === 'GET') {
          const authUrl = getAuthUrl(env.GOOGLE_CLIENT_ID, env.GOOGLE_REDIRECT_URI);
          return Response.redirect(authUrl, 302);
        }

        if (apiPath === '/auth-callback' && request.method === 'GET') {
          const code = url.searchParams.get('code');
          if (!code) throw new Error('חסר קוד אימות');
          const tokens = await exchangeCode(code, env);
          const html = `<!DOCTYPE html><html><body><script>if(window.opener){window.opener.postMessage({type:'AUTH_SUCCESS',tokens:${JSON.stringify(tokens)}},'*');}window.close();</script><p>החיבור הצליח</p></body></html>`;
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (apiPath === '/refresh' && request.method === 'POST') {
          const body = await request.json();
          if (!body.refreshToken) throw new Error('חסר Refresh Token');
          const tokens = await refreshToken(body.refreshToken, env);
          return jsonResponse(tokens);
        }

        if (apiPath === '/me' && request.method === 'GET') {
          if (!token) throw new Error('חסר טוקן התחברות');
          const result = await getUserInfo(token);
          return jsonResponse(result);
        }

        if (apiPath === '/file-info' && request.method === 'POST') {
          const body = await request.json();
          if (!body.linkOrId) throw new Error('חסר קישור דרייב (linkOrId)');
          if (!token) throw new Error('חסר טוקן התחברות');
          
          const result = await getFileDetails(body.linkOrId, token);
          ctx.waitUntil(logAction(env.DB, userEmail, 'FILE_INFO', `קרא פרטים של קובץ/תיקייה: ${body.linkOrId}`));
          
          return jsonResponse(result);
        }

        if (apiPath === '/copy-file' && request.method === 'POST') {
          const body = await request.json();
          if (!body.fileId) throw new Error('חסר קישור או מזהה קובץ (fileId)');
          if (!token) throw new Error('חסר טוקן התחברות');
          
          const result = await copyFileToDrivePro(body.fileId, token, body.targetFolderName);
          ctx.waitUntil(logAction(env.DB, userEmail, 'COPY_FILE', `העתיק את קובץ ${body.fileId} לתיקיית ${body.targetFolderName || 'הראשית'}`));
          
          return jsonResponse(result);
        }

        if (apiPath === '/list-folder' && request.method === 'POST') {
          const body = await request.json();
          if (!body.folderId) throw new Error('חסר קישור או מזהה תיקייה (folderId)');
          if (!token) throw new Error('חסר טוקן התחברות');
          
          const result = await listFolder(body.folderId, token);
          ctx.waitUntil(logAction(env.DB, userEmail, 'LIST_FOLDER', `סרק את תוכן תיקייה: ${body.folderId}`));
          
          return jsonResponse(result);
        }
      }

      return new Response('API Route Not Found', { status: 404 });

    } catch (error) {
      console.error('Worker Error:', error);
      return errorResponse(error.message);
    }
  }
};
