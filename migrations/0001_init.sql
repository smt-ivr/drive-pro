-- Audit log of user actions and a manual block list.
-- Safe to run against an existing database: every statement is idempotent.

CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  details     TEXT    DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_user_email ON logs (user_email);

CREATE TABLE IF NOT EXISTS blocked_users (
  email       TEXT PRIMARY KEY COLLATE NOCASE,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
