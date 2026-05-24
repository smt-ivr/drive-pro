export function getAuthUrl(clientId, redirectUri) {
  const scopes = encodeURIComponent('https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email');
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent`;
}

export async function exchangeCode(code, env) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'שגיאה בקבלת הטוקן');
  return data;
}

export async function refreshToken(refreshToken, env) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'שגיאה בחידוש טוקן');
  return data;
}
