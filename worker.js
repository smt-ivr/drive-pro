import { getAuthUrl, exchangeCode, refreshToken, getUserInfo } from './auth.js';
import { listFolder, copyFileToDrivePro, getFileDetails } from './drive.js';
import { jsonResponse, errorResponse, handleCors } from './utils.js';

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

        // נתיב חדש: מחזיר את פרטי חשבון הגוגל של המשתמש (שם, אימייל)
        if (apiPath === '/me' && request.method === 'GET') {
          if (!token) throw new Error('חסר טוקן התחברות');
          const result = await getUserInfo(token);
          return jsonResponse(result);
        }

        // נתיב חדש: בדיקת קובץ לפני ביצוע פעולה וקבלת כל הפרטים שלו מקישור דרייב
        if (apiPath === '/file-info' && request.method === 'POST') {
          const body = await request.json();
          if (!body.linkOrId) throw new Error('חסר קישור דרייב (linkOrId)');
          if (!token) throw new Error('חסר טוקן התחברות');
          const result = await getFileDetails(body.linkOrId, token);
          return jsonResponse(result);
        }

        // עכשיו גם copy-file יכול לקבל קישור מלא ולא רק מזהה
        if (apiPath === '/copy-file' && request.method === 'POST') {
          const body = await request.json();
          if (!body.fileId) throw new Error('חסר קישור או מזהה קובץ (fileId)');
          if (!token) throw new Error('חסר טוקן התחברות');
          const result = await copyFileToDrivePro(body.fileId, token, body.targetFolderName);
          return jsonResponse(result);
        }

        // עכשיו גם list-folder יכול לקבל קישור מלא ולא רק מזהה
        if (apiPath === '/list-folder' && request.method === 'POST') {
          const body = await request.json();
          if (!body.folderId) throw new Error('חסר קישור או מזהה תיקייה (folderId)');
          if (!token) throw new Error('חסר טוקן התחברות');
          const result = await listFolder(body.folderId, token);
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
