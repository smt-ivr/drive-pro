/**
 * D1 access: audit log and block list. Every function degrades gracefully when
 * the DB binding is missing or a query fails, so the API never breaks because of logging.
 */

export async function logAction(db, email, action, details = '') {
  if (!db) return;
  try {
    await db
      .prepare('INSERT INTO logs (user_email, action, details) VALUES (?, ?, ?)')
      .bind(email || 'unknown', action, String(details).slice(0, 1000))
      .run();
  } catch (e) {
    console.error('DB log error:', e);
  }
}

export async function isUserBlocked(db, email) {
  if (!db || !email) return false;
  try {
    const row = await db.prepare('SELECT email FROM blocked_users WHERE email = ? COLLATE NOCASE').bind(email).first();
    return row !== null;
  } catch (e) {
    console.error('DB block check error:', e);
    return false;
  }
}
