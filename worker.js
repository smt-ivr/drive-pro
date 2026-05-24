import { getAuthUrl, exchangeCode, refreshToken } from './auth.js';
import { listFolder, copyFileToDrivePro } from './drive.js';
import { jsonResponse, errorResponse, handleCors } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return handleCors();
    }

    const url = new URL(request.url);
    
    // מנקים את נתיב הבסיס כדי לדעת לאן בדיוק המשתמש רוצה להגיע
    const basePath = url.pathname.replace(/^\/drive-pro/, '');

    try {
      // בודקים אם מדובר בבקשת API
      if (basePath.startsWith('/api')) {
        const apiPath = basePath.replace(/^\/api/, ''); // מנקים את /api כדי לקבל את הפעולה
        
        const authHeader = request.headers.get('Authorization');
        const token = authHeader ? authHeader.replace('Bearer ', '').trim() : null;

        // וידוא חיבוריות
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
          const html = `<!DOCTYPE html><html><body><script>if(window.opener){window.opener.postMessage({type:'AUTH_SUCCESS',tokens:${JSON.stringify(tokens)}},'*');}window.close();</script><p>מתחבר...</p></body></html>`;
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (apiPath === '/refresh' && request.method === 'POST') {
          const body = await request.json();
          if (!body.refreshToken) throw new Error('חסר Refresh Token');
          const tokens = await refreshToken(body.refreshToken, env);
          return jsonResponse(tokens);
        }

        if (apiPath === '/list-folder' && request.method === 'POST') {
          const body = await request.json();
          if (!body.folderId) throw new Error('חסר מזהה תיקייה');
          if (!token) throw new Error('חסר טוקן התחברות');
          const result = await listFolder(body.folderId, token);
          return jsonResponse(result);
        }

        if (apiPath === '/copy-file' && request.method === 'POST') {
          const body = await request.json();
          if (!body.fileId) throw new Error('חסר מזהה קובץ');
          if (!token) throw new Error('חסר טוקן התחברות');
          const result = await copyFileToDrivePro(body.fileId, token, body.targetFolderName);
          return jsonResponse(result);
        }
      }

      // אם הנתיב אינו חלק מה-API, מחזירים 404
      return new Response('API Route Not Found', { status: 404 });

    } catch (error) {
      console.error('Worker Error:', error);
      return errorResponse(error.message);
    }
  }
};
