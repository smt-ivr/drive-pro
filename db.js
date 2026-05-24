export async function logAction(db, email, action, details = '') {
  if (!db) return;
  try {
    await db.prepare('INSERT INTO logs (user_email, action, details) VALUES (?, ?, ?)')
      .bind(email, action, details)
      .run();
  } catch (e) {
    console.error('DB Log Error:', e);
  }
}

export async function isUserBlocked(db, email) {
  if (!db || !email) return false;
  try {
    const result = await db.prepare('SELECT email FROM blocked_users WHERE email = ?')
      .bind(email)
      .first();
    return result !== null;
  } catch (e) {
    console.error('DB Block Check Error:', e);
    return false;
  }
}
