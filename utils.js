export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

export function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

export function handleCors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
}

export function generateUserKey() {
  return `user_${Math.random().toString(36).substring(2)}_${Date.now()}`;
}

// פונקציה חדשה: מחלצת מזהה קובץ מתוך קישור או מחזירה את המזהה אם זה כבר ID
export function extractDriveId(urlOrId) {
  if (!urlOrId) return null;
  // אם זה רק מזהה ללא סלאשים
  if (!urlOrId.includes('/')) return urlOrId;
  
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]+)/,       // קישור רגיל לקובץ
    /\/folders\/([a-zA-Z0-9_-]+)/, // קישור לתיקייה
    /id=([a-zA-Z0-9_-]+)/          // קישורים ישנים
  ];
  
  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}
